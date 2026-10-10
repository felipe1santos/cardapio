import type { SupabaseClient } from '@supabase/supabase-js'
import { contarSemTrava } from './uso'
import { avisarSuporte } from './alerta-whatsapp'

/**
 * GUARDA DE CUSTO (10/10/2026) — por aqui passa TODA chamada a API paga (docs/REGRAS-DE-CUSTO.md).
 *
 * Incidente: o mapa do despacho geocodificava os pinos a cada segundo (~20 mil chamadas em 03–09/10, R$ 200).
 * Agora cada chamada:
 *   1. passa pela trava de DISPARO: a mesma chamada (api + chave) mais de 20 vezes em 1 minuto é bloqueada;
 *   2. conta no banco (api_uso_dia, atômico): total do dia e por loja; passando do limite diário, ninguém chama
 *      mais até virar o dia — quem chamou usa a RESERVA (frete pelo bairro, "rota indisponível"...);
 *   3. registra alerta em api_alertas aos 80% e aos 100% do limite, e no disparo.
 * Banco fora do ar = NÃO chama (falha para o lado barato).
 *
 * Limites (Coolify): LIMITE_GEOCODING_DIA (300), LIMITE_DIRECTIONS_DIA (300), LIMITE_PLACES_DIA (100),
 * LIMITE_IA_CENTAVOS_DIA (500 = R$ 5/dia).
 */
export type ApiPaga = 'geocoding' | 'directions' | 'places' | 'ia'

const PADRAO: Record<ApiPaga, number> = { geocoding: 300, directions: 300, places: 100, ia: 2000 }
const ENV: Record<ApiPaga, string> = { geocoding: 'LIMITE_GEOCODING_DIA', directions: 'LIMITE_DIRECTIONS_DIA', places: 'LIMITE_PLACES_DIA', ia: 'LIMITE_IA_CHAMADAS_DIA' }

export function limiteDiario(api: ApiPaga, env: Record<string, string | undefined> = process.env): number {
  const v = Number(env[ENV[api]])
  return Number.isInteger(v) && v >= 0 ? v : PADRAO[api]
}
export function limiteCustoIaCentavos(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.LIMITE_IA_CENTAVOS_DIA)
  return Number.isInteger(v) && v >= 0 ? v : 500
}

// ── Disparo (puro + estado do processo) ───────────────────────────────────────
export const DISPARO_MAX = 20
export const DISPARO_JANELA_MS = 60_000

/** Registra a chamada e diz se passou de DISPARO_MAX na janela. Pura sobre o mapa recebido. */
export function registrarDisparo(mapa: Map<string, number[]>, chave: string, agora: number): boolean {
  const lista = (mapa.get(chave) ?? []).filter((t) => agora - t < DISPARO_JANELA_MS)
  lista.push(agora)
  mapa.set(chave, lista)
  if (mapa.size > 5000) for (const [k, v] of mapa) if (!v.length || agora - v[v.length - 1] >= DISPARO_JANELA_MS) mapa.delete(k)
  return lista.length > DISPARO_MAX
}

/** Nível do uso depois desta chamada: alerta só ao CRUZAR 80% (uma vez por dia). Pura. */
export function nivelDoUso(chamadas: number, limite: number): 'normal' | 'atencao' {
  if (limite <= 0) return 'normal'
  return chamadas === Math.ceil(limite * 0.8) ? 'atencao' : 'normal'
}

const disparos = new Map<string, number[]>()
const alertados = new Map<string, number>()

async function alertar(admin: SupabaseClient, api: ApiPaga, nivel: 'atencao' | 'bloqueio' | 'disparo' | 'erro', mensagem: string, loja: string | null, dedupe: string) {
  const agora = Date.now()
  const antes = alertados.get(dedupe)
  if (antes && agora - antes < 10 * 60_000) return
  alertados.set(dedupe, agora)
  console.error(`[custo] ${api} ${nivel}: ${mensagem}`)
  await admin.from('api_alertas').insert({ api, nivel, mensagem: mensagem.slice(0, 500), restaurante_id: loja }).then(() => {}, () => {})
  // Gasto alto (80%, limite, loop): também no WhatsApp do suporte (lib/custo/alerta-whatsapp.ts).
  if (nivel !== 'erro') void avisarSuporte(admin, `${api}:${nivel}`, `${api} — ${nivel}: ${mensagem}${loja ? ` (loja ${loja})` : ''}`)
}

export type ResultadoGuarda<T> = { ok: true; valor: T } | { ok: false; motivo: 'disparo' | 'limite' | 'banco' | 'erro'; erro?: string }

/**
 * Chama a API paga só se a guarda deixar. `chave` identifica a chamada (ex.: endereço normalizado) para a trava
 * de disparo; `loja` conta por loja (null = sistema). Quem chama trata { ok: false } com a reserva.
 */
export async function chamarApiPaga<T>(
  admin: SupabaseClient,
  p: { api: ApiPaga; chave: string; loja?: string | null; custoCentavos?: number },
  chamar: () => Promise<T>,
): Promise<ResultadoGuarda<T>> {
  const loja = p.loja ?? null
  if (registrarDisparo(disparos, `${p.api}:${p.chave}`, Date.now())) {
    await alertar(admin, p.api, 'disparo', `A mesma chamada (${p.chave.slice(0, 80)}) passou de ${DISPARO_MAX} vezes em 1 minuto — bloqueada.`, loja, `disparo:${p.api}:${p.chave}`)
    void contarSemTrava(admin, `${p.api}:bloqueada`, loja)
    return { ok: false, motivo: 'disparo' }
  }
  const limite = limiteDiario(p.api)
  const { data, error } = await admin.rpc('api_uso_contar', {
    p_api: p.api, p_loja: loja, p_limite: limite, p_custo_centavos: p.custoCentavos ?? 0,
    p_limite_custo_centavos: p.api === 'ia' ? limiteCustoIaCentavos() : null,
  })
  if (error || !data) {
    await alertar(admin, p.api, 'erro', `Sem contagem no banco (${error?.message?.slice(0, 120) ?? 'vazio'}) — chamada NÃO feita.`, loja, `banco:${p.api}`)
    return { ok: false, motivo: 'banco' }
  }
  const r = data as { permitido: boolean; chamadas: number; limite: number }
  if (!r.permitido) {
    await alertar(admin, p.api, 'bloqueio', `Limite diário atingido (${r.limite}). Chamadas paradas até amanhã; o sistema usa a reserva.`, loja, `bloqueio:${p.api}:${new Date().toDateString()}`)
    void contarSemTrava(admin, `${p.api}:bloqueada`, loja)
    return { ok: false, motivo: 'limite' }
  }
  if (nivelDoUso(r.chamadas, r.limite) === 'atencao') {
    await alertar(admin, p.api, 'atencao', `80% do limite diário (${r.chamadas}/${r.limite}).`, loja, `atencao:${p.api}:${new Date().toDateString()}`)
  }
  try {
    return { ok: true, valor: await chamar() }
  } catch (e) {
    return { ok: false, motivo: 'erro', erro: (e as Error).message?.slice(0, 200) }
  }
}

/** Só para os testes: zera o estado do processo. */
export function _zerarGuarda() { disparos.clear(); alertados.clear() }
