import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarApiPaga, limiteDiario } from './guarda'
import { contarSemTrava, diaSP } from './uso'
import { avisarSuporte } from './alerta-whatsapp'

/**
 * IA DE ATENDIMENTO (Claude, Anthropic — 11/10/2026; antes preparada para a OpenAI) — contador e teto de gasto
 * (docs/REGRAS-DE-CUSTO.md). Toda chamada à IA passa por `chamarIa()` (a requisição em si está em ./anthropic.ts):
 *   1. TETO em dinheiro: se o gasto de hoje já chegou ao limite (sistema ou loja), NÃO chama;
 *   2. a guarda comum (`chamarApiPaga`, api 'ia'): trava de disparo (mesma conversa > 20/min) e limite de chamadas/dia;
 *   3. depois da resposta, grava tokens e custo REAIS (inclusive cache) em ia_uso_dia (0174), por loja e no total.
 * O Super Admin lê isso em `lerUsoIa()`.
 *
 * Limites (Coolify): LIMITE_IA_USD_DIA (5 = US$ 5/dia no sistema todo), LIMITE_IA_USD_DIA_LOJA (0,5 = US$ 0,50/dia por
 * loja; cada loja pode ter o seu em whatsapp_robo_config.ia_teto_usd_dia, editado no Super Admin), LIMITE_IA_CHAMADAS_DIA
 * (2000). Cotação para exibir em reais: COTACAO_DOLAR (5,50). Chave: ANTHROPIC_API_KEY (só servidor, sem Build time).
 */

export interface PrecoIa { entrada: number; saida: number; cacheEscrita: number; cacheLeitura: number }
/**
 * US$ por 1 milhão de tokens. Conferido em platform.claude.com/docs/en/about-claude/pricing em 11/10/2026.
 * Haiku 5.5 com prompt acima de 100 mil tokens paga 5× (PROMPT_LONGO).
 */
export const PRECOS_IA: Record<string, PrecoIa> = {
  'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, cacheEscrita: 0.125, cacheLeitura: 0.01 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheEscrita: 2.5, cacheLeitura: 0.1 },
  'claude-opus-5-5': { entrada: 4, saida: 20, cacheEscrita: 5, cacheLeitura: 0.2 },
  // Transcrição de áudio (OpenAI, 20/10): US$ 3/M tokens de áudio na entrada (texto da entrada cobrado como áudio — nunca
  // subestima), US$ 5/M na saída ≈ US$ 0,003/min. Conferido em platform.openai.com/docs/pricing em 20/10/2026.
  'gpt-4o-mini-transcribe': { entrada: 3, saida: 5, cacheEscrita: 0, cacheLeitura: 0 },
}
/** Modelo desconhecido: cobra como o mais caro da tabela — o contador nunca subestima. */
const PRECO_DESCONHECIDO: PrecoIa = PRECOS_IA['claude-opus-5-5']
const PROMPT_LONGO = 100_000

function precoDoModelo(modelo: string, env: Record<string, string | undefined>): PrecoIa {
  try {
    const extra = env.IA_PRECOS ? (JSON.parse(env.IA_PRECOS) as Record<string, number[]>) : {}
    const x = extra[modelo]
    if (Array.isArray(x) && x.length === 4 && x.every((n) => Number.isFinite(n) && n >= 0)) return { entrada: x[0], saida: x[1], cacheEscrita: x[2], cacheLeitura: x[3] }
  } catch { /* IA_PRECOS inválido: usa a tabela */ }
  const base = Object.keys(PRECOS_IA).filter((m) => modelo === m || modelo.startsWith(`${m}-`)).sort((a, b) => b.length - a.length)[0]
  return base ? PRECOS_IA[base] : PRECO_DESCONHECIDO
}

export interface UsoTokens { entrada: number; saida: number; cacheEscrita?: number; cacheLeitura?: number }

/** Custo de uma resposta em micro-dólares (US$ 1 = 1.000.000), arredondado para cima. Pura. */
export function custoMicroUsd(modelo: string, uso: UsoTokens, env: Record<string, string | undefined> = process.env): number {
  const p = precoDoModelo(modelo, env)
  const n = (v: number | undefined) => Math.max(0, Number(v) || 0)
  const ent = n(uso.entrada), sai = n(uso.saida), ce = n(uso.cacheEscrita), cl = n(uso.cacheLeitura)
  const longo = modelo.startsWith('claude-haiku-5-5') && ent + ce + cl > PROMPT_LONGO ? 5 : 1
  // Arredonda o ruído de ponto flutuante (650,0000001) antes de subir para o micro-dólar inteiro.
  return Math.ceil(Math.round((ent * p.entrada + sai * p.saida + ce * p.cacheEscrita + cl * p.cacheLeitura) * longo * 1e6) / 1e6)
}

const numEnv = (v: string | undefined, padrao: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : padrao }
export function limitesIa(env: Record<string, string | undefined> = process.env) {
  return {
    usdDia: numEnv(env.LIMITE_IA_USD_DIA, 5),
    usdDiaLoja: numEnv(env.LIMITE_IA_USD_DIA_LOJA, 0.5),
    chamadasDia: limiteDiario('ia', env),
    cotacao: numEnv(env.COTACAO_DOLAR, 5.5) || 5.5,
  }
}

export type RespostaIa<T> = { valor: T; modelo: string; uso: UsoTokens }
export type ResultadoIa<T> = { ok: true; valor: T; custoMicroUsd: number } | { ok: false; motivo: 'teto' | 'disparo' | 'limite' | 'banco' | 'erro'; erro?: string }

async function gastoHoje(admin: SupabaseClient, escopo: string): Promise<number | null> {
  const { data, error } = await admin.from('ia_uso_dia').select('custo_micro_usd').eq('dia', diaSP()).eq('escopo', escopo).limit(100)
  if (error) return null
  return ((data ?? []) as { custo_micro_usd: number }[]).reduce((s, l) => s + (Number(l.custo_micro_usd) || 0), 0)
}

/** Gasto de hoje da loja em micro-dólares (tela Ajustes › Agente de IA). */
export async function gastoIaHojeDaLoja(admin: SupabaseClient, loja: string): Promise<number> {
  return (await gastoHoje(admin, loja)) ?? 0
}

/**
 * Chama a IA só se o teto em dinheiro e a guarda deixarem. `conversa` identifica a conversa (trava de disparo);
 * `tetoLojaUsd` é o teto próprio da loja (nulo = padrão). `chamar` faz a requisição e devolve os tokens que a API
 * informou. Quem chama trata { ok: false } com a reserva (o robô padrão responde).
 */
export async function chamarIa<T>(
  admin: SupabaseClient,
  p: { loja: string | null; conversa: string; tetoLojaUsd?: number | null },
  chamar: () => Promise<RespostaIa<T>>,
): Promise<ResultadoIa<T>> {
  const lim = limitesIa()
  const tetoLoja = p.tetoLojaUsd !== null && p.tetoLojaUsd !== undefined && Number.isFinite(Number(p.tetoLojaUsd)) ? Number(p.tetoLojaUsd) : lim.usdDiaLoja
  const [total, daLoja] = await Promise.all([gastoHoje(admin, 'total'), p.loja ? gastoHoje(admin, p.loja) : Promise.resolve(0)])
  if (total === null || daLoja === null) return { ok: false, motivo: 'banco' } // sem contagem = não gasta
  if (total >= lim.usdDia * 1e6 || (p.loja && daLoja >= tetoLoja * 1e6)) {
    const sistema = total >= lim.usdDia * 1e6
    const quem = sistema ? `sistema (US$ ${lim.usdDia}/dia)` : `loja (US$ ${tetoLoja}/dia)`
    console.error(`[custo] ia teto: limite diário do ${quem} atingido`)
    await admin.from('api_alertas').insert({ api: 'ia', nivel: 'bloqueio', mensagem: `Teto diário da IA atingido: ${quem}. A IA para até 00:00 e o robô padrão assume.`, restaurante_id: p.loja }).then(() => {}, () => {})
    void contarSemTrava(admin, 'ia:bloqueada', p.loja)
    // Uma vez por dia por loja (e uma para o sistema).
    void avisarSuporte(admin, `ia:teto:${sistema ? 'sistema' : p.loja}:${diaSP()}`, `IA (Claude): teto diário do ${quem} atingido${p.loja && !sistema ? ` (loja ${p.loja})` : ''}. A IA parou até 00:00; o robô padrão responde.`, 24 * 60 * 60_000)
    return { ok: false, motivo: 'teto' }
  }
  const r = await chamarApiPaga(admin, { api: 'ia', chave: `conversa:${p.conversa}`, loja: p.loja }, chamar)
  if (!r.ok) return r
  const { valor, modelo, uso } = r.valor
  const custo = custoMicroUsd(modelo, uso)
  const entradaTotal = (uso.entrada || 0) + (uso.cacheEscrita || 0) + (uso.cacheLeitura || 0)
  await admin.rpc('ia_uso_registrar', { p_loja: p.loja, p_modelo: modelo, p_tokens_entrada: entradaTotal, p_tokens_saida: uso.saida || 0, p_custo_micro_usd: custo })
    .then(({ error }) => { if (error) console.error('[custo] ia: falha ao registrar consumo', error.message) }, () => {})
  return { ok: true, valor, custoMicroUsd: custo }
}

// ── Leitura para o Super Admin ───────────────────────────────────────────────
export interface SomaIa { chamadas: number; tokensEntrada: number; tokensSaida: number; custoMicroUsd: number }
export interface UsoIa {
  ligada: boolean
  dia: string
  limites: ReturnType<typeof limitesIa>
  hoje: SomaIa
  mes: SomaIa
  porLoja: Record<string, { hoje: SomaIa; mes: SomaIa }>
  porModeloMes: Record<string, SomaIa>
  /** Teto próprio por loja em US$/dia (0183); ausente = padrão (limites.usdDiaLoja). */
  tetosLoja: Record<string, number>
  bloqueadasHoje: number
  ultimos7: { dia: string; custoMicroUsd: number; chamadas: number }[]
}
export interface LinhaIa { dia: string; escopo: string; modelo: string; chamadas: number; tokens_entrada: number; tokens_saida: number; custo_micro_usd: number }

const zero = (): SomaIa => ({ chamadas: 0, tokensEntrada: 0, tokensSaida: 0, custoMicroUsd: 0 })
function somar(s: SomaIa, l: LinhaIa) {
  s.chamadas += Number(l.chamadas) || 0
  s.tokensEntrada += Number(l.tokens_entrada) || 0
  s.tokensSaida += Number(l.tokens_saida) || 0
  s.custoMicroUsd += Number(l.custo_micro_usd) || 0
}

/** Agrega as linhas do mês: hoje, mês, por loja, por modelo e 7 dias (total). Pura. */
export function agregarIa(linhas: LinhaIa[], hoje: string): Omit<UsoIa, 'ligada' | 'limites' | 'bloqueadasHoje' | 'tetosLoja'> {
  const mesIni = `${hoje.slice(0, 8)}01`
  const r = { dia: hoje, hoje: zero(), mes: zero(), porLoja: {} as UsoIa['porLoja'], porModeloMes: {} as UsoIa['porModeloMes'], ultimos7: [] as UsoIa['ultimos7'] }
  const base = Date.parse(`${hoje}T12:00:00Z`)
  for (let i = 6; i >= 0; i--) r.ultimos7.push({ dia: new Date(base - i * 86_400_000).toISOString().slice(0, 10), custoMicroUsd: 0, chamadas: 0 })
  const sete = new Map(r.ultimos7.map((d) => [d.dia, d]))
  for (const l of linhas) {
    const dia = String(l.dia).slice(0, 10)
    if (l.escopo === 'total') {
      const d = sete.get(dia)
      if (d) { d.custoMicroUsd += Number(l.custo_micro_usd) || 0; d.chamadas += Number(l.chamadas) || 0 }
      if (dia < mesIni || dia > hoje) continue
      somar(r.mes, l)
      somar((r.porModeloMes[l.modelo] ??= zero()), l)
      if (dia === hoje) somar(r.hoje, l)
    } else {
      if (dia < mesIni || dia > hoje) continue
      const loja = (r.porLoja[l.escopo] ??= { hoje: zero(), mes: zero() })
      somar(loja.mes, l)
      if (dia === hoje) somar(loja.hoje, l)
    }
  }
  return r
}

export async function lerUsoIa(admin: SupabaseClient, agora = new Date()): Promise<UsoIa> {
  const hoje = diaSP(agora)
  const mesIni = `${hoje.slice(0, 8)}01`
  const seteAtras = new Date(Date.parse(`${hoje}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10)
  const desde = seteAtras < mesIni ? seteAtras : mesIni
  const [{ data: linhas }, { data: bloq }, { data: tetos }] = await Promise.all([
    admin.from('ia_uso_dia').select('dia, escopo, modelo, chamadas, tokens_entrada, tokens_saida, custo_micro_usd').gte('dia', desde).limit(20000),
    admin.from('api_uso_dia').select('chamadas').eq('api', 'ia:bloqueada').eq('escopo', 'total').eq('dia', hoje).maybeSingle(),
    admin.from('whatsapp_robo_config').select('restaurante_id, ia_teto_usd_dia').not('ia_teto_usd_dia', 'is', null).limit(5000),
  ])
  return {
    ...agregarIa((linhas ?? []) as LinhaIa[], hoje),
    ligada: Boolean(process.env.ANTHROPIC_API_KEY),
    limites: limitesIa(),
    bloqueadasHoje: Number((bloq as { chamadas?: number } | null)?.chamadas) || 0,
    tetosLoja: Object.fromEntries(((tetos ?? []) as { restaurante_id: string; ia_teto_usd_dia: number | string }[]).map((t) => [t.restaurante_id, Number(t.ia_teto_usd_dia)])),
  }
}
