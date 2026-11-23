/**
 * Lembrete da véspera das encomendas (0250), pelo WhatsApp conectado da loja. Roda dentro do cron do WhatsApp
 * (app/api/cron/whatsapp), no máximo a cada 10 min (portão em memória), com 1 consulta indexada
 * (pedidos_encomenda_lembrete_idx) e no máximo 20 pedidos por rodada.
 *
 * Sem loop e sem repetição: cada pedido é RESERVADO (encomenda_lembrete_em = agora, só se ainda nulo) antes do envio.
 * Duas rodadas juntas → só uma reserva vale. Envio que falha não é tentado de novo (é lembrete, não aviso crítico —
 * a fila do WhatsApp já trata as próprias tentativas). Pedido feito em cima da hora é reservado sem envio, para não
 * voltar na consulta.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { LEMBRETE_JANELA_H, LEMBRETE_MINIMO_H, lembreteDevido } from './encomenda'

export const LEMBRETE_LIMITE_RODADA = 20

export async function enviarLembretesEncomenda(
  admin: SupabaseClient,
  opcoes: { agora?: Date; enviar: (pedidoId: string) => Promise<boolean> },
): Promise<{ enviados: number; pulados: number }> {
  const agora = opcoes.agora ?? new Date()
  const { data, error } = await admin
    .from('pedidos')
    .select('id, agendado_para, criado_em')
    .eq('encomenda', true)
    .is('encomenda_lembrete_em', null)
    .in('status', ['recebido', 'preparando'])
    .gt('agendado_para', new Date(agora.getTime() + LEMBRETE_MINIMO_H * 3600_000).toISOString())
    .lte('agendado_para', new Date(agora.getTime() + LEMBRETE_JANELA_H * 3600_000).toISOString())
    .order('agendado_para', { ascending: true })
    .limit(LEMBRETE_LIMITE_RODADA)
  if (error) throw error

  let enviados = 0
  let pulados = 0
  for (const p of (data ?? []) as { id: string; agendado_para: string; criado_em: string }[]) {
    const { data: reserva } = await admin
      .from('pedidos')
      .update({ encomenda_lembrete_em: agora.toISOString() })
      .eq('id', p.id)
      .is('encomenda_lembrete_em', null)
      .select('id')
    if (!reserva?.length) { pulados++; continue }
    if (!lembreteDevido(p.agendado_para, p.criado_em, agora)) { pulados++; continue }
    try {
      if (await opcoes.enviar(p.id)) enviados++
    } catch (e) {
      console.error('[encomenda] lembrete', p.id, (e as Error).message?.slice(0, 160))
    }
  }
  return { enviados, pulados }
}
