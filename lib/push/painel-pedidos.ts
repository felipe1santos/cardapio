import type { SupabaseClient } from '@supabase/supabase-js'
import { assinaturaExpirada, FALHAS_PARA_INVALIDAR, pushConfigurado, remetenteAtual, type Remetente } from './envio'

/**
 * Push do PAINEL para pedido novo (2026-10-04): chega ao celular/tablet da equipe mesmo com a tela
 * apagada ou o Chrome em segundo plano — onde o Android congela a página e nenhum som de página toca.
 * O som é o da notificação do aparelho (não o mp3 do painel). Assinaturas em
 * `push_painel_assinaturas` (0146), uma por aparelho de cada usuário.
 *
 * Mesma `tag` da notificação do navegador (components/admin/notificacoes-pedidos.tsx): com o
 * painel aberto e o push chegando juntos, o aparelho mostra uma só.
 */
export function textoPushPainel(p: { numero: number | null; canal?: string | null }): { title: string; body: string } {
  const canal = p.canal === 'retirada' ? 'retirada' : p.canal === 'entrega' ? 'entrega' : null
  return {
    title: `🔔 Pedido novo${p.numero ? ` #${p.numero}` : ''}`,
    body: canal ? `Pedido para ${canal} esperando aceite no painel.` : 'Pedido esperando aceite no painel.',
  }
}

export async function avisarPainelPedidoNovo(
  admin: SupabaseClient,
  restauranteId: string,
  pedido: { id: string; numero: number | null; canal?: string | null },
  remetente: Remetente = remetenteAtual(),
): Promise<{ enviados: number; removidas: number }> {
  const res = { enviados: 0, removidas: 0 }
  if (!pushConfigurado() && process.env.PUSH_PROVEDOR !== 'simulado') return res
  const { data: assinaturas } = await admin
    .from('push_painel_assinaturas')
    .select('id, endpoint, p256dh, auth, falhas')
    .eq('restaurante_id', restauranteId)
  if (!assinaturas?.length) return res
  const { title, body } = textoPushPainel(pedido)
  const payload = JSON.stringify({
    title, body, tag: 'menuzia-pedido', painel: true,
    data: { url: '/admin/pedidos', pedido: pedido.id },
  })
  await Promise.all(assinaturas.map(async (a) => {
    const r = await remetente({ endpoint: a.endpoint, p256dh: a.p256dh, auth: a.auth }, payload, { ttl: 600, urgente: true })
    if (r.ok) {
      res.enviados++
      await admin.from('push_painel_assinaturas').update({ falhas: 0, ultimo_envio_em: new Date().toISOString() }).eq('id', a.id)
      return
    }
    const falhas = (a.falhas ?? 0) + 1
    if (assinaturaExpirada(r.status) || falhas >= FALHAS_PARA_INVALIDAR) {
      res.removidas++
      await admin.from('push_painel_assinaturas').delete().eq('id', a.id)
    } else {
      await admin.from('push_painel_assinaturas').update({ falhas }).eq('id', a.id)
    }
  }))
  return res
}
