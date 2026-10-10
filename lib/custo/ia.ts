import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarApiPaga, limiteDiario } from './guarda'
import { contarSemTrava, diaSP } from './uso'
import { avisarSuporte } from './alerta-whatsapp'

/**
 * IA DE ATENDIMENTO (ChatGPT/OpenAI) — contador e teto de gasto, preparados antes da IA existir (10/10/2026,
 * docs/REGRAS-DE-CUSTO.md). Toda chamada à IA passa por `chamarIa()`:
 *   1. TETO em dinheiro: se o gasto de hoje já chegou ao limite (total do sistema ou da loja), NÃO chama;
 *   2. a guarda comum (`chamarApiPaga`, api 'ia'): trava de disparo (mesma conversa > 20/min) e limite de chamadas/dia;
 *   3. depois da resposta, grava tokens e custo REAIS em ia_uso_dia (0174), por loja e no total.
 * O Super Admin lê isso em `lerUsoIa()`.
 *
 * Limites (Coolify): LIMITE_IA_USD_DIA (5 = US$ 5/dia no sistema todo), LIMITE_IA_USD_DIA_LOJA (1 = US$ 1/dia por loja),
 * LIMITE_IA_CHAMADAS_DIA (2000). Cotação para exibir em reais: COTACAO_DOLAR (5,50). Chave: OPENAI_API_KEY (só servidor).
 */

/** Preço em US$ por 1 milhão de tokens [entrada, saída]. CONFERIR em openai.com/api/pricing antes de ligar a IA. */
export const PRECOS_IA: Record<string, [number, number]> = {
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4.1-nano': [0.1, 0.4],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-5-nano': [0.05, 0.4],
  'gpt-5-mini': [0.25, 2],
  'gpt-4.1': [2, 8],
  'gpt-4o': [2.5, 10],
  'gpt-5': [1.25, 10],
}
/** Modelo desconhecido: cobra como o mais caro da tabela — o contador nunca subestima. */
const PRECO_DESCONHECIDO: [number, number] = [2.5, 10]

function precoDoModelo(modelo: string, env: Record<string, string | undefined>): [number, number] {
  try {
    const extra = env.IA_PRECOS ? (JSON.parse(env.IA_PRECOS) as Record<string, [number, number]>) : {}
    if (Array.isArray(extra[modelo]) && extra[modelo].length === 2) return extra[modelo]
  } catch { /* IA_PRECOS inválido: usa a tabela */ }
  // "gpt-4o-mini-2024-07-18" → "gpt-4o-mini": o prefixo mais longo da tabela que casa.
  const base = Object.keys(PRECOS_IA).filter((m) => modelo === m || modelo.startsWith(`${m}-`)).sort((a, b) => b.length - a.length)[0]
  return base ? PRECOS_IA[base] : PRECO_DESCONHECIDO
}

/** Custo de uma resposta em micro-dólares (US$ 1 = 1.000.000), arredondado para cima. Pura. */
export function custoMicroUsd(modelo: string, tokensEntrada: number, tokensSaida: number, env: Record<string, string | undefined> = process.env): number {
  const [pe, ps] = precoDoModelo(modelo, env)
  const ent = Math.max(0, Number(tokensEntrada) || 0), sai = Math.max(0, Number(tokensSaida) || 0)
  return Math.ceil(ent * pe + sai * ps) // tokens × (US$ / 1M) × 1M micro = tokens × preço
}

const numEnv = (v: string | undefined, padrao: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : padrao }
export function limitesIa(env: Record<string, string | undefined> = process.env) {
  return {
    usdDia: numEnv(env.LIMITE_IA_USD_DIA, 5),
    usdDiaLoja: numEnv(env.LIMITE_IA_USD_DIA_LOJA, 1),
    chamadasDia: limiteDiario('ia', env),
    cotacao: numEnv(env.COTACAO_DOLAR, 5.5) || 5.5,
  }
}

export type RespostaIa<T> = { valor: T; modelo: string; tokensEntrada: number; tokensSaida: number }
export type ResultadoIa<T> = { ok: true; valor: T; custoMicroUsd: number } | { ok: false; motivo: 'teto' | 'disparo' | 'limite' | 'banco' | 'erro'; erro?: string }

async function gastoHoje(admin: SupabaseClient, escopo: string): Promise<number | null> {
  const { data, error } = await admin.from('ia_uso_dia').select('custo_micro_usd').eq('dia', diaSP()).eq('escopo', escopo).limit(100)
  if (error) return null
  return ((data ?? []) as { custo_micro_usd: number }[]).reduce((s, l) => s + (Number(l.custo_micro_usd) || 0), 0)
}

/**
 * Chama a IA só se o teto em dinheiro e a guarda deixarem. `conversa` identifica a conversa (trava de disparo);
 * `chamar` faz a requisição e devolve os tokens que a OpenAI informou em `usage`. Quem chama trata { ok: false }
 * com a reserva (ex.: passar a conversa para um atendente humano).
 */
export async function chamarIa<T>(
  admin: SupabaseClient,
  p: { loja: string | null; conversa: string },
  chamar: () => Promise<RespostaIa<T>>,
): Promise<ResultadoIa<T>> {
  const lim = limitesIa()
  const [total, daLoja] = await Promise.all([gastoHoje(admin, 'total'), p.loja ? gastoHoje(admin, p.loja) : Promise.resolve(0)])
  if (total === null || daLoja === null) return { ok: false, motivo: 'banco' } // sem contagem = não gasta
  if (total >= lim.usdDia * 1e6 || (p.loja && daLoja >= lim.usdDiaLoja * 1e6)) {
    const quem = total >= lim.usdDia * 1e6 ? `sistema (US$ ${lim.usdDia}/dia)` : `loja (US$ ${lim.usdDiaLoja}/dia)`
    console.error(`[custo] ia teto: limite diário do ${quem} atingido`)
    await admin.from('api_alertas').insert({ api: 'ia', nivel: 'bloqueio', mensagem: `Teto diário da IA atingido: ${quem}. A IA para até amanhã.`, restaurante_id: p.loja }).then(() => {}, () => {})
    void contarSemTrava(admin, 'ia:bloqueada', p.loja)
    void avisarSuporte(admin, `ia:teto:${quem}`, `IA (ChatGPT): teto diário do ${quem} atingido. A IA parou até amanhã.`)
    return { ok: false, motivo: 'teto' }
  }
  const r = await chamarApiPaga(admin, { api: 'ia', chave: `conversa:${p.conversa}`, loja: p.loja }, chamar)
  if (!r.ok) return r
  const { valor, modelo, tokensEntrada, tokensSaida } = r.valor
  const custo = custoMicroUsd(modelo, tokensEntrada, tokensSaida)
  await admin.rpc('ia_uso_registrar', { p_loja: p.loja, p_modelo: modelo, p_tokens_entrada: tokensEntrada, p_tokens_saida: tokensSaida, p_custo_micro_usd: custo })
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
export function agregarIa(linhas: LinhaIa[], hoje: string): Omit<UsoIa, 'ligada' | 'limites' | 'bloqueadasHoje'> {
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
  const [{ data: linhas }, { data: bloq }] = await Promise.all([
    admin.from('ia_uso_dia').select('dia, escopo, modelo, chamadas, tokens_entrada, tokens_saida, custo_micro_usd').gte('dia', desde).limit(20000),
    admin.from('api_uso_dia').select('chamadas').eq('api', 'ia:bloqueada').eq('escopo', 'total').eq('dia', hoje).maybeSingle(),
  ])
  return {
    ...agregarIa((linhas ?? []) as LinhaIa[], hoje),
    ligada: Boolean(process.env.OPENAI_API_KEY),
    limites: limitesIa(),
    bloqueadasHoje: Number((bloq as { chamadas?: number } | null)?.chamadas) || 0,
  }
}
