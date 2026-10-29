import type { SupabaseClient } from '@supabase/supabase-js'
import { estadoConexao, evolutionConfigurado, evolutionHeaders, evolutionUrl, type EstadoConexao } from '@/lib/evolution'
import { enviarWhatsapp } from '@/lib/whatsapp'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Monitor do WhatsApp. Regra do dono (28/10/2026, auditoria das travas): WhatsApp é OPCIONAL.
 *   · Loja conectada e em uso: o cron confere a cada 2 min (1 GET connectionState na Evolution, gratuito) e o webhook
 *     CONNECTION_UPDATE avisa na hora.
 *   · Queda momentânea (rede, 503, 408…): até 3 tentativas de reconectar NO TOTAL (GET /instance/connect retoma a sessão
 *     sem QR). Não voltou → DESCONECTADA em silêncio.
 *   · Desconectada (manual pelo painel, 401 = deslogou no celular, 440 = sessão aberta em outro lugar, ou depois das 3
 *     tentativas): marcada UMA vez e PARA — o cron não confere mais, o webhook ignora os eventos dela (sem consulta, ver
 *     lib/mensageria/entrada.ts), sem reconexão, sem aviso repetido. Volta a ser vigiada quando o dono lê o QR (evento
 *     "open" ou a tela de Integrações vê "open").
 *   · Avisos: nada para a loja (só o "Conectar WhatsApp" em Integrações). Super Admin: 1 aviso quando uma loja que estava
 *     em uso cai sozinha; desconexão manual não avisa.
 *   · Ao voltar, reenvia os avisos automáticos de pedido que falharam nas últimas 2 h.
 * Antes (20–27/10): conferia todas as lojas (inclusive desconectadas há dias), regravava o estado a cada conferência,
 * faixa vermelha + push + alerta na loja e lembrete a cada 24 h; em 27/10 a reconexão em 440 virou pingue-pongue.
 */
export const THROTTLE_MS = 2 * 60_000
export const MAX_TENTATIVAS = 3
const MANUAL_MS = 30 * 60_000
const JANELA_REENVIO_MS = 2 * 3600_000

interface Loja { id: string; nome: string; evolution_instance: string | null; whatsapp_estado: string | null; whatsapp_estado_em: string | null; whatsapp_caiu_em: string | null; whatsapp_alertado_em: string | null; whatsapp_desconexao_manual_em: string | null }
const SELECT = 'id, nome, evolution_instance, whatsapp_estado, whatsapp_estado_em, whatsapp_caiu_em, whatsapp_alertado_em, whatsapp_desconexao_manual_em'

export type ResultadoMonitor = 'open' | 'caiu' | 'caiu_manual' | 'reconectou' | 'desconectada' | 'parado' | 'sem_instancia' | 'pulou' | 'indisponivel'

/** O cron confere esta loja? Só conectada, em reconexão ou nunca conferida. Pura. */
export function deveVigiar(estado: string | null): boolean {
  return estado === null || estado === 'open' || estado === 'connecting'
}

export interface Decisao { estado: string; caiuEm: string | null; reconectar: boolean; avisarSuperadmin: boolean; voltou: boolean; mudou: boolean }

/** Decide o que fazer com o estado lido. Pura (testada). */
export function decidirMonitor(p: { anterior: string | null; novo: EstadoConexao | null; caiuEm: string | null; manualEm: string | null; motivo?: number | string | null; tentativas: number; agora: number }): Decisao {
  const nada = { reconectar: false, avisarSuperadmin: false, voltou: false }
  if (p.novo === null) return { ...nada, estado: p.anterior ?? 'close', caiuEm: p.caiuEm, mudou: false }
  if (p.novo === 'open') return { ...nada, estado: 'open', caiuEm: null, voltou: p.anterior !== null && p.anterior !== 'open', mudou: p.anterior !== 'open' }
  // Já desconectada: fica assim até o dono ler o QR.
  if (p.anterior === 'close') return { ...nada, estado: 'close', caiuEm: p.caiuEm, mudou: false }
  const caiuEm = p.caiuEm ?? new Date(p.agora).toISOString()
  const fechar = (avisar: boolean): Decisao => ({ ...nada, estado: 'close', caiuEm, avisarSuperadmin: avisar, mudou: true })
  // Desconectou pelo painel (o close do logout pode chegar minutos depois do clique): silêncio.
  if (p.manualEm && Date.parse(caiuEm) >= Date.parse(p.manualEm) && Date.parse(caiuEm) - Date.parse(p.manualEm) < MANUAL_MS) return fechar(false)
  // Nunca vista conectada: não estava em uso.
  if (p.anterior === null) return fechar(false)
  const motivo = Number(p.motivo)
  if (motivo === 401 || motivo === 440) return fechar(true)
  if (p.tentativas >= MAX_TENTATIVAS) return fechar(true)
  return { ...nada, estado: 'connecting', caiuEm, reconectar: true, mudou: p.anterior !== 'connecting' || p.caiuEm === null }
}

/** Tentativas de reconectar da queda atual, por loja (em memória do processo; zera quando volta ou desconecta). */
const tentativas = new Map<string, number>()
/** Última conferência por loja (em memória): o throttle não precisa regravar o banco a cada conferência. */
const conferida = new Map<string, number>()

/** Tenta retomar a sessão sem QR. Devolve o estado depois da tentativa (ou null se a Evolution não respondeu). */
async function tentarReconectar(instance: string): Promise<EstadoConexao | null> {
  try {
    await fetch(evolutionUrl(`/instance/connect/${instance}`), { headers: evolutionHeaders(), signal: AbortSignal.timeout(8000) })
  } catch { return null }
  await new Promise((r) => setTimeout(r, 1500))
  return estadoConexao(instance)
}

/** Reenvia os avisos automáticos que falharam na janela da queda (até 2 h). Devolve quantos saíram. */
async function reenviarAvisosFalhados(admin: SupabaseClient, loja: Loja, desde: string): Promise<number> {
  const limite = new Date(Math.max(Date.parse(desde), Date.now() - JANELA_REENVIO_MS)).toISOString()
  const { data } = await admin.from('whatsapp_mensagens').select('id, texto, conversa_id, whatsapp_conversas ( telefone )')
    .eq('restaurante_id', loja.id).eq('direcao', 'loja').eq('origem', 'automatico').eq('status_envio', 'falhou').gte('criado_em', limite).order('criado_em').limit(50)
  let enviados = 0
  for (const m of data ?? []) {
    const conv = (Array.isArray(m.whatsapp_conversas) ? m.whatsapp_conversas[0] : m.whatsapp_conversas) as { telefone?: string } | null
    const telefone = conv?.telefone
    if (!telefone || !m.texto || !loja.evolution_instance) continue
    const ok = await enviarWhatsapp(telefone, m.texto as string, loja.evolution_instance, { admin, origem: 'automatico', restauranteId: loja.id })
    if (ok) { enviados++; await admin.from('whatsapp_mensagens').update({ status_envio: 'reenviado', erro: null }).eq('id', m.id) }
  }
  return enviados
}

/** 1 aviso ao Super Admin (pendente; o cron envia — lib/saude/vigia.ts › despacharPendentes). */
async function avisarSuperadmin(admin: SupabaseClient, loja: Loja, caiuEm: string, motivo: number | string | null | undefined) {
  const porque = Number(motivo) === 401 ? 'o WhatsApp foi deslogado no celular' : Number(motivo) === 440 ? 'o número foi aberto em outro lugar' : 'a conexão caiu e não voltou em 3 tentativas'
  await admin.from('sistema_alertas').insert({
    assunto: `whatsapp:${loja.id}:${caiuEm}`, nivel: 'amarelo', canal: null, enviado: false,
    texto: `🟡 Menuzia — WhatsApp da loja ${loja.nome} desconectado\nA loja estava usando o WhatsApp e ${porque}. Ela fica desconectada até ler o QR de novo em Integrações (o painel dela não é cobrado).\nO que fazer: avisar a loja só se ela depender do WhatsApp agora.`,
  }).then(() => null, () => null)
  ;(globalThis as unknown as { __menuziaAlertaPendente?: boolean }).__menuziaAlertaPendente = true
}

/** Confere UMA loja. `forcar` ignora o throttle (evento do webhook). */
export async function monitorarLoja(admin: SupabaseClient, loja: Loja, opcoes: { forcar?: boolean; agora?: number; motivo?: number | string | null } = {}): Promise<ResultadoMonitor> {
  const agora = opcoes.agora ?? Date.now()
  if (!loja.evolution_instance) {
    if (loja.whatsapp_estado !== 'sem_instancia') await admin.from('restaurantes').update({ whatsapp_estado: 'sem_instancia', whatsapp_estado_em: new Date(agora).toISOString(), whatsapp_caiu_em: null }).eq('id', loja.id)
    return 'sem_instancia'
  }
  if (!opcoes.forcar) {
    if (!deveVigiar(loja.whatsapp_estado)) return 'parado'
    const ultima = conferida.get(loja.id)
    if (ultima && agora - ultima < THROTTLE_MS) return 'pulou'
  }
  if (!evolutionConfigurado()) return 'indisponivel'
  conferida.set(loja.id, agora)
  const novo = await estadoConexao(loja.evolution_instance)
  let d = decidirMonitor({ anterior: loja.whatsapp_estado, novo, caiuEm: loja.whatsapp_caiu_em, manualEm: loja.whatsapp_desconexao_manual_em, motivo: opcoes.motivo, tentativas: tentativas.get(loja.id) ?? 0, agora })
  let reconectou = false
  if (d.reconectar) {
    tentativas.set(loja.id, (tentativas.get(loja.id) ?? 0) + 1)
    if ((await tentarReconectar(loja.evolution_instance)) === 'open') {
      reconectou = true
      d = decidirMonitor({ anterior: 'connecting', novo: 'open', caiuEm: d.caiuEm, manualEm: null, tentativas: 0, agora })
    }
  }
  if (d.estado !== 'connecting') tentativas.delete(loja.id)
  if (!d.mudou && !reconectou) return d.estado === 'open' ? 'open' : d.estado === 'close' ? 'parado' : 'caiu'

  const patch = { whatsapp_estado: d.estado, whatsapp_estado_em: new Date(agora).toISOString(), whatsapp_caiu_em: d.caiuEm, ...(d.estado === 'open' ? { whatsapp_alertado_em: null } : {}) }
  if (d.estado === 'open' && d.voltou && loja.whatsapp_caiu_em) {
    // Só quem "pega" a volta reenvia os avisos (revisão 26/10): evento + cron ao mesmo tempo mandavam em dobro.
    const { data: pegou } = await admin.from('restaurantes').update(patch).eq('id', loja.id).eq('whatsapp_caiu_em', loja.whatsapp_caiu_em).select('id').maybeSingle()
    if (!pegou) return 'open'
    const n = await reenviarAvisosFalhados(admin, loja, loja.whatsapp_caiu_em).catch(() => 0)
    await registrarAuditoria(admin, { restauranteId: loja.id, usuarioNome: 'Sistema', acao: 'whatsapp.reconectado', entidade: 'restaurante', entidadeId: loja.id, dados: { sozinho: reconectou, avisosReenviados: n, caiuEm: loja.whatsapp_caiu_em } }).catch(() => null)
    return 'reconectou'
  }
  await admin.from('restaurantes').update(patch).eq('id', loja.id)
  if (d.estado === 'open') return 'open'
  if (d.estado === 'connecting') return 'caiu'
  // Desconectada agora (uma vez só).
  if (d.avisarSuperadmin) {
    await avisarSuperadmin(admin, loja, d.caiuEm as string, opcoes.motivo)
    await registrarAuditoria(admin, { restauranteId: loja.id, usuarioNome: 'Sistema', acao: 'whatsapp.caiu', entidade: 'restaurante', entidadeId: loja.id, dados: { estado: 'close', caiuEm: d.caiuEm, motivo: opcoes.motivo ?? null } }).catch(() => null)
    return 'desconectada'
  }
  return 'caiu_manual'
}

/**
 * Evento de conexão do webhook: loja já desconectada → ignora (só "open" — o dono leu o QR — a traz de volta); mesmo
 * estado já gravado → ignora; mudança → confere na Evolution com o motivo (401/440 não reconectam).
 */
export async function aplicarEventoConexao(admin: SupabaseClient, restauranteId: string, conexao: { estado: string; motivo: number | string | null }): Promise<ResultadoMonitor | 'sem_loja'> {
  const { data } = await admin.from('restaurantes').select(SELECT).eq('id', restauranteId).maybeSingle()
  if (!data) return 'sem_loja'
  const loja = data as Loja
  if (loja.whatsapp_estado === 'close' && conexao.estado !== 'open') return 'parado'
  if (conexao.estado === loja.whatsapp_estado) return 'pulou'
  if (conexao.estado !== 'open') {
    await registrarAuditoria(admin, { restauranteId, usuarioNome: 'Sistema', acao: 'whatsapp.conexao', entidade: 'restaurante', entidadeId: restauranteId, dados: { estado: conexao.estado, motivo: conexao.motivo } }).catch(() => null)
  }
  return monitorarLoja(admin, loja, { forcar: true, motivo: conexao.motivo })
}

/** Cron: só as lojas que ainda devem ser vigiadas (conectadas, em reconexão ou nunca conferidas). */
export async function monitorarTodas(admin: SupabaseClient): Promise<Record<ResultadoMonitor, number>> {
  const resumo: Record<ResultadoMonitor, number> = { open: 0, caiu: 0, caiu_manual: 0, reconectou: 0, desconectada: 0, parado: 0, sem_instancia: 0, pulou: 0, indisponivel: 0 }
  const { data } = await admin.from('restaurantes').select(SELECT).not('evolution_instance', 'is', null)
    .or('whatsapp_estado.is.null,whatsapp_estado.eq.open,whatsapp_estado.eq.connecting')
  for (const l of (data ?? []) as Loja[]) {
    const r = await monitorarLoja(admin, l).catch(() => 'indisponivel' as const)
    resumo[r]++
  }
  return resumo
}

/**
 * Tela de Integrações viu "open" (o dono leu o QR): volta a vigiar a loja e reenvia o que falhou. Sem Evolution aqui —
 * quem chama já leu o estado.
 */
export async function marcarConectadaPeloPainel(admin: SupabaseClient, restauranteId: string): Promise<void> {
  const { data } = await admin.from('restaurantes').select(SELECT).eq('id', restauranteId).maybeSingle()
  const loja = data as Loja | null
  if (!loja || loja.whatsapp_estado === 'open') return
  tentativas.delete(loja.id)
  const patch = { whatsapp_estado: 'open', whatsapp_estado_em: new Date().toISOString(), whatsapp_caiu_em: null, whatsapp_alertado_em: null }
  if (!loja.whatsapp_caiu_em) { await admin.from('restaurantes').update(patch).eq('id', loja.id); return }
  const { data: pegou } = await admin.from('restaurantes').update(patch).eq('id', loja.id).eq('whatsapp_caiu_em', loja.whatsapp_caiu_em).select('id').maybeSingle()
  if (pegou) await reenviarAvisosFalhados(admin, loja, loja.whatsapp_caiu_em).catch(() => 0)
}

/** Desconexão pelo painel: desconectada em silêncio (sem aviso, sem reconexão). */
export async function marcarDesconexaoManual(admin: SupabaseClient, restauranteId: string): Promise<void> {
  tentativas.delete(restauranteId)
  await admin.from('restaurantes').update({ whatsapp_desconexao_manual_em: new Date().toISOString(), whatsapp_estado: 'close', whatsapp_estado_em: new Date().toISOString(), whatsapp_caiu_em: null, whatsapp_alertado_em: null }).eq('id', restauranteId)
}
