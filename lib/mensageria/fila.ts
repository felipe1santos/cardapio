/**
 * Fila de envios do WhatsApp (0103) — respostas do robô. (Avisos de etapa do pedido
 * continuam no envio direto de lib/whatsapp.ts nesta versão; o tipo `aviso_pedido` fica
 * reservado para quando migrarem.)
 *
 *  - `enfileirar`: grava com chave de idempotência única por loja. A mesma chave duas
 *    vezes (duplo clique, webhook reentregue, retentativa do chamador) não gera outro envio.
 *  - `processarFila`: reivindica com `for update skip locked` (dois processadores nunca
 *    pegam o mesmo), envia pelo provedor e conclui: enviado, nova tentativa com espera
 *    crescente (falha transitória), falhou (definitiva) ou incerto (tempo esgotado depois
 *    de o provedor talvez ter aceitado — não reenvia sozinho).
 *
 * Log sem número completo nem conteúdo.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { provedorAtual, logFalhaEnvio } from './provedor'
import { concluirSaida, hashTexto, registrarSaida } from './historico'
import { roboLiberadoNoServidor } from './robo'

export interface NovoEnvio {
  restauranteId: string
  chave: string
  tipo: 'robo' | 'aviso_pedido' | 'descadastro'
  telefone: string
  texto: string
  conversaId?: string | null
  origemMensagemId?: string | null
  pedidoId?: string | null
}

export async function enfileirar(admin: SupabaseClient, e: NovoEnvio): Promise<{ id: string; novo: boolean; estado: string } | null> {
  const linha = {
    restaurante_id: e.restauranteId,
    chave: e.chave.slice(0, 200),
    tipo: e.tipo,
    telefone: e.telefone,
    texto: e.texto.slice(0, 4000),
    conversa_id: e.conversaId ?? null,
    origem_mensagem_id: e.origemMensagemId ?? null,
    pedido_id: e.pedidoId ?? null,
  }
  const { data, error } = await admin
    .from('whatsapp_envios')
    .upsert(linha, { onConflict: 'restaurante_id,chave', ignoreDuplicates: true })
    .select('id, estado')
  if (error) {
    // Conflito na mensagem de origem (outra resposta já existe para ela): nada a fazer.
    if ((error as { code?: string }).code === '23505') return null
    throw error
  }
  if (data && data.length) return { id: data[0].id as string, novo: true, estado: data[0].estado as string }
  const { data: existente } = await admin
    .from('whatsapp_envios')
    .select('id, estado')
    .eq('restaurante_id', e.restauranteId)
    .eq('chave', linha.chave)
    .maybeSingle()
  return existente ? { id: existente.id as string, novo: false, estado: existente.estado as string } : null
}

interface EnvioReivindicado {
  id: string
  restaurante_id: string
  conversa_id?: string | null
  telefone: string
  texto: string
  tipo: string
  criado_em?: string
  tentativas?: number
}

/** Quanto a trava de um envio vale a partir de agora (a da reivindicação é de 60 s). */
const TRAVA_MS = 60_000

/**
 * Renova a trava dos envios do lote que ainda são nossos e devolve quais continuam.
 *
 * A trava de 60 s vale do momento da reivindicação, mas o lote é enviado um por um (até
 * 15 s cada no provedor): o 5º em diante já estava vencido quando chegava a vez dele, e
 * outro processador o marcava 'incerto' — sem nunca ter saído (B10). Renovando antes de
 * cada envio, só o que já foi tomado por outro (estado mudou) fica de fora.
 */
async function renovarTrava(admin: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { data, error } = await admin
    .from('whatsapp_envios')
    .update({ travado_ate: new Date(Date.now() + TRAVA_MS).toISOString() })
    .in('id', ids)
    .eq('estado', 'enviando')
    .select('id')
  // Sem conseguir renovar, segue como antes (a trava original ainda pode valer).
  if (error) return new Set(ids)
  return new Set(((data ?? []) as { id: string }[]).map((d) => d.id))
}

/**
 * Nova tentativa de um envio que já falhou: reaproveita a mensagem que a 1ª tentativa
 * deixou no histórico ("falhou") em vez de criar outra — antes a conversa mostrava a
 * mesma resposta duas vezes, uma falhada e uma enviada (B8).
 */
async function saidaDaTentativaAnterior(admin: SupabaseClient, e: EnvioReivindicado): Promise<string | null> {
  if ((e.tentativas ?? 1) <= 1 || !e.criado_em) return null
  const h = await hashTexto(e.texto)
  if (!h) return null
  let q = admin
    .from('whatsapp_mensagens')
    .select('id')
    .eq('restaurante_id', e.restaurante_id)
    .eq('texto_hash', h)
    .eq('origem', e.tipo === 'robo' ? 'robo' : 'automatico')
    .eq('status_envio', 'falhou')
    .gte('criado_em', e.criado_em)
  if (e.conversa_id) q = q.eq('conversa_id', e.conversa_id)
  const { data } = await q.order('criado_em', { ascending: false }).limit(1)
  return ((data ?? []) as { id: string }[])[0]?.id ?? null
}

/**
 * A resposta do robô perdeu a vez? Uma falha temporária a reagenda (30 s a 4 min); se
 * nesse meio tempo um atendente assumiu a conversa, ela não pode sair no meio do
 * atendimento. Só conta silêncio POSTERIOR à resposta: a própria mensagem de "vou
 * chamar um atendente" nasce junto com o silêncio e tem que sair.
 */
export function respostaDoRoboVencida(
  envio: Pick<EnvioReivindicado, 'tipo' | 'criado_em'>,
  conversa: { estado: string | null; silenciada_em: string | null } | undefined,
): boolean {
  if (envio.tipo !== 'robo' || !conversa || conversa.estado !== 'silenciada' || !conversa.silenciada_em || !envio.criado_em) return false
  return Date.parse(conversa.silenciada_em) > Date.parse(envio.criado_em)
}

export async function processarFila(
  admin: SupabaseClient,
  opcoes: { restauranteId?: string; limite?: number } = {},
): Promise<{ enviados: number; falhas: number; reivindicados: string[] }> {
  const { data, error } = await admin.rpc('whatsapp_reivindicar_envios', {
    p_limite: opcoes.limite ?? 10,
    p_restaurante: opcoes.restauranteId ?? null,
  })
  if (error) throw error
  const envios = (data ?? []) as EnvioReivindicado[]
  if (!envios.length) return { enviados: 0, falhas: 0, reivindicados: [] }

  const lojas = [...new Set(envios.map((e) => e.restaurante_id))]
  const conversaIds = [...new Set(envios.filter((e) => e.tipo === 'robo' && e.conversa_id).map((e) => e.conversa_id as string))]
  const [{ data: inst }, { data: cfgs }, { data: convs }] = await Promise.all([
    admin.from('restaurantes').select('id, evolution_instance').in('id', lojas),
    admin.from('whatsapp_robo_config').select('restaurante_id, robo_ativo').in('restaurante_id', lojas),
    conversaIds.length
      ? admin.from('whatsapp_conversas').select('id, estado, silenciada_em').in('id', conversaIds)
      : Promise.resolve({ data: [] }),
  ])
  const conversa = new Map(((convs ?? []) as { id: string; estado: string | null; silenciada_em: string | null }[]).map((c) => [c.id, c]))
  const instancia = new Map(((inst ?? []) as { id: string; evolution_instance: string | null }[]).map((r) => [r.id, r.evolution_instance]))
  // Resposta do robô conferida NA HORA de sair: servidor liberado e robô da loja ainda
  // ligado. Desligar o robô com resposta na fila cancela o envio (nada sai depois).
  const roboLigado = new Set(((cfgs ?? []) as { restaurante_id: string; robo_ativo: boolean }[]).filter((c) => c.robo_ativo).map((c) => c.restaurante_id))
  const liberado = roboLiberadoNoServidor()
  const provedor = provedorAtual()

  let enviados = 0
  let falhas = 0
  for (let i = 0; i < envios.length; i++) {
    const e = envios[i]
    const nossos = await renovarTrava(admin, envios.slice(i).map((x) => x.id))
    if (!nossos.has(e.id)) continue
    const nome = instancia.get(e.restaurante_id)
    let resultado: 'enviado' | 'transitorio' | 'definitivo' | 'incerto'
    let idExterno: string | null = null
    let erro: string | null = null
    if (e.tipo === 'robo' && (!liberado || !roboLigado.has(e.restaurante_id))) {
      resultado = 'definitivo'
      erro = liberado ? 'robô desligado na loja' : 'robô não liberado no servidor'
    } else if (respostaDoRoboVencida(e, e.conversa_id ? conversa.get(e.conversa_id) : undefined)) {
      resultado = 'definitivo'
      erro = 'conversa em atendimento humano'
    } else if (!nome) {
      resultado = 'definitivo'
      erro = 'loja sem WhatsApp conectado'
    } else {
      // Histórico da central de atendimento: resposta do robô (ou aviso da fila).
      const anterior = await saidaDaTentativaAnterior(admin, e).catch(() => null)
      const mensagemId = anterior
        ?? (await registrarSaida(admin, { restauranteId: e.restaurante_id, telefone: e.telefone, texto: e.texto, origem: e.tipo === 'robo' ? 'robo' : 'automatico' }))?.mensagemId
      const r = await provedor.enviarTexto(nome, e.telefone, e.texto)
      await concluirSaida(admin, mensagemId, r.ok, r.ok ? r.idExterno : null, r.ok ? null : r.erro)
      if (r.ok) {
        resultado = 'enviado'
        idExterno = r.idExterno
      } else {
        resultado = r.tipo
        erro = r.erro
        logFalhaEnvio(e.tipo, e.telefone, r.erro)
      }
    }
    const { error: e2 } = await admin.rpc('whatsapp_concluir_envio', { p_id: e.id, p_resultado: resultado, p_id_externo: idExterno, p_erro: erro })
    if (e2) console.error('[whatsapp] não foi possível concluir o envio', e.id, e2.message)
    if (resultado === 'enviado') enviados++
    else falhas++
  }
  return { enviados, falhas, reivindicados: envios.map((e) => e.id) }
}

/** Estado atual de um envio (depois de tentar processá-lo). */
export async function estadoDoEnvio(admin: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await admin.from('whatsapp_envios').select('estado').eq('id', id).maybeSingle()
  return (data?.estado as string | undefined) ?? null
}
