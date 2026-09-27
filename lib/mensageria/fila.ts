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
import { roboLiberadoNoServidor } from './robo'

export interface NovoEnvio {
  restauranteId: string
  chave: string
  tipo: 'robo' | 'aviso_pedido'
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
  telefone: string
  texto: string
  tipo: string
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
  const [{ data: inst }, { data: cfgs }] = await Promise.all([
    admin.from('restaurantes').select('id, evolution_instance').in('id', lojas),
    admin.from('whatsapp_robo_config').select('restaurante_id, robo_ativo').in('restaurante_id', lojas),
  ])
  const instancia = new Map(((inst ?? []) as { id: string; evolution_instance: string | null }[]).map((r) => [r.id, r.evolution_instance]))
  // Resposta do robô conferida NA HORA de sair: servidor liberado e robô da loja ainda
  // ligado. Desligar o robô com resposta na fila cancela o envio (nada sai depois).
  const roboLigado = new Set(((cfgs ?? []) as { restaurante_id: string; robo_ativo: boolean }[]).filter((c) => c.robo_ativo).map((c) => c.restaurante_id))
  const liberado = roboLiberadoNoServidor()
  const provedor = provedorAtual()

  let enviados = 0
  let falhas = 0
  for (const e of envios) {
    const nome = instancia.get(e.restaurante_id)
    let resultado: 'enviado' | 'transitorio' | 'definitivo' | 'incerto'
    let idExterno: string | null = null
    let erro: string | null = null
    if (e.tipo === 'robo' && (!liberado || !roboLigado.has(e.restaurante_id))) {
      resultado = 'definitivo'
      erro = liberado ? 'robô desligado na loja' : 'robô não liberado no servidor'
    } else if (!nome) {
      resultado = 'definitivo'
      erro = 'loja sem WhatsApp conectado'
    } else {
      const r = await provedor.enviarTexto(nome, e.telefone, e.texto)
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
