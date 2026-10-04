import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Âncora externa da integridade (0141). Uma vez por dia o cron grava, num ARQUIVO no servidor do app,
 * o último (seq, hash) do livro-caixa e da auditoria de cada loja. O arquivo fica fora do banco: quem tem
 * a senha do `postgres` consegue reescrever a cadeia inteira (recalculando os hashes), mas não consegue
 * mexer neste arquivo — e a verificação compara as âncoras com o banco.
 *
 * Local do arquivo: ANCORA_DIR (no Coolify, um volume persistente montado em /app/dados/ancoras).
 */
export const ANCORA_DIR = process.env.ANCORA_DIR || '/app/dados/ancoras'
const ARQUIVO = () => join(ANCORA_DIR, 'ancoras.jsonl')

export interface Ancora {
  em: string
  restauranteId: string
  ledger: { seq: number; hash: string } | null
  auditoria: { seq: number; hash: string } | null
}

/** Grava a âncora de todas as lojas (uma linha por loja, só acrescenta). */
export async function gravarAncoras(admin: SupabaseClient): Promise<{ lojas: number; arquivo: string }> {
  const { data, error } = await admin.rpc('fin_ancora_integridade')
  if (error) throw error
  const em = new Date().toISOString()
  const linhas = ((data ?? []) as { restaurante_id: string; ledger_seq: number | null; ledger_hash: string | null; auditoria_seq: number | null; auditoria_hash: string | null }[])
    .map((r): Ancora => ({
      em, restauranteId: r.restaurante_id,
      ledger: r.ledger_seq !== null && r.ledger_hash ? { seq: Number(r.ledger_seq), hash: r.ledger_hash } : null,
      auditoria: r.auditoria_seq !== null && r.auditoria_hash ? { seq: Number(r.auditoria_seq), hash: r.auditoria_hash } : null,
    }))
  await mkdir(ANCORA_DIR, { recursive: true })
  if (linhas.length) await appendFile(ARQUIVO(), linhas.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
  return { lojas: linhas.length, arquivo: ARQUIVO() }
}

/** Âncoras gravadas de uma loja (mais antigas primeiro). Sem arquivo: lista vazia. */
export async function ancorasDaLoja(restauranteId: string): Promise<Ancora[]> {
  let texto = ''
  try { texto = await readFile(ARQUIVO(), 'utf8') } catch { return [] }
  const out: Ancora[] = []
  for (const linha of texto.split('\n')) {
    if (!linha.trim()) continue
    try { const a = JSON.parse(linha) as Ancora; if (a.restauranteId === restauranteId) out.push(a) } catch { /* linha quebrada: ignora */ }
  }
  return out
}

export interface ProblemaAncora { tabela: string; registro: string; motivo: string }

/**
 * Compara cada âncora da loja com o banco: o registro daquele `seq` tem de existir, ser da loja e ter o
 * MESMO hash. Se a cadeia foi reescrita depois da âncora, o hash daquele seq muda — e isto acusa, mesmo que
 * a cadeia interna esteja "consistente".
 */
export async function verificarAncoras(admin: SupabaseClient, restauranteId: string): Promise<{ ancoras: number; ultimaEm: string | null; problemas: ProblemaAncora[] }> {
  const ancoras = await ancorasDaLoja(restauranteId)
  const problemas: ProblemaAncora[] = []
  const conferir = async (tabela: 'fin_lancamentos' | 'eventos_auditoria', pontos: { seq: number; hash: string; em: string }[]) => {
    const seqs = [...new Set(pontos.map((p) => p.seq))]
    const banco = new Map<number, { hash: string; restaurante_id: string }>()
    for (let i = 0; i < seqs.length; i += 200) {
      const { data } = await admin.from(tabela).select('seq, hash, restaurante_id').in('seq', seqs.slice(i, i + 200))
      for (const r of data ?? []) banco.set(Number(r.seq), { hash: r.hash as string, restaurante_id: r.restaurante_id as string })
    }
    for (const p of pontos) {
      const b = banco.get(p.seq)
      if (!b || b.restaurante_id !== restauranteId) problemas.push({ tabela, registro: `seq ${p.seq}`, motivo: `registro da âncora de ${p.em.slice(0, 10)} sumiu do banco` })
      else if (b.hash !== p.hash) problemas.push({ tabela, registro: `seq ${p.seq}`, motivo: `cadeia reescrita: o hash não bate com a âncora de ${p.em.slice(0, 10)}` })
    }
  }
  await conferir('fin_lancamentos', ancoras.filter((a) => a.ledger).map((a) => ({ ...a.ledger!, em: a.em })))
  await conferir('eventos_auditoria', ancoras.filter((a) => a.auditoria).map((a) => ({ ...a.auditoria!, em: a.em })))
  return { ancoras: ancoras.length, ultimaEm: ancoras.at(-1)?.em ?? null, problemas }
}
