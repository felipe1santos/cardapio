import fs from 'node:fs'
import os from 'node:os'
import type { SupabaseClient } from '@supabase/supabase-js'
import { limiteDiario, type ApiPaga } from '@/lib/custo/guarda'
import { limitesIa } from '@/lib/custo/ia'
import { diaSP, limiteDoPainel } from '@/lib/custo/uso'
import { avaliar, cronsAtrasados, horaDoResumo, JANELA_ALERTA_MS, medidasVazias, podeEnviar, textoResumo, type Alerta, type Medidas } from './avaliar'
import { enviarAlertaSistema } from './enviar'

/**
 * Vigia da saúde do sistema (28/10/2026, Etapa 7 da varredura). Roda dentro do cron do WhatsApp (1/min) e trabalha
 * no máximo a cada 5 min — a trava é a última foto gravada no banco, então dois processos ou um deploy não duplicam.
 * Custo: ~8 consultas leves por rodada (~2.300/dia), nenhuma API paga. Alertas: 1 por assunto a cada 6 h; resumo às 09:00.
 */
export const INTERVALO_MS = 5 * 60_000
/** Bytes de egress por requisição PostgREST (medido em 22/10: ~1,2 KB, quase tudo cabeçalho) e fatia do PostgREST (88%). */
const BYTES_POR_REQ = 1200
const FATIA_POSTGREST = 0.88

const APIS_TOTAL: string[] = ['geocoding', 'directions', 'places', 'ia', 'lalamove', 'ifood_entrega', 'foody', 'machine', 'uber', 'maps_js']

function restrito(msg: string | undefined | null): string | null {
  return msg && /restricted|exceed_|quota/i.test(msg) ? msg : null
}

/** Média de requisições/min dos últimos 7 dias — recalculada 1×/h (lê ~2 mil fotos só com o número). */
let media: { valor: number | null; em: number } = { valor: null, em: 0 }
async function mediaReq(admin: SupabaseClient, agora: number): Promise<number | null> {
  if (agora - media.em < 3600_000) return media.valor
  const { data } = await admin.from('sistema_saude_fotos').select('rpm:dados->reqPorMin').gte('em', new Date(agora - 7 * 86400_000).toISOString()).limit(2100)
  const v = ((data ?? []) as { rpm: number | null }[]).map((r) => Number(r.rpm)).filter((n) => Number.isFinite(n) && n >= 0)
  media = { valor: v.length >= 12 ? v.reduce((s, n) => s + n, 0) / v.length : null, em: agora }
  return media.valor
}

function vps(): Pick<Medidas, 'cpuCarga' | 'memLivrePct' | 'discoUsadoPct'> {
  const out: Pick<Medidas, 'cpuCarga' | 'memLivrePct' | 'discoUsadoPct'> = { cpuCarga: null, memLivrePct: null, discoUsadoPct: null }
  try { out.cpuCarga = os.loadavg()[0] / Math.max(1, os.cpus().length) } catch { /* sem dado */ }
  try {
    // No container, /proc/meminfo é o da VPS. "Disponível" conta o cache que o sistema devolve na hora.
    const mi = fs.readFileSync('/proc/meminfo', 'utf8')
    const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(mi)?.[1])
    const total = kb('MemTotal'), disp = kb('MemAvailable')
    if (total > 0 && disp >= 0) out.memLivrePct = (disp / total) * 100
  } catch { /* fora do Linux */ }
  try {
    const s = fs.statfsSync('/')
    if (s.blocks > 0) out.discoUsadoPct = (1 - s.bavail / s.blocks) * 100
  } catch { /* sem dado */ }
  return out
}

export async function coletar(admin: SupabaseClient, agora: Date, anterior: { em: string; req_postgrest: number | null } | null): Promise<{ m: Medidas; req: number | null; consultas: number | null }> {
  const m: Medidas = { ...medidasVazias(agora.toISOString()), ...vps() }
  const hoje = diaSP(agora)
  const [cont, usos, ia, crons, lojasWa] = await Promise.all([
    admin.rpc('sistema_saude_contadores'),
    admin.from('api_uso_dia').select('api, escopo, chamadas').eq('dia', hoje).limit(2000),
    admin.from('ia_uso_dia').select('custo_micro_usd').eq('dia', hoje).eq('escopo', 'total').limit(100),
    admin.from('sistema_cron_batidas').select('nome, ultima_em'),
    admin.from('restaurantes').select('nome, whatsapp_caiu_em').not('whatsapp_caiu_em', 'is', null).is('whatsapp_desconexao_manual_em', null).limit(200),
  ])
  m.bancoRestrito = restrito(cont.error?.message) ?? restrito(usos.error?.message)
  const c = cont.data as { req_postgrest?: number; consultas?: number; db_bytes?: number } | null
  const req = c?.req_postgrest != null ? Number(c.req_postgrest) : null
  if (c?.db_bytes != null) m.dbBytes = Number(c.db_bytes)
  if (req !== null && anterior?.req_postgrest != null) {
    const min = (agora.getTime() - Date.parse(anterior.em)) / 60_000
    // Contador zerado (reset das estatísticas) dá delta negativo: sem número nesta rodada.
    if (min > 0.5 && req >= anterior.req_postgrest) m.reqPorMin = (req - Number(anterior.req_postgrest)) / min
  }
  m.reqMediaPorMin = await mediaReq(admin, agora.getTime()).catch(() => null)
  const base = m.reqMediaPorMin ?? m.reqPorMin
  if (base !== null) m.egressMesGb = (base * 1440 * 30 * BYTES_POR_REQ) / FATIA_POSTGREST / 1e9

  const linhas = ((usos.data ?? []) as { api: string; escopo: string; chamadas: number }[]).filter((l) => !l.api.includes(':'))
  const limite = (api: string) => (api === 'maps_js' ? limiteDoPainel('maps_js') : limiteDiario(api as ApiPaga))
  const totais = new Map(linhas.filter((l) => l.escopo === 'total').map((l) => [l.api, Number(l.chamadas)]))
  m.apis = [...totais].filter(([api]) => APIS_TOTAL.includes(api)).map(([api, chamadas]) => ({ api, chamadas, limite: limite(api) }))
  const porLoja = linhas.filter((l) => l.escopo !== 'total')
  if (porLoja.length) {
    const ids = [...new Set(porLoja.map((l) => l.escopo))]
    const { data: nomes } = await admin.from('restaurantes').select('id, nome').in('id', ids)
    const nome = new Map(((nomes ?? []) as { id: string; nome: string }[]).map((r) => [r.id, r.nome]))
    for (const l of porLoja) {
      // Áudio tem limite POR LOJA; as outras APIs, limite do sistema todo.
      if (l.api === 'audio') m.apis.push({ api: `audio (${nome.get(l.escopo) ?? 'loja'})`, chamadas: Number(l.chamadas), limite: limiteDiario('audio') })
      else if (APIS_TOTAL.includes(l.api)) m.lojasApi.push({ loja: nome.get(l.escopo) ?? 'loja', api: l.api, chamadas: Number(l.chamadas), totalApi: totais.get(l.api) ?? 0, limite: limite(l.api) })
    }
  }
  const iaUsd = ((ia.data ?? []) as { custo_micro_usd: number }[]).reduce((s, l) => s + (Number(l.custo_micro_usd) || 0), 0) / 1e6
  m.iaUsd = { gasto: iaUsd, teto: limitesIa().usdDia }
  m.cronsAtrasados = cronsAtrasados((crons.data ?? []) as { nome: string; ultima_em: string }[], agora.getTime())
  m.whatsappCaido = ((lojasWa.data ?? []) as { nome: string; whatsapp_caiu_em: string }[])
    .map((l) => ({ loja: l.nome, minutos: Math.floor((agora.getTime() - Date.parse(l.whatsapp_caiu_em)) / 60_000) }))
    .filter((l) => l.minutos >= 10)
  return { m, req, consultas: c?.consultas != null ? Number(c.consultas) : null }
}

/** Trava em memória para quando o banco está fora (não dá para ler o histórico de alertas). */
const enviadosSemBanco = new Map<string, number>()

async function mandar(admin: SupabaseClient, a: { assunto: string; nivel: Alerta['nivel'] | 'resumo' | 'teste'; titulo: string; texto: string }, gravar: boolean) {
  const r = await enviarAlertaSistema(admin, a.titulo, a.texto)
  if (gravar) {
    await admin.from('sistema_alertas').insert({ assunto: a.assunto, nivel: a.nivel, texto: a.texto, canal: r.canal, enviado: r.canal !== 'nenhum', erro: r.erro })
  }
  return r
}

export async function rodarVigia(admin: SupabaseClient, agora = new Date()): Promise<{ rodou: boolean; alertas?: string[]; enviados?: number; erro?: string }> {
  const { data: ult, error: eUlt } = await admin.from('sistema_saude_fotos').select('em, req_postgrest').order('em', { ascending: false }).limit(1).maybeSingle()
  const bloqueio = restrito(eUlt?.message)
  if (bloqueio) {
    // Banco recusando: avisa pelo WhatsApp (Evolution não depende do Supabase) com a trava em memória.
    const a = avaliar({ ...medidasVazias(agora.toISOString()), bancoRestrito: bloqueio })[0]
    const antes = enviadosSemBanco.get(a.assunto)
    if (antes && agora.getTime() - antes < JANELA_ALERTA_MS) return { rodou: false, erro: 'banco fora; alerta já enviado' }
    enviadosSemBanco.set(a.assunto, agora.getTime())
    await mandar(admin, a, false)
    return { rodou: true, alertas: [a.assunto], enviados: 1 }
  }
  const anterior = ult as { em: string; req_postgrest: number | null } | null
  if (anterior && agora.getTime() - Date.parse(anterior.em) < INTERVALO_MS - 15_000) return { rodou: false }

  const { m, req, consultas } = await coletar(admin, agora, anterior)
  await admin.from('sistema_saude_fotos').insert({ em: agora.toISOString(), req_postgrest: req, consultas, dados: m })
  const alertas = avaliar(m)
  const { data: hist } = await admin.from('sistema_alertas').select('assunto, nivel, criado_em').gte('criado_em', new Date(agora.getTime() - 26 * 3600_000).toISOString()).order('criado_em', { ascending: false }).limit(500)
  const historico = (hist ?? []) as { assunto: string; nivel: string; criado_em: string }[]
  let enviados = 0
  for (const a of alertas) {
    if (!podeEnviar(historico, a, agora.getTime())) continue
    await mandar(admin, a, true)
    enviados++
  }
  const ultimoResumo = historico.find((h) => h.nivel === 'resumo')?.criado_em ?? null
  if (horaDoResumo(agora, ultimoResumo)) {
    await mandar(admin, { assunto: 'resumo-diario', nivel: 'resumo', titulo: 'Resumo do dia', texto: textoResumo(m, alertas) }, true)
    enviados++
    // Limpeza das próprias tabelas, 1×/dia junto com o resumo: fotos 30 dias, alertas 180 dias.
    await admin.from('sistema_saude_fotos').delete().lt('em', new Date(agora.getTime() - 30 * 86400_000).toISOString())
    await admin.from('sistema_alertas').delete().lt('criado_em', new Date(agora.getTime() - 180 * 86400_000).toISOString())
  }
  return { rodou: true, alertas: alertas.map((a) => `${a.assunto}:${a.nivel}`), enviados }
}

/** Alerta de teste (pedido do dono): mostra o formato e confirma que o canal chega. */
export async function alertaDeTeste(admin: SupabaseClient, agora = new Date()) {
  const { m } = await coletar(admin, agora, null)
  const texto = `🧪 Menuzia — alerta de teste\nO vigia da saúde do sistema está ligado. Assim chega um aviso quando algo sair do normal.\n${textoResumo(m, avaliar(m)).split('\n').slice(1).join('\n')}`
  return mandar(admin, { assunto: 'teste', nivel: 'teste', titulo: 'Alerta de teste', texto }, true)
}
