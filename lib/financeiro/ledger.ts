import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Livro-caixa (0132). Cada movimento de dinheiro é um GRUPO de linhas em carteiras (gaveta,
 * motoboy, pix_conferir, cartão, empresa, a_receber, resultado). Ex.: troco entregue ao motoboy =
 * −gaveta / +motoboy. Append-only no banco: corrigir é lançar de novo (estorno/ajuste) apontando o
 * original em `referenciaId`.
 *
 * Idempotente: a mesma `chave` devolve o grupo já gravado (clique duplo, internet instável).
 */
export type Carteira = 'gaveta' | 'motoboy' | 'pix_conferir' | 'cartao' | 'empresa' | 'a_receber' | 'resultado'
export type TipoLancamento =
  | 'venda' | 'recebimento' | 'troco' | 'sangria' | 'reforco' | 'despesa' | 'compra' | 'retirada' | 'perda' | 'ajuste'
  | 'troco_motoboy' | 'acerto_motoboy' | 'pendencia_motoboy' | 'estorno' | 'taxa' | 'desconto' | 'pix_confirmado'
  | 'abertura' | 'conta_pagar' | 'conta_receber' | 'outro'
export type Origem = 'pdv' | 'mesa' | 'balcao' | 'delivery' | 'motoboy' | 'online' | 'manual' | 'sistema'

export interface LinhaLancamento {
  carteira: Carteira
  tipo: TipoLancamento
  /** Centavos inteiros, com sinal (+ entra na carteira, − sai). Nunca zero. */
  valorCentavos: number
  forma?: string | null
  entregadorId?: string | null
  pedidoId?: string | null
  comandaId?: string | null
  pagamentoId?: string | null
  referenciaId?: number | null
  dados?: Record<string, unknown> | null
}

export interface GrupoLancamento {
  restauranteId: string
  turnoId?: string | null
  chave: string
  origem: Origem
  usuario: { id: string | null; nome: string }
  motivo?: string | null
  aprovacao?: { id: string; nome: string } | null
  dispositivo?: string | null
  linhas: LinhaLancamento[]
}

export interface LancamentoGravado {
  id: number
  grupo_id: string
  linha: number
  carteira: Carteira
  tipo: TipoLancamento
  valor_centavos: number
  hash: string
}

export function validarGrupo(g: GrupoLancamento): string | null {
  if (!g.linhas.length || g.linhas.length > 20) return 'Lançamento sem linhas.'
  if (!/^[\w:.-]{8,120}$/.test(g.chave)) return 'Chave de idempotência inválida.'
  if (!g.usuario.nome?.trim()) return 'Lançamento sem usuário.'
  for (const l of g.linhas) {
    if (!Number.isSafeInteger(l.valorCentavos) || l.valorCentavos === 0) return 'Valor inválido (centavos inteiros, diferente de zero).'
    if (l.carteira === 'motoboy' && !l.entregadorId) return 'Lançamento na carteira do motoboy sem o motoboy.'
  }
  return null
}

export async function lancar(admin: SupabaseClient, g: GrupoLancamento): Promise<{ ok: true; repetido: boolean; linhas: LancamentoGravado[] } | { ok: false; erro: string }> {
  const problema = validarGrupo(g)
  if (problema) return { ok: false, erro: problema }
  const grupoId = crypto.randomUUID()
  const linhas = g.linhas.map((l, i) => ({
    restaurante_id: g.restauranteId,
    grupo_id: grupoId,
    linha: i + 1,
    turno_id: g.turnoId ?? null,
    carteira: l.carteira,
    entregador_id: l.entregadorId ?? null,
    tipo: l.tipo,
    valor_centavos: l.valorCentavos,
    forma: l.forma ?? null,
    origem: g.origem,
    pedido_id: l.pedidoId ?? null,
    comanda_id: l.comandaId ?? null,
    pagamento_id: l.pagamentoId ?? null,
    referencia_id: l.referenciaId ?? null,
    motivo: g.motivo?.trim().slice(0, 500) || null,
    usuario_id: g.usuario.id,
    usuario_nome: g.usuario.nome.slice(0, 120),
    aprovacao_id: g.aprovacao?.id ?? null,
    aprovado_por_nome: g.aprovacao?.nome ?? null,
    chave_idempotencia: g.chave,
    dispositivo: g.dispositivo?.slice(0, 200) ?? null,
    dados: l.dados ?? null,
  }))
  const sel = 'id, grupo_id, linha, carteira, tipo, valor_centavos, hash'
  const { data, error } = await admin.from('fin_lancamentos').insert(linhas).select(sel)
  if (!error) return { ok: true, repetido: false, linhas: (data ?? []) as LancamentoGravado[] }
  if (error.code === '23505') {
    const { data: ja } = await admin.from('fin_lancamentos').select(sel).eq('restaurante_id', g.restauranteId).eq('chave_idempotencia', g.chave).order('linha')
    return { ok: true, repetido: true, linhas: (ja ?? []) as LancamentoGravado[] }
  }
  if (error.code === '42501') return { ok: false, erro: 'Operação recusada pelo banco.' }
  throw error
}

/** Saldo de uma carteira (centavos), somando o livro-caixa. */
export async function saldoCarteira(admin: SupabaseClient, restauranteId: string, carteira: Carteira, filtro: { turnoId?: string; entregadorId?: string } = {}): Promise<number> {
  let total = 0
  for (let de = 0; ; de += 1000) {
    let q = admin.from('fin_lancamentos').select('valor_centavos').eq('restaurante_id', restauranteId).eq('carteira', carteira)
    if (filtro.turnoId) q = q.eq('turno_id', filtro.turnoId)
    if (filtro.entregadorId) q = q.eq('entregador_id', filtro.entregadorId)
    const { data, error } = await q.order('id').range(de, de + 999)
    if (error) throw error
    for (const r of data ?? []) total += Number(r.valor_centavos)
    if (!data || data.length < 1000) break
  }
  return total
}
