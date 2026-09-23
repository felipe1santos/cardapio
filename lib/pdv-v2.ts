/**
 * Regras puras do PDV v2 (balcão + conta presencial) — sem rede, sem banco.
 *
 * O que decide dinheiro e estado está nas funções do banco (0085). Aqui ficam o
 * saneamento do que o navegador manda, os rótulos das quatro dimensões e a tabela de
 * qual permissão cada ação exige — a mesma tabela para a rota (que barra) e a tela
 * (que esconde).
 */

import type { Permissao } from '@/lib/auth/permissoes'
import { soDigitos } from '@/lib/telefone-br'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ehUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

// ── abertura do balcão ──────────────────────────────────────────────────────

export type AberturaBalcao = { ok: true; nome: string; telefone: string | null; chave: string } | { ok: false; erro: string }

/** Corpo de "Novo pedido de balcão": nome obrigatório, telefone opcional, chave. Nada mais. */
export function sanearAberturaBalcao(corpo: unknown): AberturaBalcao {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>
  const nome = typeof c.nome === 'string' ? c.nome.replace(/\s+/g, ' ').trim() : ''
  if (!nome) return { ok: false, erro: 'Informe o nome do cliente.' }
  if (nome.length > 60) return { ok: false, erro: 'Nome do cliente com no máximo 60 caracteres.' }

  let telefone: string | null = null
  if (typeof c.telefone === 'string' && c.telefone.trim()) {
    const d = soDigitos(c.telefone)
    if (d.length < 10 || d.length > 13) return { ok: false, erro: 'Telefone inválido. Use DDD + número, ou deixe em branco.' }
    telefone = d
  } else if (c.telefone !== undefined && c.telefone !== null && c.telefone !== '') {
    return { ok: false, erro: 'Telefone inválido.' }
  }

  if (!ehUuid(c.chave)) return { ok: false, erro: 'Operação sem identificador. Recarregue a tela.' }
  return { ok: true, nome, telefone, chave: c.chave }
}

/** Telefone para exibir na lista: DDD e os 4 últimos. O completo só dentro da comanda. */
export function telefoneParcial(digitos: string | null | undefined): string {
  const d = soDigitos(digitos ?? '')
  if (d.length < 10) return ''
  const local = d.length > 11 ? d.slice(-11) : d
  return `(${local.slice(0, 2)}) …${local.slice(-4)}`
}

// ── dimensões ───────────────────────────────────────────────────────────────

export type StatusCozinha = 'recebido' | 'preparando' | 'pronto' | 'em_rota' | 'entregue' | 'cancelado'
export type StatusAtendimento =
  | 'aguardando_servico'
  | 'servido'
  | 'aguardando_retirada'
  | 'entregue_balcao'
  | 'nao_entregue'
  | 'concluido'
export type SituacaoFinanceira = 'nao_pago' | 'parcial' | 'pago' | 'estornado'
export type TipoComanda = 'mesa' | 'balcao'

export const ROTULO_COZINHA: Record<StatusCozinha, string> = {
  recebido: 'Aguardando aceite',
  preparando: 'Em preparo',
  pronto: 'Pronto',
  em_rota: 'Em rota',
  entregue: 'Concluído',
  cancelado: 'Cancelado',
}

export const ROTULO_ATENDIMENTO: Record<StatusAtendimento, string> = {
  aguardando_servico: 'Aguardando serviço',
  servido: 'Servido',
  aguardando_retirada: 'Aguardando retirada',
  entregue_balcao: 'Entregue no balcão',
  nao_entregue: 'Não entregue',
  concluido: 'Concluído',
}

export const ROTULO_FINANCEIRO: Record<SituacaoFinanceira, string> = {
  nao_pago: 'Não pago',
  parcial: 'Parcial',
  pago: 'Pago',
  estornado: 'Estornado',
}

/**
 * Atendimento efetivo de um pedido. Pedido anterior ao v2 tem atendimento NULL: se já
 * foi entregue, conta como atendido (legado); senão, aguarda — pela regra do status.
 */
export function atendimentoEfetivo(
  p: { status: string; atendimentoStatus: string | null },
  tipo: TipoComanda,
): StatusAtendimento | null {
  if (p.status === 'cancelado') return null
  if (p.atendimentoStatus) return p.atendimentoStatus as StatusAtendimento
  if (p.status === 'entregue') return tipo === 'mesa' ? 'servido' : 'entregue_balcao'
  return tipo === 'mesa' ? 'aguardando_servico' : 'aguardando_retirada'
}

export function situacaoFinanceira(total: number, pago: number, estornos = 0): SituacaoFinanceira {
  if (total > 0 && pago >= total) return 'pago'
  if (pago > 0) return 'parcial'
  if (estornos > 0) return 'estornado'
  return 'nao_pago'
}

export interface ResumoDimensoes {
  cozinha: { aguardando: number; preparo: number; pronto: number }
  atendimento: { aguardando: number; atendidos: number }
  texto: { cozinha: string; atendimento: string }
}

/** Uma linha por dimensão, para o cabeçalho da conta e a Central de Balcão. */
export function resumirDimensoes(
  pedidos: { status: string; atendimentoStatus: string | null }[],
  tipo: TipoComanda,
): ResumoDimensoes {
  const vivos = pedidos.filter((p) => p.status !== 'cancelado')
  const cozinha = {
    aguardando: vivos.filter((p) => p.status === 'recebido').length,
    preparo: vivos.filter((p) => p.status === 'preparando').length,
    pronto: vivos.filter((p) => p.status === 'pronto').length,
  }
  const at = vivos.map((p) => atendimentoEfetivo(p, tipo))
  const atendimento = {
    aguardando: at.filter((a) => a === 'aguardando_servico' || a === 'aguardando_retirada').length,
    atendidos: at.filter((a) => a === 'servido' || a === 'entregue_balcao' || a === 'concluido').length,
  }
  const partes: string[] = []
  if (cozinha.aguardando) partes.push(`${cozinha.aguardando} aguardando`)
  if (cozinha.preparo) partes.push(`${cozinha.preparo} em preparo`)
  if (cozinha.pronto) partes.push(`${cozinha.pronto} pronto${cozinha.pronto > 1 ? 's' : ''}`)
  const verbo = tipo === 'mesa' ? 'servido' : 'entregue'
  return {
    cozinha,
    atendimento,
    texto: {
      cozinha: vivos.length === 0 ? 'Sem pedidos' : partes.length ? partes.join(' · ') : 'Tudo pronto',
      atendimento:
        vivos.length === 0
          ? '—'
          : atendimento.aguardando
            ? `${atendimento.aguardando} aguardando`
            : `Tudo ${verbo}`,
    },
  }
}

// ── ações e permissões ──────────────────────────────────────────────────────

export const ACOES_CONTA = [
  'pagamento',
  'estorno',
  'ajustar_valores',
  'atender',
  'transicionar',
  'pendencias',
  'fechar',
  'resolver',
  'reabrir',
  'cancelar_pedido',
  'solicitar_cancelamento',
  'decidir_cancelamento',
  'cancelar_item',
  'reimprimir',
] as const
export type AcaoConta = (typeof ACOES_CONTA)[number]

/**
 * Permissão mínima de cada ação. `cancelar_pedido` aceita as duas chaves (direto só
 * recebido sem pagamento, ou qualquer estado) — o banco decide qual regra aplica.
 */
export const PERMISSAO_DA_ACAO: Record<AcaoConta, Permissao> = {
  pagamento: 'comanda.fechar',
  estorno: 'comanda.estornar',
  ajustar_valores: 'comanda.desconto',
  atender: 'pedidos.presencial.atender',
  transicionar: 'pedidos.presencial.transicionar',
  pendencias: 'comanda.ver',
  fechar: 'comanda.fechar',
  resolver: 'comanda.resolver_forcado',
  reabrir: 'comanda.reabrir',
  cancelar_pedido: 'pedidos.presencial.cancelar_recebido',
  solicitar_cancelamento: 'pedidos.presencial.solicitar_cancelamento',
  decidir_cancelamento: 'pedidos.presencial.cancelar',
  cancelar_item: 'pedidos.presencial.cancelar',
  reimprimir: 'comanda.ver',
}

export function ehAcaoConta(v: unknown): v is AcaoConta {
  return typeof v === 'string' && (ACOES_CONTA as readonly string[]).includes(v)
}

/** O que a tela pode mostrar, calculado uma vez com as regras da loja. */
export function permissoesDaConta(pode: (p: Permissao) => boolean, tipo: TipoComanda): Record<AcaoConta | 'lancar' | 'cancelar_qualquer', boolean> {
  const base = Object.fromEntries(ACOES_CONTA.map((a) => [a, pode(PERMISSAO_DA_ACAO[a])])) as Record<AcaoConta, boolean>
  return {
    ...base,
    lancar: tipo === 'balcao' ? pode('balcao.lancar') : pode('balcao.lancar') || pode('pedidos.mesa.enviar_cozinha'),
    cancelar_qualquer: pode('pedidos.presencial.cancelar'),
  }
}

// ── resolução forçada ───────────────────────────────────────────────────────

export const ACOES_RESOLUCAO = ['marcar_atendido', 'forcar_atendido', 'nao_entregue', 'cancelar_pedido', 'cancelar_itens'] as const
export type AcaoResolucao = (typeof ACOES_RESOLUCAO)[number]

export type ResolucaoSaneada =
  | { ok: true; acoes: { pedido_id: string; acao: AcaoResolucao; item_ids?: string[] }[]; motivo: string; fechar: boolean }
  | { ok: false; erro: string }

export function sanearResolucao(corpo: Record<string, unknown>): ResolucaoSaneada {
  const bruto = Array.isArray(corpo.acoes) ? corpo.acoes : []
  if (bruto.length === 0) return { ok: false, erro: 'Escolha o que fazer com pelo menos um pedido.' }
  if (bruto.length > 50) return { ok: false, erro: 'Ações demais numa resolução.' }
  const acoes: { pedido_id: string; acao: AcaoResolucao; item_ids?: string[] }[] = []
  const vistos = new Set<string>()
  for (const x of bruto) {
    const a = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    if (!ehUuid(a.pedido_id)) return { ok: false, erro: 'Pedido inválido na resolução.' }
    if (!(ACOES_RESOLUCAO as readonly string[]).includes(a.acao as string)) return { ok: false, erro: 'Ação inválida na resolução.' }
    if (vistos.has(a.pedido_id)) return { ok: false, erro: 'Um pedido aparece duas vezes na resolução.' }
    vistos.add(a.pedido_id)
    const item = { pedido_id: a.pedido_id, acao: a.acao as AcaoResolucao } as { pedido_id: string; acao: AcaoResolucao; item_ids?: string[] }
    if (a.acao === 'cancelar_itens') {
      const ids = Array.isArray(a.item_ids) ? a.item_ids.filter(ehUuid) : []
      if (ids.length === 0) return { ok: false, erro: 'Selecione os itens a cancelar.' }
      item.item_ids = ids
    }
    acoes.push(item)
  }
  const motivo = typeof corpo.motivo === 'string' ? corpo.motivo.trim().slice(0, 300) : ''
  const soMarcar = acoes.every((a) => a.acao === 'marcar_atendido')
  if (!soMarcar && motivo.length < 5) return { ok: false, erro: 'Informe o motivo (pelo menos 5 letras).' }
  if (!soMarcar && corpo.confirmacao !== true) return { ok: false, erro: 'Confirme que as ações ficam registradas com o seu nome.' }
  return { ok: true, acoes, motivo, fechar: corpo.fechar === true }
}

// ── categorias de pendência ─────────────────────────────────────────────────

export type CategoriaPendencia = 'aguardando_aceite' | 'em_preparo' | 'pronto_nao_atendido'

export const ROTULO_PENDENCIA: Record<CategoriaPendencia | 'cancelamento_pendente' | 'atendido_nao_pago' | 'parcialmente_pago', string> = {
  aguardando_aceite: 'Aguardando aceite',
  em_preparo: 'Em preparo',
  pronto_nao_atendido: 'Pronto, não entregue',
  cancelamento_pendente: 'Cancelamento pendente',
  atendido_nao_pago: 'Atendido, mas não pago',
  parcialmente_pago: 'Parcialmente pago',
}
