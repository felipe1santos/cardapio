import type { SupabaseClient } from '@supabase/supabase-js'
import { STATUS_NAO_CANCELAVEIS, type MotivoCancelamento } from '@/lib/cancelamento'
import { registrarAuditoria } from '@/lib/auditoria'
import { aDevolverAoCancelar } from '@/lib/pagamentos/pix-online'
import { reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import { aplicarEfeitosStatusPedidoComTrava } from '@/lib/pedido-eventos'

/**
 * Cancelamento de um pedido de DELIVERY pelo servidor (18/10) — o mesmo efeito do botão Cancelar do painel
 * (app/api/admin/pedidos/[id]/cancelar): status, motivo, reimprimir=false, auditoria, "a devolver" se pago online,
 * fidelidade revertida e o WhatsApp de cancelado. Usado pelas solicitações do cliente (robô/IA) quando a loja aplica
 * ou quando o cancelamento é automático (Recebido e não pago online). Pedido presencial não passa por aqui.
 */
export async function cancelarPedidoDelivery(admin: SupabaseClient, p: {
  restauranteId: string; pedidoId: string; motivo: MotivoCancelamento; observacao: string; por: { id: string | null; nome: string }; acao?: string
  /** O que vai em `cancelado_por` (quem cancelou, com o prefixo de lib/cancelamento.ts). Padrão: por.nome. */
  canceladoPor?: string
}): Promise<{ ok: true; numero: number } | { ok: false; erro: string; status: number }> {
  const { data: ped } = await admin.from('pedidos').select('id, numero, canal, comanda_id, status').eq('id', p.pedidoId).eq('restaurante_id', p.restauranteId).maybeSingle()
  if (!ped) return { ok: false, erro: 'Pedido não encontrado.', status: 404 }
  if (ped.comanda_id && (ped.canal === 'mesa' || ped.canal === 'balcao')) return { ok: false, erro: 'Pedido de conta se cancela pelo PDV.', status: 409 }
  const { data, error } = await admin.from('pedidos').update({
    status: 'cancelado', cancelado_motivo: p.motivo, cancelado_observacao: p.observacao.slice(0, 300) || null, cancelado_por: (p.canceladoPor ?? p.por.nome).slice(0, 120),
    cancelado_em: new Date().toISOString(), reimprimir: false,
  }).eq('id', p.pedidoId).eq('restaurante_id', p.restauranteId).not('status', 'in', `(${STATUS_NAO_CANCELAVEIS.join(',')})`).select('id')
  if (error) return { ok: false, erro: 'Erro ao cancelar pedido.', status: 500 }
  if (!data?.length) return { ok: false, erro: 'Pedido já finalizado ou cancelado.', status: 409 }
  await registrarAuditoria(admin, { restauranteId: p.restauranteId, usuarioId: p.por.id, usuarioNome: p.por.nome, acao: p.acao ?? 'pedido.cancelou', entidade: 'pedido', entidadeId: p.pedidoId, dados: { motivo: p.motivo, observacao: p.observacao || null, canal: 'delivery' } }).catch(() => {})
  await aDevolverAoCancelar(admin, p.restauranteId, { id: p.pedidoId, numero: ped.numero as number }).catch(() => 0)
  reverterBeneficiosPedidoCancelado(admin, p.restauranteId, p.pedidoId).catch(console.error)
  aplicarEfeitosStatusPedidoComTrava(admin, p.pedidoId, 'cancelado').catch(() => null)
  return { ok: true, numero: ped.numero as number }
}
