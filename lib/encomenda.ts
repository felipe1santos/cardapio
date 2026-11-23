/**
 * Encomendas (0250, 23/11/2026) — regras puras, usadas pela vitrine (sacola, tag, horários) e pelo servidor (que
 * confere tudo de novo ao criar o pedido). Roda no navegador: nada de biblioteca de servidor aqui.
 *
 * - Item por encomenda nunca vai na mesma sacola que item de pronta entrega (pedidos separados).
 * - A data mínima é agora + o maior prazo entre os itens da sacola.
 * - O pedido entra no Kanban/cozinha/impressão assim que é feito (liberar_em = agora; pedido do dono 23/11) e fica lá
 *   até a loja avançar — o painel tem "mostrar/esconder encomendas".
 * - Algum item com pagamento antecipado = o pedido só sai com pagamento online.
 */
import type { ConfigAgendamento } from './agendamento'

export interface ItemEncomenda {
  encomenda: boolean
  prazoHoras: number
  pagamentoAntecipado: boolean
}

export interface RegraEncomenda {
  prazoHoras: number
  pagamentoAntecipado: boolean
}

export type TipoSacola = 'vazia' | 'normal' | 'encomenda' | 'mista'

export const PRAZO_ENCOMENDA_PADRAO = 24

export function tipoDaSacola(itens: { encomenda: boolean }[]): TipoSacola {
  if (itens.length === 0) return 'vazia'
  const enc = itens.filter((i) => i.encomenda).length
  if (enc === 0) return 'normal'
  return enc === itens.length ? 'encomenda' : 'mista'
}

/** Aviso da sacola com encomenda + pronta entrega (a sacola bloqueia o "Continuar"). */
export function avisoSacolaMista(nomesEncomenda: string[]): string {
  const nomes = [...new Set(nomesEncomenda)]
  const quem = nomes.length === 1
    ? `"${nomes[0]}" é feito por encomenda.`
    : nomes.length === 2 ? `"${nomes[0]}" e "${nomes[1]}" são feitos por encomenda.` : `${nomes.length} itens são feitos por encomenda.`
  return `${quem} Peça os itens de encomenda e os de pronta entrega em pedidos separados.`
}

/** Mensagem do servidor para sacola mista (vitrine antiga aberta, pedido montado à mão). */
export const ERRO_SACOLA_MISTA = 'Itens por encomenda precisam ser pedidos separados dos itens de pronta entrega.'

export function regraEncomenda(itens: ItemEncomenda[]): RegraEncomenda | null {
  const enc = itens.filter((i) => i.encomenda)
  if (enc.length === 0) return null
  return {
    prazoHoras: Math.max(...enc.map((i) => i.prazoHoras)),
    pagamentoAntecipado: enc.some((i) => i.pagamentoAntecipado),
  }
}

/** "6 h", "24 h", "2 dias" (dias só quando o prazo é múltiplo de 24 a partir de 48 h). */
export function textoPrazoEncomenda(horas: number): string {
  if (horas >= 48 && horas % 24 === 0) return `${horas / 24} dias`
  return `${horas} h`
}

/** Confere a encomenda no servidor. Devolve a mensagem para o cliente ou null (ok). */
export function motivoEncomendaInvalida(
  regra: RegraEncomenda,
  agendadoPara: string | null | undefined,
  pagamentoOnline: boolean,
  agora: Date = new Date(),
): string | null {
  if (!agendadoPara) return 'Escolha a data e o horário da encomenda.'
  const t = new Date(agendadoPara).getTime()
  if (!Number.isFinite(t)) return 'Escolha a data e o horário da encomenda.'
  if (t < agora.getTime() + regra.prazoHoras * 3600_000) {
    return `Esta encomenda precisa de pelo menos ${textoPrazoEncomenda(regra.prazoHoras)} de antecedência. Escolha outra data.`
  }
  if (regra.pagamentoAntecipado && !pagamentoOnline) return 'Esta encomenda precisa ser paga antecipado, pelo Pix ou cartão online.'
  return null
}

/**
 * Horários oferecidos para a encomenda: independem do agendamento da loja estar ligado (só o intervalo é da loja).
 * Antecedência = prazo; sem limite por horário (encomenda não ocupa vaga do agendado); a janela cobre o prazo + 2 semanas.
 */
export function configAgendamentoEncomenda(loja: ConfigAgendamento, prazoHoras: number): ConfigAgendamento {
  return {
    ...loja,
    ativo: true,
    quando: 'sempre',
    antecedenciaMin: prazoHoras * 60,
    limite: null,
    entrega: true,
    retirada: true,
    dias: Math.min(45, Math.max(loja.dias, Math.ceil(prazoHoras / 24) + 14)),
  }
}

/**
 * Lembrete da véspera: entre 24 h e 1 h antes do horário, e só se o pedido foi feito ANTES da janela abrir (mais de
 * 25 h antes). Sem isso, a encomenda de prazo 24 h (o padrão) receberia "é amanhã" minutos depois de feita (revisão
 * 23/11). O banco filtra a janela (cron) e reserva o envio.
 */
export const LEMBRETE_JANELA_H = 24
export const LEMBRETE_MINIMO_H = 1
export const LEMBRETE_FOLGA_H = LEMBRETE_JANELA_H + 1

export function lembreteDevido(agendadoPara: string, criadoEm: string, agora: Date = new Date()): boolean {
  const t = Date.parse(agendadoPara), c = Date.parse(criadoEm), a = agora.getTime()
  const falta = t - a
  return falta <= LEMBRETE_JANELA_H * 3600_000 && falta > LEMBRETE_MINIMO_H * 3600_000 && t - c >= LEMBRETE_FOLGA_H * 3600_000
}

/** Linha de itens_cardapio (colunas da 0250) → regra do item. Coluna ausente/linha nula = item comum. */
export function itemEncomendaDaLinha(row: Record<string, unknown> | null | undefined): ItemEncomenda {
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    encomenda: row?.encomenda === true,
    prazoHoras: n(row?.encomenda_prazo_horas, PRAZO_ENCOMENDA_PADRAO),
    pagamentoAntecipado: row?.encomenda_pagamento_antecipado === true,
  }
}

/** Encomenda no item (tela e cadastro). Null = item de pronta entrega. */
export interface EncomendaItem {
  prazoHoras: number
  pagamentoAntecipado: boolean
}

export function encomendaDoItem(row: Record<string, unknown> | null | undefined): EncomendaItem | null {
  const r = itemEncomendaDaLinha(row)
  return r.encomenda ? { prazoHoras: r.prazoHoras, pagamentoAntecipado: r.pagamentoAntecipado } : null
}

const limitar = (v: number, min: number, max: number, padrao: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : padrao)

/** Cadastro → colunas (0250). Desligar mantém prazos guardados como padrão — só a chave sai. */
export function colunasEncomenda(e: EncomendaItem | null): Record<string, unknown> {
  if (!e) return { encomenda: false, encomenda_pagamento_antecipado: false }
  return {
    encomenda: true,
    encomenda_prazo_horas: limitar(e.prazoHoras, 1, 720, PRAZO_ENCOMENDA_PADRAO),
    encomenda_pagamento_antecipado: e.pagamentoAntecipado === true,
  }
}
