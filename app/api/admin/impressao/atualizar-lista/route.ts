import { NextResponse } from 'next/server'
import { contextoImpressao, semCache } from '@/lib/impressao/contexto'
import { esquecerDescoberta } from '@/lib/impressao/descoberta-memo'

/**
 * Botão "Atualizar lista de impressoras": faz o servidor esquecer o que já gravou dos computadores
 * DESTA loja; a próxima lista que o Assistente mandar (até ~1 min) é gravada na hora.
 * A loja vem da sessão; só os agentes dela (não revogados) são esquecidos.
 */
export async function POST() {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const { data } = await ctx.admin.from('impressao_agentes').select('id').eq('restaurante_id', ctx.op.restauranteId).is('revogado_em', null)
  for (const a of (data ?? []) as { id: string }[]) esquecerDescoberta(a.id)
  return NextResponse.json({ ok: true }, { headers: semCache })
}
