/**
 * Várias taxas por conta (0124, 2026-10-01). Cada taxa: nome, tipo e base.
 *  · percentual — base % do subtotal (ex.: 10% de serviço extra);
 *  · fixo       — base em R$ (ex.: Taxa de rolha R$ 30);
 *  · por_pessoa — base em R$ × quantidade de pessoas (ex.: Couvert R$ 15 × 4).
 * O valor é calculado pelo SERVIDOR sobre o subtotal da conta (já com as decisões do
 * fechamento), e a soma vai para a taxa manual da conta (0106).
 */
export type TipoTaxa = 'percentual' | 'fixo' | 'por_pessoa'
export interface TaxaEntrada { nome: string; tipo: TipoTaxa; base: number; quantidade?: number }
export interface TaxaCalculada extends TaxaEntrada { quantidade: number; valor: number }

export const MAX_TAXAS = 12

export const ROTULO_TIPO_TAXA: Record<TipoTaxa, string> = {
  percentual: '% do subtotal',
  fixo: 'Valor fixo',
  por_pessoa: 'Por pessoa',
}

/** Atalhos que aparecem quando a loja ainda não cadastrou as suas. */
export const TAXAS_SUGERIDAS: TaxaEntrada[] = [
  { nome: 'Couvert artístico', tipo: 'por_pessoa', base: 15, quantidade: 1 },
  { nome: 'Taxa de rolha', tipo: 'fixo', base: 30 },
]

const centavos = (v: number) => Math.round(v * 100) / 100

export function valorDaTaxa(t: TaxaEntrada, subtotal: number): number {
  if (t.tipo === 'percentual') return centavos((subtotal * t.base) / 100)
  if (t.tipo === 'por_pessoa') return centavos(t.base * Math.max(1, Math.round(t.quantidade ?? 1)))
  return centavos(t.base)
}

export function rotuloTaxa(t: TaxaEntrada): string {
  if (t.tipo === 'percentual') return `${t.nome} (${String(t.base).replace('.', ',')}%)`
  if (t.tipo === 'por_pessoa') return `${t.nome} (${Math.max(1, Math.round(t.quantidade ?? 1))} × R$ ${t.base.toFixed(2).replace('.', ',')})`
  return t.nome
}

/** Valida e calcula a lista inteira. Devolve o erro (para o operador) ou as taxas prontas. */
export function calcularTaxas(entrada: unknown, subtotal: number): { ok: true; taxas: TaxaCalculada[] } | { ok: false; erro: string } {
  if (!Array.isArray(entrada)) return { ok: false, erro: 'Lista de taxas inválida.' }
  if (entrada.length > MAX_TAXAS) return { ok: false, erro: `No máximo ${MAX_TAXAS} taxas por conta.` }
  const out: TaxaCalculada[] = []
  for (const bruto of entrada) {
    const t = (bruto ?? {}) as Record<string, unknown>
    const nome = typeof t.nome === 'string' ? t.nome.trim().replace(/\s+/g, ' ') : ''
    if (nome.length < 2 || nome.length > 40) return { ok: false, erro: 'Cada taxa precisa de um nome (2 a 40 letras).' }
    const tipo = t.tipo
    if (tipo !== 'percentual' && tipo !== 'fixo' && tipo !== 'por_pessoa') return { ok: false, erro: `Tipo inválido na taxa "${nome}".` }
    const base = typeof t.base === 'number' ? t.base : Number(String(t.base ?? '').replace(',', '.'))
    if (!Number.isFinite(base) || base < 0 || (tipo === 'percentual' ? base > 100 : base > 9999.99)) return { ok: false, erro: `Valor inválido na taxa "${nome}".` }
    const quantidade = tipo === 'por_pessoa' ? Math.round(Number(t.quantidade ?? 1)) : 1
    if (!Number.isFinite(quantidade) || quantidade < 1 || quantidade > 999) return { ok: false, erro: `Quantidade de pessoas inválida em "${nome}".` }
    const entradaOk: TaxaEntrada = { nome, tipo, base: centavos(base), quantidade }
    const valor = valorDaTaxa(entradaOk, subtotal)
    if (valor > 9999.99) return { ok: false, erro: `A taxa "${nome}" passou do limite.` }
    out.push({ ...entradaOk, quantidade, valor })
  }
  if (out.reduce((s, t) => s + t.valor, 0) > 9999.99) return { ok: false, erro: 'A soma das taxas passou do limite.' }
  return { ok: true, taxas: out }
}
