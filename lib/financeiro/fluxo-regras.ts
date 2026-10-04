/**
 * Fluxo de Caixa (Fase 4, 2026-10-04) — regras puras: filtros ↔ URL, atalhos de período,
 * colunas e CSV para Excel em português. Sem banco: testado em fluxo-regras.test.ts.
 *
 * Regras de cálculo (feitas no banco por `fin_fluxo_turnos`, 0140):
 * - Turno que passa da meia-noite pertence à DATA DE ABERTURA (horário de São Paulo).
 * - Lançamento sem turno (entrega registrada pelo motoboy, Pix conferido sem caixa aberto) cai no turno cuja
 *   janela (abertura → fechamento) contém o horário dele; fora de qualquer janela, na linha "Fora de turno".
 * - Vendido = recebimentos (+ troco devolvido pelo motoboy) − estornos, fora das contrapartidas (empresa/resultado).
 *   Recebido = vendido − "a receber" (fiado, não pago, Nexta).
 * - Esperado em dinheiro: o que o fechamento GRAVOU (turno fechado) ou o saldo da gaveta agora (turno aberto).
 */

export const ORIGENS = [
  { id: 'balcao', rotulo: 'PDV / balcão' },
  { id: 'mesa', rotulo: 'Mesas / comandas' },
  { id: 'delivery', rotulo: 'Delivery' },
  { id: 'online', rotulo: 'Online' },
  { id: 'manual', rotulo: 'Manual' },
] as const
export const FORMAS = [
  { id: 'dinheiro', rotulo: 'Dinheiro' },
  { id: 'pix', rotulo: 'Pix' },
  { id: 'cartao', rotulo: 'Cartão' },
  { id: 'outros', rotulo: 'Outros (fiado, vale…)' },
] as const
export const SITUACOES = [
  { id: 'aberto', rotulo: 'Em andamento' },
  { id: 'fechado', rotulo: 'Fechado' },
  { id: 'divergente', rotulo: 'Divergente' },
  { id: 'reaberto', rotulo: 'Reaberto' },
] as const
export const ATALHOS = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'ontem', rotulo: 'Ontem' },
  { id: '7d', rotulo: '7 dias' },
  { id: '30d', rotulo: '30 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'mes_passado', rotulo: 'Mês passado' },
] as const
export type Atalho = (typeof ATALHOS)[number]['id']

export interface FiltrosFluxo {
  de: string // AAAA-MM-DD
  ate: string
  origens: string[]
  formas: string[]
  situacoes: string[]
  operador: string | null
  motoboy: string | null
  produto: string | null
}

const DATA = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f-]{36}$/i

/** Dia de hoje (AAAA-MM-DD) em São Paulo. */
export function hojeSP(agora = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}
function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function periodoDoAtalho(a: Atalho, agora = new Date()): { de: string; ate: string } {
  const hoje = hojeSP(agora)
  switch (a) {
    case 'hoje': return { de: hoje, ate: hoje }
    case 'ontem': { const o = somarDias(hoje, -1); return { de: o, ate: o } }
    case '7d': return { de: somarDias(hoje, -6), ate: hoje }
    case '30d': return { de: somarDias(hoje, -29), ate: hoje }
    case 'mes': return { de: `${hoje.slice(0, 7)}-01`, ate: hoje }
    case 'mes_passado': {
      const primeiro = `${hoje.slice(0, 7)}-01`
      const fimAnterior = somarDias(primeiro, -1)
      return { de: `${fimAnterior.slice(0, 7)}-01`, ate: fimAnterior }
    }
  }
}

/** Qual atalho corresponde ao período (para destacar o botão); null = personalizado. */
export function atalhoDoPeriodo(de: string, ate: string, agora = new Date()): Atalho | null {
  return ATALHOS.find((a) => { const p = periodoDoAtalho(a.id, agora); return p.de === de && p.ate === ate })?.id ?? null
}

const lista = (v: string | null, validos: readonly { id: string }[]) =>
  (v ?? '').split(',').map((x) => x.trim()).filter((x) => validos.some((o) => o.id === x))

/** Lê os filtros da URL (ou de qualquer URLSearchParams), com padrão "últimos 7 dias". */
export function lerFiltros(sp: URLSearchParams, agora = new Date()): FiltrosFluxo {
  const padrao = periodoDoAtalho('7d', agora)
  let de = DATA.test(sp.get('de') ?? '') ? sp.get('de')! : padrao.de
  let ate = DATA.test(sp.get('ate') ?? '') ? sp.get('ate')! : padrao.ate
  if (de > ate) [de, ate] = [ate, de]
  // Período máximo de 400 dias (um ano e pouco) — a agregação é no banco, mas a tela tem limite.
  if ((new Date(ate).getTime() - new Date(de).getTime()) / 86_400_000 > 400) de = somarDias(ate, -400)
  const id = (k: string) => { const v = sp.get(k); return v && UUID.test(v) ? v : null }
  return {
    de, ate,
    origens: lista(sp.get('origem'), ORIGENS),
    formas: lista(sp.get('forma'), FORMAS),
    situacoes: lista(sp.get('status'), SITUACOES),
    operador: id('operador'),
    motoboy: id('motoboy'),
    produto: id('produto'),
  }
}

/** Filtros → query string (só o que difere do vazio). */
export function filtrosParaQuery(f: FiltrosFluxo): string {
  const sp = new URLSearchParams()
  sp.set('de', f.de)
  sp.set('ate', f.ate)
  if (f.origens.length) sp.set('origem', f.origens.join(','))
  if (f.formas.length) sp.set('forma', f.formas.join(','))
  if (f.situacoes.length) sp.set('status', f.situacoes.join(','))
  if (f.operador) sp.set('operador', f.operador)
  if (f.motoboy) sp.set('motoboy', f.motoboy)
  if (f.produto) sp.set('produto', f.produto)
  return sp.toString()
}

export function temFiltroAlemDoPeriodo(f: FiltrosFluxo): boolean {
  return !!(f.origens.length || f.formas.length || f.situacoes.length || f.operador || f.motoboy || f.produto)
}

// ── Linha do fluxo (o que a API devolve) ─────────────────────────────────────────────────────
export type Situacao = 'aberto' | 'fechado' | 'divergente' | 'reaberto' | 'sem_turno'
export interface LinhaFluxo {
  turnoId: string | null
  data: string | null // AAAA-MM-DD da abertura
  abertoEm: string | null
  abertoPor: string | null
  fechadoEm: string | null
  fechadoPor: string | null
  situacao: Situacao
  reabertoEm: string | null
  reabertoPor: string | null
  reabertoMotivo: string | null
  valorInicial: number
  vendido: number
  recebido: number
  aReceber: number
  dinheiro: number
  pix: number
  pixConfirmado: number
  pixAConferir: number
  cartao: number
  outros: number
  origemBalcao: number
  origemMesa: number
  origemDelivery: number
  origemOnline: number
  origemManual: number
  taxas: number
  descontos: number
  cancelamentos: number
  cancelamentosQtd: number
  estornos: number
  sangrias: number
  reforcos: number
  despesas: number
  motoboy: number
  esperado: number | null
  informado: number | null
  diferenca: number | null
  diferencaCartao: number | null
  contadoCartao: number | null
  esperadoCartao: number | null
  observacoes: string | null
  lancamentos: number
  produtoQtd: number | null
  produtoValor: number | null
}

/** Colunas somáveis (linha de totais). */
export const SOMAVEIS = [
  'valorInicial', 'vendido', 'recebido', 'aReceber', 'dinheiro', 'pix', 'pixConfirmado', 'pixAConferir', 'cartao', 'outros',
  'origemBalcao', 'origemMesa', 'origemDelivery', 'origemOnline', 'origemManual', 'taxas', 'descontos', 'cancelamentos',
  'cancelamentosQtd', 'estornos', 'sangrias', 'reforcos', 'despesas', 'motoboy', 'esperado', 'informado', 'diferenca', 'lancamentos',
  'produtoQtd', 'produtoValor',
] as const satisfies readonly (keyof LinhaFluxo)[]
export type Somavel = (typeof SOMAVEIS)[number]

export function totalizar(linhas: LinhaFluxo[]): Record<Somavel, number> {
  const t = Object.fromEntries(SOMAVEIS.map((k) => [k, 0])) as Record<Somavel, number>
  for (const l of linhas) for (const k of SOMAVEIS) t[k] += Number(l[k] ?? 0)
  return t
}

// ── Colunas da tabela ────────────────────────────────────────────────────────────────────────
export type TipoColuna = 'texto' | 'data' | 'dataHora' | 'centavos' | 'numero' | 'situacao' | 'diferenca'
export interface ColunaFluxo { id: keyof LinhaFluxo | 'abertura' | 'fechamento'; rotulo: string; tipo: TipoColuna; principal?: boolean }
export const COLUNAS: ColunaFluxo[] = [
  { id: 'data', rotulo: 'Data', tipo: 'data', principal: true },
  { id: 'situacao', rotulo: 'Status', tipo: 'situacao', principal: true },
  { id: 'abertura', rotulo: 'Abertura', tipo: 'texto', principal: true },
  { id: 'valorInicial', rotulo: 'Valor inicial', tipo: 'centavos' },
  { id: 'fechamento', rotulo: 'Fechamento', tipo: 'texto' },
  { id: 'vendido', rotulo: 'Vendido', tipo: 'centavos', principal: true },
  { id: 'recebido', rotulo: 'Recebido', tipo: 'centavos', principal: true },
  { id: 'dinheiro', rotulo: 'Dinheiro', tipo: 'centavos', principal: true },
  { id: 'pixConfirmado', rotulo: 'Pix confirmado', tipo: 'centavos' },
  { id: 'pixAConferir', rotulo: 'Pix a conferir', tipo: 'centavos', principal: true },
  { id: 'pix', rotulo: 'Pix (total)', tipo: 'centavos' },
  { id: 'cartao', rotulo: 'Cartão', tipo: 'centavos', principal: true },
  { id: 'outros', rotulo: 'Outras formas', tipo: 'centavos' },
  { id: 'aReceber', rotulo: 'A receber', tipo: 'centavos' },
  { id: 'origemBalcao', rotulo: 'PDV / balcão', tipo: 'centavos' },
  { id: 'origemMesa', rotulo: 'Mesas / comandas', tipo: 'centavos' },
  { id: 'origemDelivery', rotulo: 'Delivery', tipo: 'centavos' },
  { id: 'origemOnline', rotulo: 'Online', tipo: 'centavos' },
  { id: 'taxas', rotulo: 'Taxas', tipo: 'centavos' },
  { id: 'descontos', rotulo: 'Descontos', tipo: 'centavos' },
  { id: 'cancelamentos', rotulo: 'Cancelamentos', tipo: 'centavos' },
  { id: 'estornos', rotulo: 'Estornos', tipo: 'centavos' },
  { id: 'sangrias', rotulo: 'Sangrias', tipo: 'centavos' },
  { id: 'despesas', rotulo: 'Despesas', tipo: 'centavos' },
  { id: 'motoboy', rotulo: 'Dinheiro c/ motoboy', tipo: 'centavos' },
  { id: 'esperado', rotulo: 'Dinheiro esperado', tipo: 'centavos', principal: true },
  { id: 'informado', rotulo: 'Dinheiro informado', tipo: 'centavos', principal: true },
  { id: 'diferenca', rotulo: 'Diferença', tipo: 'diferenca', principal: true },
  { id: 'observacoes', rotulo: 'Observações', tipo: 'texto' },
]
export const COLUNAS_PADRAO = COLUNAS.filter((c) => c.principal).map((c) => c.id)

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  aberto: 'Em andamento', fechado: 'Fechado', divergente: 'Divergente', reaberto: 'Reaberto', sem_turno: 'Fora de turno',
}
/** Cor viva com texto branco (contraste ≥ 4,5:1). */
/** Paleta "estilo Meta" (item 4b, 2026-10-04); todas com texto branco ≥ 4,5:1. */
export const COR_SITUACAO: Record<Situacao, string> = {
  aberto: '#0A78BE', fechado: '#006B4E', divergente: '#D93616', reaberto: '#8A4B00', sem_turno: '#465A69',
}
/** Diferença: verde se zero, vermelho se falta, âmbar escuro se sobra. */
export function corDiferenca(d: number | null): string | null {
  if (d === null || d === undefined) return null
  return d === 0 ? '#006B4E' : d < 0 ? '#D93616' : '#8A4B00'
}

// ── Formatos pt-BR (CSV e telas) ─────────────────────────────────────────────────────────────
/** 123456 → "1.234,56" (sem "R$", para planilha). */
export function valorBR(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined) return ''
  const neg = centavos < 0
  const abs = Math.abs(Math.round(centavos))
  const inteiro = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${neg ? '-' : ''}${inteiro},${String(abs % 100).padStart(2, '0')}`
}
/** ISO → "dd/mm/aaaa hh:mm" em São Paulo. */
export function dataHoraBR(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`
}
/** "2026-10-04" → "04/10/2026". */
export function dataBR(dia: string | null | undefined): string {
  if (!dia) return ''
  const [a, m, d] = dia.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────
export const BOM = '﻿'
/** Célula de CSV: número formatado (nunca escapado) ou texto (protegido contra fórmula). */
export type Celula = string | { n: number | null } | null | undefined

/**
 * Texto que começa com = + - @ (ou tab/CR) vira fórmula no Excel. Prefixamos com ' para ficar texto
 * (OWASP "CSV injection"). Números do próprio relatório não passam por aqui.
 */
export function protegerFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}
function celulaCsv(c: Celula): string {
  if (c === null || c === undefined) return ''
  const s = typeof c === 'string' ? protegerFormula(c) : valorBR(c.n)
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
/** CSV pronto para o Excel em português: UTF-8 com BOM, separador ";", fim de linha CRLF. */
export function gerarCsvBR(linhas: Celula[][]): string {
  return BOM + linhas.map((l) => l.map(celulaCsv).join(';')).join('\r\n') + '\r\n'
}

// ── Rótulos do extrato ───────────────────────────────────────────────────────────────────────
export const ROTULO_TIPO: Record<string, string> = {
  abertura: 'Fundo de troco', recebimento: 'Recebimento', troco: 'Troco devolvido', estorno: 'Estorno', sangria: 'Sangria',
  reforco: 'Reforço', despesa: 'Despesa', compra: 'Compra', retirada: 'Retirada', perda: 'Perda', ajuste: 'Ajuste',
  troco_motoboy: 'Troco para o motoboy', acerto_motoboy: 'Acerto do motoboy', pendencia_motoboy: 'Pendência do motoboy',
  pix_confirmado: 'Pix conferido', taxa: 'Taxa', desconto: 'Desconto', venda: 'Venda', conta_pagar: 'Conta a pagar',
  conta_receber: 'Conta a receber', outro: 'Outro',
}
export const ROTULO_CARTEIRA: Record<string, string> = {
  gaveta: 'Gaveta (dinheiro)', motoboy: 'Com o motoboy', pix_conferir: 'Pix a conferir', cartao: 'Cartão / maquininha',
  empresa: 'Conta da empresa', a_receber: 'A receber', resultado: 'Resultado',
}
export const ROTULO_FORMA: Record<string, string> = {
  dinheiro: 'Dinheiro', pix: 'Pix', credito: 'Crédito', debito: 'Débito', cartao: 'Cartão', vale: 'Vale', fiado: 'Fiado',
  transferencia: 'Transferência', boleto: 'Boleto', outro: 'Outro',
}
export const ROTULO_ORIGEM: Record<string, string> = {
  pdv: 'PDV', balcao: 'Balcão', mesa: 'Mesa', delivery: 'Delivery', motoboy: 'Motoboy', online: 'Online', manual: 'Manual', sistema: 'Sistema',
}

export interface LancamentoExtrato {
  id: number
  seq: number
  criadoEm: string
  tipo: string
  carteira: string
  descricao: string
  origem: string | null
  forma: string | null
  valor: number
  pedidoId: string | null
  pedidoNumero: number | null
  comandaId: string | null
  usuario: string | null
  aprovadoPor: string | null
  motivo: string | null
  referenciaId: number | null
  /** Original de um estorno/ajuste/Pix: em que turno ele está (link quando for de outro turno). */
  referencia: { id: number; tipo: string; criadoEm: string; turnoId: string | null; valor: number } | null
  /** Linha sem turno no banco (entrega/Pix sem caixa) que caiu neste turno pela janela de horário. */
  semTurno: boolean
}
