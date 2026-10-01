/**
 * Pedidos de quem entrou SEM código confirmado (fallback com o WhatsApp da loja fora).
 *
 * Essa sessão não tem token: o histórico do servidor (/conta/pedidos) não é dela — antes
 * o fallback devolvia o token do cadastro do telefone, e com ele o histórico de quem quer
 * que fosse o dono do número. Agora o aparelho guarda só os pedidos feitos NELE, e o
 * status vem da rota pública do pedido (/pedido/<id>, só número e status, id aleatório).
 */
import type { PedidoCliente } from '@/lib/queries/pedidos'

const FINAIS = new Set(['entregue', 'cancelado'])

export interface DadosPedidoLocal {
  id: string
  numero: number
  tipo: PedidoCliente['tipo']
  formaPagamento: PedidoCliente['formaPagamento']
  subtotal: number
  desconto: number
  taxaEntrega: number
  total: number
  itens: PedidoCliente['itens']
  agora?: Date
  agendadoPara?: string | null
}

export function pedidoLocal(d: DadosPedidoLocal): PedidoCliente {
  return {
    id: d.id,
    numero: d.numero,
    status: 'recebido',
    tipo: d.tipo,
    subtotal: d.subtotal,
    desconto: d.desconto,
    total: d.total,
    taxaEntrega: d.taxaEntrega,
    formaPagamento: d.formaPagamento,
    observacao: '',
    criadoEm: (d.agora ?? new Date()).toISOString(),
    agendadoPara: d.agendadoPara ?? null,
    itens: d.itens,
  }
}

/** Atualiza o status dos pedidos em andamento. Falha de rede mantém o que já se sabia. */
export async function atualizarStatusLocais(
  lista: PedidoCliente[],
  buscar: (id: string) => Promise<{ status: PedidoCliente['status'] } | null>,
): Promise<PedidoCliente[]> {
  return Promise.all(
    lista.map(async (p) => {
      if (FINAIS.has(p.status)) return p
      try {
        const r = await buscar(p.id)
        return r ? { ...p, status: r.status } : p
      } catch {
        return p
      }
    }),
  )
}
