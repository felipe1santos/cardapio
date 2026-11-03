/**
 * Planos da Menuzia e as regras de prazo da assinatura (docs/ASSINATURA-ASAAS.md).
 *
 * Valores e conteúdo vêm do site (www.menuzia.com.br, 02/11/2026): Básico R$ 97 e Completo R$ 149.
 * O que muda entre eles no sistema são as três chaves do Super Admin (`loja_modulos`): o Completo
 * liga Agente de IA, Disparos e Financeiro; o Básico deixa as três com o cadeado.
 */
import type { Modulo } from '@/lib/modulos'

export type Plano = 'basico' | 'completo'

export const PLANOS: Record<Plano, { nome: string; valor: number; modulos: Record<Modulo, boolean> }> = {
  basico: { nome: 'Menuzia Básico', valor: 97, modulos: { financeiro: false, agente_ia: false, disparos: false } },
  completo: { nome: 'Menuzia Completo', valor: 149, modulos: { financeiro: true, agente_ia: true, disparos: true } },
}

/** O que cada plano inclui, na ordem do site (www.menuzia.com.br › Planos). O Completo lista só o que soma ao Básico. */
export const BENEFICIOS: Record<Plano, { descricao: string; itens: string[]; condicao: string }> = {
  basico: {
    descricao: 'Cardápio, PDV e a operação do delivery e do salão.',
    itens: [
      'Cardápio digital personalizado', 'Mesas com QR Code, tablet e totem', 'Integração com iFood, 99Food e aiqfome', 'Dashboard e funil de vendas',
      'Cupons, fidelidade e order bump', 'PDV touch e controle de caixa', 'Pix e cartão online', 'Impressão automática e KDS', 'Aplicativo do entregador com GPS', 'Configuração e suporte inclusos',
    ],
    condicao: 'Sem taxa por pedido. Sem contrato.',
  },
  completo: {
    descricao: 'Tudo do Básico + automação no WhatsApp e gestão financeira.',
    itens: ['Robô de atendimento 24h no WhatsApp', 'Disparo de mensagens e campanhas (API oficial)', 'Sistema financeiro: fluxo de caixa e contas', 'Insumos, ficha técnica e lucro real por produto'],
    condicao: 'Sem taxa por pedido. Sem contrato. Cancele quando quiser.',
  },
}

/** Dias depois do vencimento em que o acesso continua (decisão do dono, 02/11). */
export const CARENCIA_DIAS = 5

export function planoValido(v: unknown): v is Plano {
  return v === 'basico' || v === 'completo'
}

/**
 * Valor cobrado. `ASSINATURA_VALOR_TESTE` (só no Coolify, só na primeira rodada em produção) substitui o valor do
 * plano para o dono pagar R$ 1 e provar o fluxo inteiro. Vazio ou inválido = valor do plano.
 */
export function valorDoPlano(plano: Plano, env: Record<string, string | undefined> = process.env): number {
  const teste = Number(env.ASSINATURA_VALOR_TESTE)
  if (Number.isFinite(teste) && teste > 0) return Math.round(teste * 100) / 100
  return PLANOS[plano].valor
}

/** Soma `meses` meses a uma data "YYYY-MM-DD" (31/01 + 1 mês = 28/02 ou 29/02: dia travado no fim do mês). */
export function somarMeses(dataIso: string, meses: number): string {
  const [a, m, d] = dataIso.split('-').map(Number)
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1))
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  alvo.setUTCDate(Math.min(d, ultimoDia))
  return alvo.toISOString().slice(0, 10)
}

export function somarDias(dataIso: string, dias: number): string {
  const [a, m, d] = dataIso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

/**
 * Até quando o acesso vale depois de uma cobrança paga com vencimento `vencimentoIso` ("YYYY-MM-DD"):
 * vencimento + 1 mês + carência, às 23:59:59 de São Paulo, em ISO. É o valor de `usuarios.acesso_expira_em`.
 */
export function validadeAposPagamento(vencimentoIso: string): string {
  const fim = somarDias(somarMeses(vencimentoIso, 1), CARENCIA_DIAS)
  return new Date(`${fim}T23:59:59-03:00`).toISOString()
}

/** Renovação nunca encurta: fica a maior entre a validade atual e a nova. */
export function novaValidade(atualIso: string | null, vencimentoIso: string): string {
  const nova = validadeAposPagamento(vencimentoIso)
  if (!atualIso) return nova
  return new Date(atualIso).getTime() > new Date(nova).getTime() ? atualIso : nova
}

/** Hoje em São Paulo, "YYYY-MM-DD" — o vencimento da primeira cobrança. */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')}`
}
