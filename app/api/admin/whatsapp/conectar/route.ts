import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { evolutionConfigurado, nomeInstancia, obterQrCode } from '@/lib/evolution'
import { garantirWebhookDaLoja } from '@/lib/mensageria/webhook-loja'

/** Cria/conecta a instância WhatsApp do restaurante logado e retorna o QR code para escanear. */
export async function POST() {
  if (!evolutionConfigurado()) {
    return NextResponse.json({ error: 'Evolution API não configurada no servidor' }, { status: 400 })
  }

  const supabase = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
  if (!restauranteId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const admin = getAdminSupabase()
  const { data: loja, error: lojaError } = await admin
    .from('restaurantes')
    .select('evolution_instance')
    .eq('id', restauranteId)
    .single()
  if (lojaError) return NextResponse.json({ error: 'Erro ao buscar loja' }, { status: 500 })

  // A instância vem do banco (loja da sessão); só na primeira conexão o servidor cria uma,
  // com nome aleatório. O navegador nunca escolhe (0111).
  let instance: string = loja.evolution_instance ?? ''
  if (!instance) {
    const { error: updateError } = await admin.from('restaurantes').update({ evolution_instance: nomeInstancia() }).eq('id', restauranteId).is('evolution_instance', null)
    if (updateError) return NextResponse.json({ error: 'Erro ao salvar instância' }, { status: 500 })
    // Dois cliques ao mesmo tempo: vale o nome que ficou gravado.
    const { data: gravada } = await admin.from('restaurantes').select('evolution_instance').eq('id', restauranteId).single()
    instance = (gravada?.evolution_instance as string | null) ?? ''
    if (!instance) return NextResponse.json({ error: 'Erro ao salvar instância' }, { status: 500 })
  }

  try {
    const qr = await obterQrCode(instance)
    // Webhook da loja (SAIR, central de atendimento, métricas) já na conexão/reconexão.
    await garantirWebhookDaLoja(admin, restauranteId).catch(() => null)
    return NextResponse.json(qr)
  } catch (err) {
    console.error('[whatsapp] erro ao obter QR code', err)
    return NextResponse.json({ error: 'Erro ao conectar com a Evolution API' }, { status: 500 })
  }
}
