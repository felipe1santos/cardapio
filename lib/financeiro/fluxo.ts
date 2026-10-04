import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContextoFin } from './contexto'
import {
  COLUNAS, ROTULO_CARTEIRA, ROTULO_FORMA, ROTULO_ORIGEM, ROTULO_SITUACAO, ROTULO_TIPO, dataBR, dataHoraBR, gerarCsvBR, totalizar,
  type Celula, type FiltrosFluxo, type LancamentoExtrato, type LinhaFluxo, type Situacao,
} from './fluxo-regras'

/**
 * Fluxo de Caixa (Fase 4) — servidor. Tudo sai do livro-caixa (fin_lancamentos) e de caixa_turnos, pela
 * função `fin_fluxo_turnos` (0140), que agrega no banco e devolve TODOS os turnos do período (sem o teto de
 * 1000 linhas do PostgREST nas somas). Só leitura: nada aqui grava no livro.
 */

type LinhaRpc = Record<string, string | number | null>
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const dia = (v: unknown) => (v ? String(v).slice(0, 10) : null)

function mapear(r: LinhaRpc): LinhaFluxo {
  return {
    turnoId: (r.turno_id as string) ?? null, data: dia(r.data_abertura), abertoEm: r.aberto_em as string | null, abertoPor: r.aberto_por_nome as string | null,
    fechadoEm: r.fechado_em as string | null, fechadoPor: r.fechado_por_nome as string | null, situacao: r.situacao as Situacao,
    reabertoEm: r.reaberto_em as string | null, reabertoPor: r.reaberto_por_nome as string | null, reabertoMotivo: r.reaberto_motivo as string | null,
    valorInicial: n(r.valor_inicial), vendido: n(r.vendido), recebido: n(r.recebido), aReceber: n(r.a_receber), dinheiro: n(r.dinheiro),
    pix: n(r.pix), pixConfirmado: n(r.pix_confirmado), pixAConferir: n(r.pix_a_conferir), cartao: n(r.cartao), outros: n(r.outros),
    origemBalcao: n(r.origem_balcao), origemMesa: n(r.origem_mesa), origemDelivery: n(r.origem_delivery), origemOnline: n(r.origem_online),
    origemManual: n(r.origem_manual), taxas: n(r.taxas), descontos: n(r.descontos), cancelamentos: n(r.cancelamentos),
    cancelamentosQtd: n(r.cancelamentos_qtd), estornos: n(r.estornos), sangrias: n(r.sangrias), reforcos: n(r.reforcos), despesas: n(r.despesas),
    motoboy: n(r.motoboy), esperado: nn(r.esperado), informado: nn(r.informado), diferenca: nn(r.diferenca), diferencaCartao: nn(r.diferenca_cartao),
    contadoCartao: nn(r.contado_cartao), esperadoCartao: nn(r.esperado_cartao), observacoes: r.observacoes as string | null, lancamentos: n(r.lancamentos),
    produtoQtd: nn(r.produto_qtd), produtoValor: nn(r.produto_valor),
  }
}

export async function buscarFluxo(admin: SupabaseClient, restauranteId: string, f: FiltrosFluxo) {
  const { data, error } = await admin.rpc('fin_fluxo_turnos', {
    p_restaurante: restauranteId, p_de: f.de, p_ate: f.ate,
    p_origens: f.origens.length ? f.origens : null, p_formas: f.formas.length ? f.formas : null,
    p_operador: f.operador, p_entregador: f.motoboy, p_produto: f.produto,
  })
  if (error) throw error
  let linhas = ((data ?? []) as LinhaRpc[]).map(mapear)
  if (f.situacoes.length) linhas = linhas.filter((l) => f.situacoes.includes(l.situacao))
  return { linhas, totais: totalizar(linhas) }
}

/** Opções dos filtros (operador, motoboy, produto) — só da loja. */
export async function opcoesDosFiltros(admin: SupabaseClient, restauranteId: string) {
  const [us, en, it] = await Promise.all([
    admin.from('usuarios').select('id, nome, usuario, papel').eq('restaurante_id', restauranteId).neq('papel', 'entregador').order('nome'),
    admin.from('entregadores').select('id, nome').eq('restaurante_id', restauranteId).order('nome'),
    admin.from('itens_cardapio').select('id, nome').eq('restaurante_id', restauranteId).order('nome').limit(1000),
  ])
  return {
    operadores: (us.data ?? []).map((u) => ({ id: u.id as string, nome: ((u.nome as string) || (u.usuario as string) || '—') })),
    motoboys: (en.data ?? []).map((e) => ({ id: e.id as string, nome: e.nome as string })),
    produtos: (it.data ?? []).map((i) => ({ id: i.id as string, nome: i.nome as string })),
  }
}

const COLS_LANC = 'id, seq, criado_em, tipo, carteira, origem, forma, valor_centavos, pedido_id, comanda_id, usuario_nome, aprovado_por_nome, motivo, referencia_id, turno_id, dados'

/** Todas as linhas de uma consulta, de 1000 em 1000 (o PostgREST corta em 1000 por pedido). */
async function todas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

function descrever(l: { tipo: string; carteira: string; motivo: string | null; dados: Record<string, unknown> | null }, numero: number | null): string {
  // O tipo e a carteira já aparecem na linha; aqui só o que é deste lançamento (pedido, troco, motivo).
  const partes: string[] = []
  if (numero) partes.push(`pedido #${numero}`)
  const troco = Number((l.dados as { troco_centavos?: number } | null)?.troco_centavos ?? 0)
  if (troco > 0) partes.push(`troco R$ ${(troco / 100).toFixed(2).replace('.', ',')}`)
  if (l.motivo && l.motivo !== (ROTULO_TIPO[l.tipo] ?? l.tipo)) partes.push(l.motivo)
  return partes.join(' · ')
}

/** Extrato completo de UM turno da loja (null = não existe nesta loja → 404). */
export async function extratoDoTurnoFluxo(c: Pick<ContextoFin, 'admin' | 'sessao'>, turnoId: string) {
  const loja = c.sessao.restauranteId
  const { data: turno } = await c.admin.from('caixa_turnos').select('*').eq('id', turnoId).eq('restaurante_id', loja).maybeSingle()
  if (!turno) return null
  const fim = (turno.fechado_em as string | null) ?? new Date().toISOString()
  type Raw = { id: number; seq: number; criado_em: string; tipo: string; carteira: string; origem: string | null; forma: string | null; valor_centavos: number; pedido_id: string | null; comanda_id: string | null; usuario_nome: string | null; aprovado_por_nome: string | null; motivo: string | null; referencia_id: number | null; turno_id: string | null; dados: Record<string, unknown> | null }
  const [doTurno, semTurno] = await Promise.all([
    todas<Raw>((de, ate) => c.admin.from('fin_lancamentos').select(COLS_LANC).eq('restaurante_id', loja).eq('turno_id', turnoId).order('seq').range(de, ate)),
    todas<Raw>((de, ate) => c.admin.from('fin_lancamentos').select(COLS_LANC).eq('restaurante_id', loja).is('turno_id', null)
      .gte('criado_em', turno.aberto_em as string).lt('criado_em', fim).order('seq').range(de, ate)),
  ])
  const linhas = [...doTurno, ...semTurno].sort((a, b) => Number(a.seq) - Number(b.seq))
  const pedidoIds = [...new Set(linhas.map((l) => l.pedido_id).filter(Boolean))] as string[]
  const refIds = [...new Set(linhas.map((l) => l.referencia_id).filter((x) => x !== null))] as number[]
  const numeros = new Map<string, number>()
  for (let i = 0; i < pedidoIds.length; i += 200) {
    const { data } = await c.admin.from('pedidos').select('id, numero').eq('restaurante_id', loja).in('id', pedidoIds.slice(i, i + 200))
    for (const p of data ?? []) numeros.set(p.id as string, Number(p.numero))
  }
  const refs = new Map<number, { id: number; tipo: string; criadoEm: string; turnoId: string | null; valor: number }>()
  for (let i = 0; i < refIds.length; i += 200) {
    const { data } = await c.admin.from('fin_lancamentos').select('id, tipo, criado_em, turno_id, valor_centavos').eq('restaurante_id', loja).in('id', refIds.slice(i, i + 200))
    for (const r of data ?? []) refs.set(Number(r.id), { id: Number(r.id), tipo: r.tipo as string, criadoEm: r.criado_em as string, turnoId: r.turno_id as string | null, valor: Number(r.valor_centavos) })
  }
  const lancamentos: LancamentoExtrato[] = linhas.map((l) => {
    const numero = l.pedido_id ? numeros.get(l.pedido_id) ?? null : null
    return {
      id: Number(l.id), seq: Number(l.seq), criadoEm: l.criado_em, tipo: l.tipo, carteira: l.carteira, descricao: descrever(l, numero),
      origem: l.origem, forma: l.forma, valor: Number(l.valor_centavos), pedidoId: l.pedido_id, pedidoNumero: numero, comandaId: l.comanda_id,
      usuario: l.usuario_nome, aprovadoPor: l.aprovado_por_nome, motivo: l.motivo, referenciaId: l.referencia_id,
      referencia: l.referencia_id !== null ? refs.get(Number(l.referencia_id)) ?? null : null, semTurno: l.turno_id === null,
    }
  })
  // Todas as reaberturas (a linha do turno guarda só a última).
  const { data: reab } = await c.admin.from('eventos_auditoria').select('criado_em, usuario_nome, dados')
    .eq('restaurante_id', loja).eq('acao', 'caixa.reabriu_turno').eq('entidade_id', turnoId).order('criado_em')
  const reaberturas = (reab ?? []).map((r) => ({ em: r.criado_em as string, por: r.usuario_nome as string, motivo: ((r.dados as { motivo?: string } | null)?.motivo ?? null) }))
  if (!reaberturas.length && turno.reaberto_em) reaberturas.push({ em: turno.reaberto_em as string, por: turno.reaberto_por_nome as string, motivo: turno.reaberto_motivo as string | null })
  return { turno, lancamentos, reaberturas }
}

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────
function celulaDaColuna(l: LinhaFluxo, id: string): Celula {
  switch (id) {
    case 'data': return l.data ? dataBR(l.data) : 'Fora de turno'
    case 'situacao': return ROTULO_SITUACAO[l.situacao]
    case 'abertura': return l.abertoEm ? `${l.abertoPor ?? '—'} · ${dataHoraBR(l.abertoEm)}` : ''
    case 'fechamento': return l.fechadoEm ? `${l.fechadoPor ?? '—'} · ${dataHoraBR(l.fechadoEm)}` : (l.abertoEm ? 'Em andamento' : '')
    case 'observacoes': return l.observacoes ?? ''
    case 'produtoQtd': return l.produtoQtd === null ? '' : String(l.produtoQtd).replace('.', ',')
    default: {
      const v = l[id as keyof LinhaFluxo]
      return typeof v === 'number' || v === null ? { n: v as number | null } : String(v ?? '')
    }
  }
}

export function csvDoFluxo(linhas: LinhaFluxo[], incluirProduto: boolean): string {
  const cols = [...COLUNAS, ...(incluirProduto ? [{ id: 'produtoQtd', rotulo: 'Produto (qtd.)' }, { id: 'produtoValor', rotulo: 'Produto (valor)' }] : [])]
  const t = totalizar(linhas)
  const totalLinha: Celula[] = cols.map((c, i) => {
    if (i === 0) return 'TOTAL DO PERÍODO'
    if (c.id === 'produtoQtd') return String(t.produtoQtd).replace('.', ',')
    if (c.id in t && !['esperado', 'informado'].includes(c.id as string)) return { n: t[c.id as keyof typeof t] }
    return ''
  })
  return gerarCsvBR([cols.map((c) => c.rotulo), ...linhas.map((l) => cols.map((c) => celulaDaColuna(l, c.id as string))), totalLinha])
}

export function csvDoExtrato(lancamentos: LancamentoExtrato[]): string {
  return gerarCsvBR([
    ['Data/hora', 'Tipo', 'Descrição', 'Origem', 'Forma', 'Carteira', 'Pedido', 'Valor (R$)', 'Feito por', 'Aprovado por', 'Lançamento', 'Corrige o lançamento'],
    ...lancamentos.map((l) => [
      dataHoraBR(l.criadoEm), ROTULO_TIPO[l.tipo] ?? l.tipo, l.descricao, l.origem ? ROTULO_ORIGEM[l.origem] ?? l.origem : '',
      l.forma ? ROTULO_FORMA[l.forma] ?? l.forma : '', ROTULO_CARTEIRA[l.carteira] ?? l.carteira, l.pedidoNumero ? `#${l.pedidoNumero}` : '',
      { n: l.valor }, l.usuario ?? '', l.aprovadoPor ?? '', String(l.id), l.referenciaId ? String(l.referenciaId) : '',
    ] as Celula[]),
  ])
}
