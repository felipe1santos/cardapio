import type { LinhaLancamento } from './ledger'

/**
 * Contas a pagar/receber, compras e DRE (Fase 5b, 0143) — regras puras, testadas, usadas pelo servidor.
 *
 * Duas carteiras de dinheiro: GAVETA (caixa do turno; exige caixa aberto) e EMPRESA (conta, cartão da empresa,
 * boleto). A contrapartida vai para RESULTADO, com a categoria em `dados` — é dali que o DRE lê as despesas.
 */
export type TipoConta = 'pagar' | 'receber'
export type GrupoCategoria = 'despesa' | 'insumo' | 'receita' | 'fora'
export type CarteiraConta = 'gaveta' | 'empresa'
export type Recorrencia = 'nenhuma' | 'mensal' | 'semanal'
export type StatusConta = 'a_pagar' | 'pago' | 'cancelado'
export type StatusExibido = StatusConta | 'vencido'

export const FORMAS_CONTA = ['dinheiro', 'pix', 'boleto', 'transferencia', 'cartao', 'debito_automatico', 'outro'] as const
export type FormaConta = (typeof FORMAS_CONTA)[number]
export const ROTULO_FORMA_CONTA: Record<FormaConta, string> = {
  dinheiro: 'Dinheiro', pix: 'Pix', boleto: 'Boleto', transferencia: 'Transferência', cartao: 'Cartão da empresa', debito_automatico: 'Débito automático', outro: 'Outro',
}
/** Forma do livro-caixa (lista fechada da 0132) para a forma da conta. */
export function formaDoLedger(f: FormaConta): string {
  return f === 'debito_automatico' ? 'transferencia' : f
}

/** Data de hoje (AAAA-MM-DD) no fuso da loja. */
export function hojeSP(agora = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

/** "a pagar" com vencimento antes de hoje aparece como vencida (não é gravado: muda sozinho com a data). */
export function statusExibido(status: StatusConta, vencimento: string, hoje: string): StatusExibido {
  return status === 'a_pagar' && vencimento < hoje ? 'vencido' : status
}

function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Vencimento da ocorrência `n` (0 = a raiz) de uma série. Mensal mantém o dia da raiz; em mês mais curto cai no
 * último dia (31/01 → 28/02 → 31/03). Semanal soma 7 dias.
 */
export function vencimentoDaOcorrencia(raiz: string, recorrencia: Recorrencia, n: number): string {
  if (recorrencia === 'semanal') return somarDias(raiz, 7 * n)
  if (recorrencia !== 'mensal' || n === 0) return raiz
  const [a, m, d] = raiz.split('-').map(Number)
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1))
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  return `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`
}

/** Até onde a série fica gerada adiante: a próxima conta aparece com antecedência para dar tempo de pagar. */
export const HORIZONTE_DIAS: Record<Exclude<Recorrencia, 'nenhuma'>, number> = { mensal: 31, semanal: 7 }

/**
 * Vencimentos que ainda faltam gerar numa série: depois do último já gerado, até hoje + horizonte. Limite de
 * segurança por chamada (série esquecida por anos não gera centenas de linhas de uma vez).
 */
export function ocorrenciasAGerar(p: { raiz: string; recorrencia: Recorrencia; ultimo: string; hoje: string; maximo?: number }): string[] {
  if (p.recorrencia === 'nenhuma') return []
  const limite = somarDias(p.hoje, HORIZONTE_DIAS[p.recorrencia])
  const out: string[] = []
  for (let n = 1; n < 1000 && out.length < (p.maximo ?? 24); n++) {
    const v = vencimentoDaOcorrencia(p.raiz, p.recorrencia, n)
    if (v > limite) break
    if (v > p.ultimo) out.push(v)
  }
  return out
}

/** Tipo do livro-caixa da baixa. Gaveta usa os tipos do caixa (despesa/compra entram no resumo do turno). */
export function tipoDaBaixa(tipo: TipoConta, carteira: CarteiraConta, grupo: GrupoCategoria): LinhaLancamento['tipo'] {
  if (tipo === 'receber') return 'conta_receber'
  if (carteira === 'gaveta') return grupo === 'insumo' ? 'compra' : 'despesa'
  return 'conta_pagar'
}

/**
 * Linhas da baixa (pagar ou receber) de `valor` centavos (> 0):
 *   pagar:   −carteira / −resultado      receber: +carteira / +resultado
 * A categoria vai em `dados` (o DRE agrupa por ela).
 */
export function linhasDaBaixa(p: { tipo: TipoConta; carteira: CarteiraConta; valor: number; forma: FormaConta; grupo: GrupoCategoria; categoriaId: string; contaId?: string | null; compraId?: string | null }): LinhaLancamento[] {
  const v = Math.abs(Math.trunc(p.valor))
  const sinal = p.tipo === 'pagar' ? -1 : 1
  const tipo = tipoDaBaixa(p.tipo, p.carteira, p.grupo)
  const forma = p.carteira === 'gaveta' ? 'dinheiro' : formaDoLedger(p.forma)
  const dados = { categoria_id: p.categoriaId, categoria_grupo: p.grupo, ...(p.contaId ? { conta_id: p.contaId } : {}), ...(p.compraId ? { compra_id: p.compraId } : {}) }
  return [
    { carteira: p.carteira, tipo, valorCentavos: sinal * v, forma, dados },
    { carteira: 'resultado', tipo, valorCentavos: sinal * v, forma, dados },
  ]
}

/** Estorno da baixa: as mesmas linhas com o sinal trocado, cada uma apontando a original. */
export function linhasDoEstorno(originais: { id: number; carteira: string; tipo: string; valor_centavos: number; forma: string | null; dados: Record<string, unknown> | null }[]): LinhaLancamento[] {
  return originais.map((o) => ({
    carteira: o.carteira as LinhaLancamento['carteira'], tipo: o.tipo as LinhaLancamento['tipo'], valorCentavos: -Number(o.valor_centavos),
    forma: o.forma, referenciaId: o.id, dados: { ...(o.dados ?? {}), estorno: true },
  }))
}

/**
 * Precisa do PIN de OUTRA pessoa para dar baixa? Só saída de dinheiro: da gaveta acima do limite de saída do
 * caixa (o mesmo da sangria/despesa), da empresa acima do limite de contas. Receber nunca precisa. O dono não
 * precisa (é ele quem aprovaria).
 */
export function precisaAprovacaoBaixa(p: { tipo: TipoConta; carteira: CarteiraConta; valor: number; limiteSaida: number; limiteConta: number; papel: string }): boolean {
  if (p.papel === 'dono' || p.tipo === 'receber') return false
  return p.valor > (p.carteira === 'gaveta' ? p.limiteSaida : p.limiteConta)
}

// ── compras ────────────────────────────────────────────────────────────────────────────────────
export interface InsumoParaCompra { unidadeCompra: string; quantidadeCompra: number; basePorUnidade: number; unidadeBase: string; custoCompraCentavos: number; preparado: boolean }

/** Quantidade na unidade base. A unidade do item é a de compra do insumo ou a própria unidade base. */
export function quantidadeNaBase(insumo: InsumoParaCompra, quantidade: number, unidade: string): number | null {
  if (!(quantidade > 0)) return null
  if (unidade === insumo.unidadeCompra) return quantidade * insumo.basePorUnidade
  if (unidade === insumo.unidadeBase) return quantidade
  return null
}

/**
 * Custo novo do insumo depois da compra, no formato do cadastro (custo de `quantidadeCompra` unidades de compra):
 * preço pago por unidade base × unidades base da compra cadastrada. Vários itens do mesmo insumo na nota somam.
 */
export function custoCompraNovo(insumo: InsumoParaCompra, totalBase: number, totalCentavos: number): number {
  return Math.round((totalCentavos / totalBase) * insumo.quantidadeCompra * insumo.basePorUnidade)
}

// ── DRE ────────────────────────────────────────────────────────────────────────────────────────
export interface LinhaResultado { tipo: string; categoriaId: string | null; valorCentavos: number }
export interface CategoriaDre { id: string; nome: string; grupo: GrupoCategoria }
export interface Dre {
  faturamentoCentavos: number
  cmvCentavos: number
  lucroBrutoCentavos: number
  outrasReceitas: { nome: string; valorCentavos: number }[]
  outrasReceitasCentavos: number
  despesas: { nome: string; valorCentavos: number }[]
  despesasCentavos: number
  /** Sobras (+) − faltas (−) dos fechamentos de caixa (0145). Linha própria: não é despesa nem receita. */
  diferencasCaixaCentavos: number
  lucroLiquidoCentavos: number
  margemLiquidaPct: number | null
  /** Fora do resultado (só informativo): compras de insumos (já estão no CMV) e aportes. */
  comprasInsumosCentavos: number
  foraDoResultadoCentavos: number
}

const ROTULO_SEM_CATEGORIA: Record<string, string> = {
  despesa: 'Despesas pagas no caixa', perda: 'Perdas e quebras', compra: 'Compras de insumos', conta_pagar: 'Outras contas', conta_receber: 'Outras receitas',
}

/**
 * Monta o DRE simplificado. Faturamento (livro-caixa) − CMV (custo guardado na venda) = lucro bruto;
 * + outras receitas − despesas por categoria ± diferenças de caixa = lucro líquido. Diferença de caixa (sobra ou falta
 * do fechamento, tipo 'ajuste') tem linha própria: sobra não é "despesa negativa" (0145). Compras de insumos e embalagens NÃO entram como
 * despesa (o custo delas já está no CMV de quando o produto foi vendido); aporte do sócio é capital.
 * As linhas da carteira resultado vêm com sinal: despesa negativa, receita positiva.
 */
export function montarDre(p: { faturamento: number; cmv: number; resultado: LinhaResultado[]; categorias: CategoriaDre[] }): Dre {
  const cat = new Map(p.categorias.map((c) => [c.id, c]))
  const rec = new Map<string, number>()
  const desp = new Map<string, number>()
  let compras = 0, fora = 0, diferencas = 0
  for (const l of p.resultado) {
    if (l.tipo === 'ajuste' && !l.categoriaId) { diferencas += l.valorCentavos; continue }
    const c = l.categoriaId ? cat.get(l.categoriaId) : undefined
    const grupo: GrupoCategoria = c?.grupo ?? (l.tipo === 'compra' ? 'insumo' : l.tipo === 'conta_receber' ? 'receita' : 'despesa')
    const nome = c?.nome ?? ROTULO_SEM_CATEGORIA[l.tipo] ?? 'Outros'
    if (grupo === 'insumo') { compras += -l.valorCentavos; continue }
    if (grupo === 'fora') { fora += l.valorCentavos; continue }
    if (grupo === 'receita') rec.set(nome, (rec.get(nome) ?? 0) + l.valorCentavos)
    else desp.set(nome, (desp.get(nome) ?? 0) - l.valorCentavos)
  }
  const lista = (m: Map<string, number>) => [...m].filter(([, v]) => v !== 0).map(([nome, valorCentavos]) => ({ nome, valorCentavos })).sort((a, b) => b.valorCentavos - a.valorCentavos)
  const outrasReceitas = lista(rec)
  const despesas = lista(desp)
  const outrasReceitasCentavos = outrasReceitas.reduce((s, x) => s + x.valorCentavos, 0)
  const despesasCentavos = despesas.reduce((s, x) => s + x.valorCentavos, 0)
  const lucroBrutoCentavos = p.faturamento - p.cmv
  const lucroLiquidoCentavos = lucroBrutoCentavos + outrasReceitasCentavos - despesasCentavos + diferencas
  const receitaTotal = p.faturamento + outrasReceitasCentavos
  return {
    faturamentoCentavos: p.faturamento, cmvCentavos: p.cmv, lucroBrutoCentavos, outrasReceitas, outrasReceitasCentavos, despesas, despesasCentavos,
    diferencasCaixaCentavos: diferencas, lucroLiquidoCentavos, margemLiquidaPct: receitaTotal > 0 ? (lucroLiquidoCentavos / receitaTotal) * 100 : null,
    comprasInsumosCentavos: compras, foraDoResultadoCentavos: fora,
  }
}

/** Período anterior de mesmo tamanho (para a comparação do DRE). */
export function periodoAnterior(de: string, ate: string): { de: string; ate: string } {
  const dias = Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86_400_000) + 1
  return { de: somarDias(de, -dias), ate: somarDias(de, -1) }
}

/** Variação % (null quando a base é zero). */
export function variacaoPct(atual: number, anterior: number): number | null {
  if (!anterior) return null
  return ((atual - anterior) / Math.abs(anterior)) * 100
}

/** "Pedido #123" / "#123" no texto → números de pedido citados (para barrar venda do sistema lançada à mão). */
export function numerosDePedidoCitados(texto: string): number[] {
  return [...texto.matchAll(/#\s*(\d{1,7})\b/g)].map((m) => Number(m[1]))
}
