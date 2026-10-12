/**
 * Agente de IA — avisos que o SERVIDOR manda sozinho na conversa (12/10), cada um uma vez só (chave única na fila):
 *  - Pix do pedido da IA expirou: pergunta se gera outro ou paga na entrega (no lugar do aviso genérico de cancelado),
 *    e reabre os 30 min com a IA para a resposta do cliente.
 *  - Pediu atendente (pela IA) e ninguém da loja respondeu em 10 min: avisa que a loja já foi avisada.
 * Só banco próprio e a fila do WhatsApp (Evolution): nenhuma API paga.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { enfileirar } from '@/lib/mensageria/fila'

export const AVISO_ATENDENTE_MS = 10 * 60_000
const JANELA_ATENDENTE_MS = 12 * 3600_000

export const textoPixExpirado = (numero: number) =>
  `Seu Pix do pedido #${numero} expirou 😕 Quer que eu gere outro ou prefere pagar na entrega (cartão ou dinheiro)?`
export const TEXTO_LOJA_AVISADA = 'A loja já foi avisada e já vai te responder, só mais um pouquinho 🙏'

/** Pedido criado pela IA? Avisa na conversa dele e devolve true; senão false (quem chama manda o aviso padrão). */
export async function avisarPixExpiradoIa(admin: SupabaseClient, restauranteId: string, pedidoId: string): Promise<boolean> {
  const { data: conv } = await admin.from('whatsapp_conversas').select('id, telefone').eq('restaurante_id', restauranteId).eq('ia_pedido_id', pedidoId).maybeSingle()
  if (!conv) return false
  const { data: ped } = await admin.from('pedidos').select('numero').eq('id', pedidoId).maybeSingle()
  await enfileirar(admin, {
    restauranteId, chave: `ia_pix_expirado:${pedidoId}`, tipo: 'ia', telefone: conv.telefone as string,
    texto: textoPixExpirado(Number(ped?.numero) || 0), conversaId: conv.id as string, pedidoId,
  })
  await admin.from('whatsapp_conversas').update({ ia_pedido_em: new Date().toISOString(), ia_respostas: 0 }).eq('id', conv.id)
  return true
}

/** Cron (a cada minuto): conversas que pediram atendente pela IA há 10+ min, sem resposta da loja. */
export async function avisarAtendentesPendentes(admin: SupabaseClient, agora = new Date()): Promise<number> {
  const { data } = await admin.from('whatsapp_conversas')
    .select('id, restaurante_id, telefone, pediu_atendente_em')
    .not('pediu_atendente_motivo', 'is', null)
    .is('pediu_atendente_aviso_em', null)
    .eq('atendimento', 'aguardando')
    .lte('pediu_atendente_em', new Date(agora.getTime() - AVISO_ATENDENTE_MS).toISOString())
    .gte('pediu_atendente_em', new Date(agora.getTime() - JANELA_ATENDENTE_MS).toISOString())
    .limit(50)
  let avisados = 0
  for (const c of (data ?? []) as { id: string; restaurante_id: string; telefone: string; pediu_atendente_em: string }[]) {
    const { data: resp } = await admin.from('whatsapp_mensagens').select('id').eq('conversa_id', c.id).eq('direcao', 'loja')
      .in('origem', ['atendente', 'loja']).gt('criado_em', c.pediu_atendente_em).limit(1)
    const { data: marcada } = await admin.from('whatsapp_conversas').update({ pediu_atendente_aviso_em: agora.toISOString() })
      .eq('id', c.id).is('pediu_atendente_aviso_em', null).select('id').maybeSingle()
    if (!marcada || (resp ?? []).length) continue
    await enfileirar(admin, {
      restauranteId: c.restaurante_id, chave: `ia_atendente_aviso:${c.id}:${Date.parse(c.pediu_atendente_em)}`, tipo: 'ia',
      telefone: c.telefone, texto: TEXTO_LOJA_AVISADA, conversaId: c.id,
    })
    avisados++
  }
  return avisados
}
