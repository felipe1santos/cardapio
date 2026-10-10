/**
 * Disparo das campanhas (cron /api/cron/campanhas), pela fila da 0104/0112.
 *
 * campanha_reservar_envios escolhe e trava (skip locked: dois crons nunca pegam o mesmo
 * envio), expira o que passou de 24h do horário agendado, cancela quem pediu para sair
 * (SAIR) e transforma trava vencida em 'incerto' — sem reenviar. campanha_concluir_envio
 * grava o resultado: transitório volta para a fila (até 3 tentativas), definitivo vira
 * erro, tempo esgotado vira 'incerto', WhatsApp desconectado vira 'pausa'.
 *
 * WhatsApp da loja desconectado (0112): antes cada contato virava "erro" e a campanha
 * terminava "Concluída" com 0 enviados. Agora a conexão é conferida ANTES de reservar e a
 * cada falha: desconectado = campanha 'pausada', contatos ficam na fila e voltam a sair
 * quando a loja reconecta (dentro das 24h do horário agendado).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { erroDeDesconexao, logFalhaEnvio, type EstadoConexaoProvedor, type ProvedorWhatsapp, type ResultadoEnvio } from './provedor'
import { montarTextoCampanha, type BotaoCampanha } from './campanhas'
import { telefoneWhatsapp } from '@/lib/telefone-br'
import { concluirSaida, registrarSaida } from './historico'
import { moduloLiberado } from '@/lib/modulos'

interface EnvioReservado {
  id: string
  campanha_id: string
  restaurante_id: string
  telefone: string
  nome_cliente: string
  token: string | null
  tipo_mensagem: 'texto' | 'imagem' | 'audio'
  mensagem: string
  imagem_url: string | null
  audio_url: string | null
  incluir_link: boolean
  evolution_instance: string | null
  slug: string
  incluir_descadastro?: boolean
  /** Botões da campanha (0118) — carregados à parte, por campanha. */
  botoes?: BotaoCampanha[]
}

export interface ResumoCampanhas {
  processados: number
  enviados: number
  novasTentativas: number
  erros: number
  incertos: number
  pausados: number
  campanhasPausadas: number
  campanhasRetomadas: number
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

function textoDoEnvio(e: EnvioReservado): string {
  return montarTextoCampanha(e.mensagem, { incluirLink: e.incluir_link, token: e.token, nome: e.nome_cliente, incluirDescadastro: e.incluir_descadastro === true, botoes: e.tipo_mensagem === 'audio' ? [] : e.botoes })
}

/** Botões de cada campanha do lote, numa consulta só. Falhou: segue sem botões. */
async function botoesDasCampanhas(admin: SupabaseClient, ids: string[]): Promise<Map<string, BotaoCampanha[]>> {
  const mapa = new Map<string, BotaoCampanha[]>()
  if (!ids.length) return mapa
  try {
    const { data } = await admin.from('campanhas').select('id, botoes').in('id', ids)
    for (const c of (data ?? []) as { id: string; botoes: unknown }[]) mapa.set(c.id, Array.isArray(c.botoes) ? (c.botoes as BotaoCampanha[]) : [])
  } catch { /* sem botões */ }
  return mapa
}

/** Disparo enviado: entra no histórico do cliente na central de atendimento (origem "disparo"). */
async function registrarDisparo(admin: SupabaseClient, e: EnvioReservado, idExterno: string | null) {
  const numero = telefoneWhatsapp(e.telefone)
  if (!numero) return
  const texto = textoDoEnvio(e)
  const tipo = e.tipo_mensagem === 'imagem' && e.imagem_url ? 'imagem' : e.tipo_mensagem === 'audio' && e.audio_url ? 'audio' : 'texto'
  // Histórico: como saiu. Botões vão como links no texto (conexão por QR Code).
  const comBotoes = (e.botoes?.length ?? 0) > 0 && tipo !== 'audio'
  const saida = await registrarSaida(admin, {
    restauranteId: e.restaurante_id, telefone: numero, texto: texto || (tipo === 'audio' ? '🎤 Áudio da campanha' : ''), origem: 'disparo', tipo,
    textoExibido: comBotoes ? `${texto}

(botões enviados como links no texto)` : undefined,
    midiaUrl: tipo === 'imagem' ? e.imagem_url : null,
  })
  await concluirSaida(admin, saida?.mensagemId, true, idExterno)
}

async function enviarUm(provedor: ProvedorWhatsapp, e: EnvioReservado): Promise<ResultadoEnvio> {
  if (!e.evolution_instance) return { ok: false, tipo: 'definitivo', erro: 'Instância WhatsApp não configurada' }
  const numero = telefoneWhatsapp(e.telefone)
  if (!numero) return { ok: false, tipo: 'definitivo', erro: 'Telefone inválido' }
  const texto = textoDoEnvio(e)
  if (e.tipo_mensagem === 'imagem' && e.imagem_url) return provedor.enviarImagem(e.evolution_instance, numero, e.imagem_url, texto)
  if (e.tipo_mensagem === 'audio' && e.audio_url) return provedor.enviarAudio(e.evolution_instance, numero, e.audio_url)
  if (!texto.trim()) return { ok: false, tipo: 'definitivo', erro: 'Mensagem vazia' }
  return provedor.enviarTexto(e.evolution_instance, numero, texto)
}

/**
 * Antes de reservar: pausa as campanhas de loja com o WhatsApp desconectado e retoma as
 * pausadas cuja loja reconectou. 'desconhecido' (provedor não respondeu) não muda nada.
 */
async function sincronizarPausas(admin: SupabaseClient, provedor: ProvedorWhatsapp, r: ResumoCampanhas) {
  const { data } = await admin
    .from('campanhas')
    .select('id, status, restaurante_id, restaurantes ( evolution_instance )')
    .in('status', ['agendada', 'enviando', 'pausada'])
    .lte('agendado_em', new Date().toISOString())
  const linhas = (data ?? []) as unknown as { id: string; status: string; restaurante_id: string; restaurantes: { evolution_instance: string | null } | null }[]
  const estados = new Map<string, EstadoConexaoProvedor>()
  for (const c of linhas) {
    const inst = c.restaurantes?.evolution_instance ?? null
    const chave = inst ?? `sem:${c.restaurante_id}`
    if (!estados.has(chave)) estados.set(chave, inst ? await provedor.conexao(inst) : 'fechado')
    const estado = estados.get(chave)!
    if (estado === 'fechado' && c.status !== 'pausada') {
      await admin.from('campanhas').update({ status: 'pausada', pausada_em: new Date().toISOString(), pausa_motivo: 'whatsapp_desconectado', atualizado_em: new Date().toISOString() })
        .eq('id', c.id).in('status', ['agendada', 'enviando'])
      r.campanhasPausadas++
    } else if (estado === 'aberto' && c.status === 'pausada') {
      await admin.from('campanhas').update({ status: 'enviando', pausada_em: null, pausa_motivo: null, atualizado_em: new Date().toISOString() })
        .eq('id', c.id).eq('status', 'pausada')
      r.campanhasRetomadas++
    }
  }
}

export async function processarCampanhas(
  admin: SupabaseClient,
  provedor: ProvedorWhatsapp,
  opcoes: { limite: number; intervalo: () => number },
): Promise<ResumoCampanhas> {
  const r: ResumoCampanhas = { processados: 0, enviados: 0, novasTentativas: 0, erros: 0, incertos: 0, pausados: 0, campanhasPausadas: 0, campanhasRetomadas: 0 }
  await sincronizarPausas(admin, provedor, r)

  const { data, error } = await admin.rpc('campanha_reservar_envios', { p_limite: opcoes.limite })
  if (error) throw error
  const lista = (data ?? []) as EnvioReservado[]
  const botoes = await botoesDasCampanhas(admin, [...new Set(lista.map((e) => e.campanha_id))])
  for (const e of lista) e.botoes = botoes.get(e.campanha_id) ?? []
  const lojasCaidas = new Set<string>()
  // Módulo Disparos bloqueado na loja (0176): não envia — a campanha pausa como na loja desconectada.
  const lojasBloqueadas = new Set<string>()
  for (const loja of new Set(lista.map((e) => e.restaurante_id))) if (!(await moduloLiberado(admin, loja, 'disparos'))) lojasBloqueadas.add(loja)

  for (let i = 0; i < lista.length; i++) {
    const e = lista[i]
    let resultado: ResultadoEnvio
    if (lojasBloqueadas.has(e.restaurante_id)) {
      resultado = { ok: false, tipo: 'definitivo', erro: 'Módulo de disparos bloqueado na loja' }
    } else if (lojasCaidas.has(e.restaurante_id)) {
      // O WhatsApp desta loja caiu neste lote: nem tenta, volta para a fila.
      resultado = { ok: false, tipo: 'definitivo', erro: 'WhatsApp da loja desconectado' }
    } else {
      try {
        resultado = await enviarUm(provedor, e)
      } catch (err) {
        resultado = { ok: false, tipo: 'transitorio', erro: (err as Error).message ?? 'falha' }
      }
    }
    // Falha que é da conexão da loja (e não do contato) pausa a campanha.
    let pausa = !resultado.ok && (lojasBloqueadas.has(e.restaurante_id) || lojasCaidas.has(e.restaurante_id) || erroDeDesconexao(resultado.erro))
    if (!resultado.ok && !pausa && resultado.tipo !== 'incerto' && e.evolution_instance) {
      pausa = (await provedor.conexao(e.evolution_instance).catch(() => 'desconhecido' as const)) === 'fechado'
    }
    if (pausa) lojasCaidas.add(e.restaurante_id)
    // Falha ao GRAVAR o resultado não pode derrubar o lote: antes o throw abortava o laço e
    // os contatos já reservados que vinham depois ficavam travados até virar 'incerto' —
    // sem nunca terem sido enviados. Este fica travado (a trava vencida vira 'incerto',
    // o certo: a mensagem pode ter saído) e o lote segue.
    let final: unknown = null
    try {
      const { data, error: errFim } = await admin.rpc('campanha_concluir_envio', {
        p_id: e.id,
        p_resultado: resultado.ok ? 'enviado' : pausa ? 'pausa' : resultado.tipo,
        p_id_externo: resultado.ok ? resultado.idExterno : null,
        p_erro: resultado.ok ? null : pausa ? 'WhatsApp da loja desconectado' : resultado.erro,
      })
      if (errFim) throw errFim
      final = data
    } catch (err) {
      console.error('[campanhas] não gravou o resultado do envio', e.id, (err as { message?: string })?.message ?? err)
      final = 'incerto'
    }
    r.processados++
    if (final === 'enviado') {
      r.enviados++
      await registrarDisparo(admin, e, resultado.ok ? resultado.idExterno : null).catch(() => undefined)
    }
    else if (final === 'nova_tentativa') r.novasTentativas++
    else if (final === 'incerto') r.incertos++
    else if (final === 'erro') r.erros++
    else if (final === 'pausa') r.pausados++
    if (!resultado.ok && !pausa) logFalhaEnvio('campanha', e.telefone, resultado.erro)

    // Intervalo aleatório entre envios para reduzir risco de bloqueio.
    if (i < lista.length - 1 && !lojasCaidas.has(lista[i + 1].restaurante_id)) await espera(opcoes.intervalo())
  }
  return r
}
