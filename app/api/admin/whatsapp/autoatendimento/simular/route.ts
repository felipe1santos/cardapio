import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { COLUNAS_CONFIG_AUTO, carregarLojaAuto, palavrasExtras, type ConfigAuto } from '@/lib/robo-auto/motor'
import { novaConversa, passo } from '@/lib/robo-auto/simulador'
import type { PedidoAuto } from '@/lib/robo-auto/respostas'

/**
 * Simulador do robô de autoatendimento: NÃO envia nem grava nada. Recebe a conversa inteira (textos do
 * "cliente", na ordem) e devolve as respostas, com os dados reais da loja e a configuração atual — ou a do
 * rascunho da tela (`rascunho`), para testar antes de salvar. Pedidos: um pedido de exemplo (não usa cliente real).
 */
export async function POST(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!pode(sessao.papel, 'integracoes.gerenciar')) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  const corpo = (await request.json().catch(() => null)) as { mensagens?: unknown; rascunho?: Partial<ConfigAuto>; nomeCliente?: unknown; comPedido?: unknown } | null
  const mensagens = Array.isArray(corpo?.mensagens) ? (corpo!.mensagens as unknown[]).filter((m): m is string => typeof m === 'string').map((m) => m.slice(0, 500)) : []
  if (!mensagens.length || mensagens.length > 30) return NextResponse.json({ error: 'Mande de 1 a 30 mensagens.' }, { status: 400 })

  const admin = getAdminSupabase()
  const { data: cfg } = await admin.from('whatsapp_robo_config').select(COLUNAS_CONFIG_AUTO).eq('restaurante_id', sessao.restauranteId).maybeSingle()
  const r = corpo?.rascunho ?? {}
  const efetiva: ConfigAuto = {
    ...((cfg ?? {}) as ConfigAuto),
    ...(Array.isArray(r.auto_assuntos_desligados) ? { auto_assuntos_desligados: r.auto_assuntos_desligados } : {}),
    ...(r.auto_textos && typeof r.auto_textos === 'object' ? { auto_textos: r.auto_textos } : {}),
    ...(r.auto_palavras && typeof r.auto_palavras === 'object' ? { auto_palavras: r.auto_palavras } : {}),
    ...(typeof r.auto_tempo_entrega === 'string' ? { auto_tempo_entrega: r.auto_tempo_entrega } : {}),
    ...(typeof r.pix_chave === 'string' ? { pix_chave: r.pix_chave, pix_chave_tipo: r.pix_chave_tipo ?? null } : {}),
  }
  const loja = await carregarLojaAuto(admin, sessao.restauranteId, efetiva)
  const exemplo: PedidoAuto = { numero: 1234, status: 'preparando', rotuloStatus: 'Em preparo', total: 52.9, itens: [{ quantidade: 1, nome: 'Hambúrguer artesanal' }, { quantidade: 1, nome: 'Batata frita' }] }
  const comPedido = corpo?.comPedido === true
  const fontes = {
    loja,
    extras: palavrasExtras(efetiva),
    nomeCliente: typeof corpo?.nomeCliente === 'string' ? corpo.nomeCliente.slice(0, 60) : 'Cliente',
    pedidosAbertos: comPedido ? [exemplo] : [],
    pedidoPorNumero: (n: number) => (n === 1234 ? exemplo : null),
  }
  const conv = novaConversa()
  const inicio = Date.now()
  const passos = mensagens.map((m, i) => passo(conv, m, fontes, new Date(inicio + i * 60_000)))
  return NextResponse.json({ passos }, { headers: { 'Cache-Control': 'no-store' } })
}
