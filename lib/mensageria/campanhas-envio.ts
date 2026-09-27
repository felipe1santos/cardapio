/**
 * Disparo das campanhas (cron /api/cron/campanhas), pela fila da 0104.
 *
 * campanha_reservar_envios escolhe e trava (skip locked: dois crons nunca pegam o mesmo
 * envio), expira o que passou de 24h do horário agendado e transforma trava vencida em
 * 'incerto' — sem reenviar. campanha_concluir_envio grava o resultado: transitório volta
 * para a fila (até 3 tentativas), definitivo vira erro, tempo esgotado vira 'incerto'.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { logFalhaEnvio, type ProvedorWhatsapp, type ResultadoEnvio } from './provedor'
import { montarTextoCampanha } from './campanhas'
import { telefoneWhatsapp } from '@/lib/telefone-br'

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
}

export interface ResumoCampanhas {
  processados: number
  enviados: number
  novasTentativas: number
  erros: number
  incertos: number
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function enviarUm(provedor: ProvedorWhatsapp, e: EnvioReservado): Promise<ResultadoEnvio> {
  if (!e.evolution_instance) return { ok: false, tipo: 'definitivo', erro: 'Instância WhatsApp não configurada' }
  const numero = telefoneWhatsapp(e.telefone)
  if (!numero) return { ok: false, tipo: 'definitivo', erro: 'Telefone inválido' }
  const texto = montarTextoCampanha(e.mensagem, { incluirLink: e.incluir_link, token: e.token })
  if (e.tipo_mensagem === 'imagem' && e.imagem_url) return provedor.enviarImagem(e.evolution_instance, numero, e.imagem_url, texto)
  if (e.tipo_mensagem === 'audio' && e.audio_url) return provedor.enviarAudio(e.evolution_instance, numero, e.audio_url)
  if (!texto.trim()) return { ok: false, tipo: 'definitivo', erro: 'Mensagem vazia' }
  return provedor.enviarTexto(e.evolution_instance, numero, texto)
}

export async function processarCampanhas(
  admin: SupabaseClient,
  provedor: ProvedorWhatsapp,
  opcoes: { limite: number; intervalo: () => number },
): Promise<ResumoCampanhas> {
  const r: ResumoCampanhas = { processados: 0, enviados: 0, novasTentativas: 0, erros: 0, incertos: 0 }
  const { data, error } = await admin.rpc('campanha_reservar_envios', { p_limite: opcoes.limite })
  if (error) throw error
  const lista = (data ?? []) as EnvioReservado[]

  for (let i = 0; i < lista.length; i++) {
    const e = lista[i]
    let resultado: ResultadoEnvio
    try {
      resultado = await enviarUm(provedor, e)
    } catch (err) {
      resultado = { ok: false, tipo: 'transitorio', erro: (err as Error).message ?? 'falha' }
    }
    const { data: final, error: errFim } = await admin.rpc('campanha_concluir_envio', {
      p_id: e.id,
      p_resultado: resultado.ok ? 'enviado' : resultado.tipo,
      p_id_externo: resultado.ok ? resultado.idExterno : null,
      p_erro: resultado.ok ? null : resultado.erro,
    })
    if (errFim) throw errFim
    r.processados++
    if (final === 'enviado') r.enviados++
    else if (final === 'nova_tentativa') r.novasTentativas++
    else if (final === 'incerto') r.incertos++
    else if (final === 'erro') r.erros++
    if (!resultado.ok) logFalhaEnvio('campanha', e.telefone, resultado.erro)

    // Intervalo aleatório entre envios para reduzir risco de bloqueio.
    if (i < lista.length - 1) await espera(opcoes.intervalo())
  }
  return r
}
