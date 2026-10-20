import type { SupabaseClient } from '@supabase/supabase-js'
import { estadoConexao, evolutionConfigurado, evolutionHeaders, evolutionUrl, type EstadoConexao } from '@/lib/evolution'
import { enviarWhatsapp } from '@/lib/whatsapp'
import { criarAlerta } from '@/lib/financeiro/alertas'
import { avisarPainelPedidoNovo } from '@/lib/push/painel-pedidos'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Monitor do WhatsApp (Etapa 3, 20/10). Checagem LEVE (1 GET connectionState por loja, API da Evolution, gratuita), com
 * throttle de 2 min por loja, chamada por dois caminhos: o cron `/api/cron/whatsapp` (todas as lojas com instância) e a
 * faixa do painel (`/api/admin/whatsapp/alerta`, só a loja aberta). Regras do dono:
 *   · alerta SÓ quando a conexão cai sozinha (desconectar pelo painel marca whatsapp_desconexao_manual_em → silêncio);
 *   · tenta reconectar sozinho (GET /instance/connect: a Evolution retoma a sessão quando ainda vale, sem QR);
 *   · ao voltar, reenvia os avisos automáticos de pedido (pronto/saiu/entregue…) que falharam enquanto estava fora,
 *     só os das últimas 2 h (depois disso não faz mais sentido);
 *   · aviso: faixa vermelha no painel (estado no banco), push ao dono/equipe e alerta grave (Super Admin lê o estado).
 */
export const THROTTLE_MS = 2 * 60_000
const DEDUPE_ALERTA_MS = 6 * 3600_000
const JANELA_REENVIO_MS = 2 * 3600_000

interface Loja { id: string; nome: string; evolution_instance: string | null; whatsapp_estado: string | null; whatsapp_estado_em: string | null; whatsapp_caiu_em: string | null; whatsapp_alertado_em: string | null; whatsapp_desconexao_manual_em: string | null }
const SELECT = 'id, nome, evolution_instance, whatsapp_estado, whatsapp_estado_em, whatsapp_caiu_em, whatsapp_alertado_em, whatsapp_desconexao_manual_em'

export type ResultadoMonitor = 'open' | 'caiu' | 'caiu_manual' | 'reconectou' | 'sem_instancia' | 'pulou' | 'indisponivel'

/** Decide o que fazer com o estado novo. Pura (testada). */
export function decidirMonitor(p: { anterior: string | null; novo: EstadoConexao | null; caiuEm: string | null; manualEm: string | null; alertadoEm: string | null; agora: number }): { estado: string; caiuEm: string | null; alertar: boolean; voltou: boolean; manual: boolean } {
  const agoraIso = new Date(p.agora).toISOString()
  if (p.novo === 'open') return { estado: 'open', caiuEm: null, alertar: false, voltou: !!p.caiuEm || (p.anterior !== null && p.anterior !== 'open'), manual: false }
  const estado = p.novo ?? 'close'
  // Desconexão feita pelo painel nos últimos 30 min: foi de propósito, não alerta.
  const manual = !!p.manualEm && p.agora - Date.parse(p.manualEm) < 30 * 60_000
  const caiuEm = p.caiuEm ?? agoraIso
  const jaAlertou = !!p.alertadoEm && p.agora - Date.parse(p.alertadoEm) < DEDUPE_ALERTA_MS
  return { estado, caiuEm, alertar: !manual && !jaAlertou, voltou: false, manual }
}

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

/** Checa UMA loja (com throttle). `forcar` ignora o throttle (botão/manual). */
export async function monitorarLoja(admin: SupabaseClient, loja: Loja, opcoes: { forcar?: boolean; agora?: number } = {}): Promise<ResultadoMonitor> {
  const agora = opcoes.agora ?? Date.now()
  if (!loja.evolution_instance) {
    if (loja.whatsapp_estado !== 'sem_instancia') await admin.from('restaurantes').update({ whatsapp_estado: 'sem_instancia', whatsapp_estado_em: new Date(agora).toISOString(), whatsapp_caiu_em: null }).eq('id', loja.id)
    return 'sem_instancia'
  }
  if (!opcoes.forcar && loja.whatsapp_estado_em && agora - Date.parse(loja.whatsapp_estado_em) < THROTTLE_MS) return 'pulou'
  if (!evolutionConfigurado()) return 'indisponivel'
  let novo = await estadoConexao(loja.evolution_instance)
  if (novo === null && loja.whatsapp_estado === 'open') {
    // Evolution sem resposta: não derruba o estado por uma falha momentânea; só marca a hora da checagem.
    await admin.from('restaurantes').update({ whatsapp_estado_em: new Date(agora).toISOString() }).eq('id', loja.id)
    return 'indisponivel'
  }
  let reconectou = false
  if (novo !== 'open') {
    const manual = !!loja.whatsapp_desconexao_manual_em && agora - Date.parse(loja.whatsapp_desconexao_manual_em) < 30 * 60_000
    if (!manual) {
      const depois = await tentarReconectar(loja.evolution_instance)
      if (depois === 'open') { novo = 'open'; reconectou = true }
    }
  }
  const d = decidirMonitor({ anterior: loja.whatsapp_estado, novo, caiuEm: loja.whatsapp_caiu_em, manualEm: loja.whatsapp_desconexao_manual_em, alertadoEm: loja.whatsapp_alertado_em, agora })
  const patch: Record<string, unknown> = { whatsapp_estado: d.estado, whatsapp_estado_em: new Date(agora).toISOString(), whatsapp_caiu_em: d.caiuEm }
  if (d.alertar) patch.whatsapp_alertado_em = new Date(agora).toISOString()
  if (d.estado === 'open') patch.whatsapp_alertado_em = null
  await admin.from('restaurantes').update(patch).eq('id', loja.id)

  if (d.estado === 'open') {
    if (d.voltou && loja.whatsapp_caiu_em) {
      const n = await reenviarAvisosFalhados(admin, loja, loja.whatsapp_caiu_em).catch(() => 0)
      await registrarAuditoria(admin, { restauranteId: loja.id, usuarioNome: 'Sistema', acao: 'whatsapp.reconectado', entidade: 'restaurante', entidadeId: loja.id, dados: { sozinho: reconectou, avisosReenviados: n, caiuEm: loja.whatsapp_caiu_em } }).catch(() => null)
      return 'reconectou'
    }
    return 'open'
  }
  if (d.manual) return 'caiu_manual'
  if (d.alertar) {
    const texto = `WhatsApp da loja desconectado desde ${new Date(d.caiuEm as string).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}. Robô, IA e avisos de pedido pararam. Reconecte em Integrações › WhatsApp.`
    await criarAlerta(admin, { restauranteId: loja.id, tipo: 'whatsapp_caiu', gravidade: 'grave', mensagem: texto, dados: { chave: d.caiuEm, estado: d.estado }, dedupeMin: 360, dedupeChave: String(d.caiuEm) }).catch(() => null)
    avisarPainelPedidoNovo(admin, loja.id, { id: `whatsapp:${loja.id}`, numero: null, canal: null }, undefined, { title: '🔴 WhatsApp desconectado', body: 'A conexão caiu sozinha. Reconecte em Integrações › WhatsApp.' }).catch(() => null)
    await registrarAuditoria(admin, { restauranteId: loja.id, usuarioNome: 'Sistema', acao: 'whatsapp.caiu', entidade: 'restaurante', entidadeId: loja.id, dados: { estado: d.estado, caiuEm: d.caiuEm } }).catch(() => null)
  }
  return 'caiu'
}

/** Cron: todas as lojas com instância. */
export async function monitorarTodas(admin: SupabaseClient): Promise<Record<ResultadoMonitor, number>> {
  const resumo: Record<ResultadoMonitor, number> = { open: 0, caiu: 0, caiu_manual: 0, reconectou: 0, sem_instancia: 0, pulou: 0, indisponivel: 0 }
  const { data } = await admin.from('restaurantes').select(SELECT).not('evolution_instance', 'is', null)
  for (const l of (data ?? []) as Loja[]) {
    const r = await monitorarLoja(admin, l).catch(() => 'indisponivel' as const)
    resumo[r]++
  }
  return resumo
}

/** Para a faixa do painel: estado atual da loja (checa com throttle se estiver velho). */
export async function estadoParaPainel(admin: SupabaseClient, restauranteId: string): Promise<{ caiu: boolean; desde: string | null; estado: string | null }> {
  const { data } = await admin.from('restaurantes').select(SELECT).eq('id', restauranteId).maybeSingle()
  if (!data) return { caiu: false, desde: null, estado: null }
  const loja = data as Loja
  await monitorarLoja(admin, loja).catch(() => null)
  const { data: atual } = await admin.from('restaurantes').select('whatsapp_estado, whatsapp_caiu_em, whatsapp_desconexao_manual_em').eq('id', restauranteId).maybeSingle()
  const estado = (atual?.whatsapp_estado as string | null) ?? null
  const manual = !!atual?.whatsapp_desconexao_manual_em && Date.now() - Date.parse(atual.whatsapp_desconexao_manual_em as string) < 30 * 60_000
  const caiu = !!loja.evolution_instance && estado !== null && estado !== 'open' && estado !== 'sem_instancia' && !manual
  return { caiu, desde: (atual?.whatsapp_caiu_em as string | null) ?? null, estado }
}

/** Desconexão pelo painel: registra para o monitor não alertar. */
export async function marcarDesconexaoManual(admin: SupabaseClient, restauranteId: string): Promise<void> {
  await admin.from('restaurantes').update({ whatsapp_desconexao_manual_em: new Date().toISOString(), whatsapp_estado: 'close', whatsapp_estado_em: new Date().toISOString(), whatsapp_caiu_em: null, whatsapp_alertado_em: null }).eq('id', restauranteId)
}
