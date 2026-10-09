import type { AcaoFin } from './permissoes'
import type { LinhaLancamento } from './ledger'
import { formatarCentavos } from './centavos'

/**
 * Regras do caixa (Fase 2) — puras, testadas, usadas pelo servidor.
 *
 * Cada movimento manual é um par de linhas no livro-caixa: o dinheiro sai (ou entra) da GAVETA e
 * vai para onde foi de verdade — o cofre/conta da empresa (sangria, retirada, reforço) ou o
 * resultado (despesa, perda). Assim a gaveta esperada no fechamento é só somar a carteira gaveta.
 */
export const MOVIMENTOS = ['sangria', 'reforco', 'despesa', 'retirada', 'perda'] as const
export type Movimento = (typeof MOVIMENTOS)[number]

export const ROTULO_MOVIMENTO: Record<Movimento, string> = {
  sangria: 'Sangria',
  reforco: 'Reforço',
  despesa: 'Despesa',
  retirada: 'Retirada',
  perda: 'Perda / quebra',
}

export const DESCRICAO_MOVIMENTO: Record<Movimento, string> = {
  sangria: 'Tirar dinheiro da gaveta para o cofre ou o banco.',
  reforco: 'Pôr mais troco na gaveta.',
  despesa: 'Pagar uma conta com dinheiro da gaveta (gás, entregador extra…).',
  retirada: 'O dono tirou dinheiro da gaveta para uso próprio.',
  perda: 'Dinheiro que sumiu ou nota falsa.',
}

/** Permissão que cada movimento exige. */
export function permissaoDoMovimento(m: Movimento): AcaoFin {
  return m === 'despesa' ? 'despesa' : 'sangria'
}

/** Linhas do livro-caixa (centavos, com sinal) para um movimento de `valor` centavos (> 0). */
export function linhasDoMovimento(m: Movimento, valor: number): LinhaLancamento[] {
  const v = Math.abs(Math.trunc(valor))
  switch (m) {
    case 'reforco': return [{ carteira: 'gaveta', tipo: 'reforco', valorCentavos: v, forma: 'dinheiro' }, { carteira: 'empresa', tipo: 'reforco', valorCentavos: -v, forma: 'dinheiro' }]
    case 'sangria': return [{ carteira: 'gaveta', tipo: 'sangria', valorCentavos: -v, forma: 'dinheiro' }, { carteira: 'empresa', tipo: 'sangria', valorCentavos: v, forma: 'dinheiro' }]
    case 'retirada': return [{ carteira: 'gaveta', tipo: 'retirada', valorCentavos: -v, forma: 'dinheiro' }, { carteira: 'empresa', tipo: 'retirada', valorCentavos: v, forma: 'dinheiro' }]
    case 'despesa': return [{ carteira: 'gaveta', tipo: 'despesa', valorCentavos: -v, forma: 'dinheiro' }, { carteira: 'resultado', tipo: 'despesa', valorCentavos: -v, forma: 'dinheiro' }]
    case 'perda': return [{ carteira: 'gaveta', tipo: 'perda', valorCentavos: -v, forma: 'dinheiro' }, { carteira: 'resultado', tipo: 'perda', valorCentavos: -v, forma: 'dinheiro' }]
  }
}

/** Fundo de troco na abertura: entra na gaveta vindo do cofre. Zero = sem linhas. */
export function linhasDaAbertura(fundo: number): LinhaLancamento[] {
  if (fundo <= 0) return []
  return [{ carteira: 'gaveta', tipo: 'abertura', valorCentavos: fundo, forma: 'dinheiro' }, { carteira: 'empresa', tipo: 'abertura', valorCentavos: -fundo, forma: 'dinheiro' }]
}

/**
 * Precisa da aprovação de OUTRA pessoa (PIN)? Saídas da gaveta acima do limite da loja. O dono não
 * precisa (é ele quem aprovaria). Reforço (dinheiro entrando) nunca precisa.
 */
export function precisaAprovacao(p: { movimento: Movimento; valor: number; limite: number; papel: string }): boolean {
  if (p.papel === 'dono' || p.movimento === 'reforco') return false
  return p.valor > p.limite
}

/**
 * Sangria maior que o dinheiro esperado na gaveta: recusa com "Só há R$ X na gaveta". Sem isso a
 * gaveta ficava negativa (sangria de R$ 150 com R$ 109 — auditoria de 09/10). null = pode.
 */
export function faltaNaGaveta(p: { movimento: Movimento; valor: number; gaveta: number }): string | null {
  if (p.movimento !== 'sangria' || p.valor <= p.gaveta) return null
  return `Só há ${formatarCentavos(Math.max(0, p.gaveta))} na gaveta.`
}

/** Resultado da contagem cega: diferença (contado − esperado) e se passa do limite da loja. */
export function avaliarContagem(p: { esperado: number; contado: number; limite: number }): { diferenca: number; acimaDoLimite: boolean } {
  const diferenca = p.contado - p.esperado
  return { diferenca, acimaDoLimite: Math.abs(diferenca) > p.limite }
}

/** Linhas de ajuste do fechamento: a gaveta passa a valer o contado; a diferença vai para o resultado. */
export function linhasDoAjuste(diferenca: number): LinhaLancamento[] {
  if (!diferenca) return []
  return [{ carteira: 'gaveta', tipo: 'ajuste', valorCentavos: diferenca, forma: 'dinheiro', dados: { motivo: diferenca < 0 ? 'falta no fechamento' : 'sobra no fechamento' } },
    { carteira: 'resultado', tipo: 'ajuste', valorCentavos: diferenca, forma: 'dinheiro' }]
}

/** Texto curto "há 3 h 20 min" para o aviso do topo. */
export function tempoAberto(desdeIso: string, agora = Date.now()): string {
  const min = Math.max(0, Math.floor((agora - new Date(desdeIso).getTime()) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
}
