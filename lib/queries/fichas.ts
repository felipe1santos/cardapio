import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Ficha de preparo (0119): ingredientes, passos e tempo estimado de um item do cardápio.
 * Gestão grava pela sessão (RLS dono/gerente); a cozinha lê pelo servidor com o token da
 * estação (ver /api/cozinha/[token]/ficha/[itemId]).
 */
export interface IngredienteFicha { nome: string; quantidade: string }
export interface PassoFicha { texto: string; fotoUrl?: string | null }
export interface FichaPreparo { ingredientes: IngredienteFicha[]; passos: PassoFicha[]; tempoMin: number | null }

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Limpa o que veio da tela: tira linhas vazias, corta tamanhos, valida a foto (https). */
export function normalizarFicha(bruto: unknown): FichaPreparo {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  const ingredientes = (Array.isArray(b.ingredientes) ? b.ingredientes : [])
    .map((i) => ({ nome: texto((i as IngredienteFicha)?.nome, 80), quantidade: texto((i as IngredienteFicha)?.quantidade, 40) }))
    .filter((i) => i.nome)
    .slice(0, 60)
  const passos = (Array.isArray(b.passos) ? b.passos : [])
    .map((p) => {
      const foto = texto((p as PassoFicha)?.fotoUrl, 500)
      return { texto: texto((p as PassoFicha)?.texto, 500), fotoUrl: /^https:\/\//.test(foto) ? foto : null }
    })
    .filter((p) => p.texto)
    .slice(0, 40)
  const t = Math.round(Number(b.tempoMin))
  return { ingredientes, passos, tempoMin: Number.isFinite(t) && t >= 1 && t <= 600 ? t : null }
}

export function fichaVazia(f: FichaPreparo | null | undefined): boolean {
  return !f || (f.ingredientes.length === 0 && f.passos.length === 0 && f.tempoMin === null)
}

function mapear(row: { ingredientes: unknown; passos: unknown; tempo_min: number | null } | null): FichaPreparo | null {
  if (!row) return null
  return normalizarFicha({ ingredientes: row.ingredientes, passos: row.passos, tempoMin: row.tempo_min })
}

export async function buscarFicha(supabase: SupabaseClient, itemId: string): Promise<FichaPreparo | null> {
  const { data, error } = await supabase.from('fichas_preparo').select('ingredientes, passos, tempo_min').eq('item_id', itemId).maybeSingle()
  if (error) throw error
  return mapear(data)
}

/** Grava (ou apaga, se vazia) a ficha do item. */
export async function salvarFicha(supabase: SupabaseClient, restauranteId: string, itemId: string, ficha: FichaPreparo): Promise<void> {
  const f = normalizarFicha(ficha)
  if (fichaVazia(f)) {
    const { error } = await supabase.from('fichas_preparo').delete().eq('item_id', itemId)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('fichas_preparo').upsert(
    { item_id: itemId, restaurante_id: restauranteId, ingredientes: f.ingredientes, passos: f.passos, tempo_min: f.tempoMin },
    { onConflict: 'item_id' },
  )
  if (error) throw error
}
