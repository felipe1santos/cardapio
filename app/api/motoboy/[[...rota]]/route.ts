import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { buscarEntregadorPorUsuario } from '@/lib/queries/pedidos'
import { acaoNoPedido, dadosDoPortal, heartbeat, lerQrDaEntrega } from '@/lib/motoboy/servico'
import { ehMotoboy, garantirEntregador } from '@/lib/motoboy/cadastro'

/**
 * App do motoboy COM LOGIN (0136) — mesmas regras do link/QR (lib/motoboy/servico), mas quem é o
 * motoboy vem da SESSÃO: o usuário logado tem que estar ligado a um entregador ativo da loja dele.
 *   GET  /api/motoboy                         → rota, "dinheiro comigo", histórico de hoje
 *   GET  /api/motoboy/manifest                → PWA (nome da loja)
 *   POST /api/motoboy/heartbeat
 *   POST /api/motoboy/qr                      → item 59: leu o QR da comanda (ou digitou o número)
 *   POST /api/motoboy/pedidos/<id>/<saiu|entregar|problema|pegar>
 */
async function quem() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Entre com o seu login.' }, { status: 401 }) } as const
  const admin = getAdminSupabase()
  // O token da sessão pode durar até expirar: o que manda é o cadastro AGORA (Equipe ativa).
  const { data: usu, error: erroUsu } = await admin.from('usuarios').select('desativado_em, cargo').eq('id', sessao.userId).maybeSingle()
  if (erroUsu) return { erro: NextResponse.json({ error: 'Não foi possível conferir o seu acesso.' }, { status: 503 }) } as const
  if (!usu || usu.desativado_em) return { erro: NextResponse.json({ error: 'Seu acesso foi desativado. Fale com a loja.', codigo: 'login_desativado' }, { status: 403 }) } as const
  let entregador = await buscarEntregadorPorUsuario(admin, sessao.userId, sessao.restauranteId).catch(() => null)
  // Motoboy da Equipe sem o registro de entregador (10/10): cria e segue.
  if (!entregador && ehMotoboy({ papel: sessao.papel, cargo: (usu as { cargo?: string | null }).cargo })) {
    if (await garantirEntregador(admin, sessao.restauranteId, sessao.userId)) entregador = await buscarEntregadorPorUsuario(admin, sessao.userId, sessao.restauranteId).catch(() => null)
  }
  if (!entregador) return { erro: NextResponse.json({ error: 'Seu login não está ligado a um entregador ativo desta loja.', codigo: 'sem_entregador' }, { status: 403 }) } as const
  return { admin, entregador } as const
}

export async function GET(_r: Request, { params }: { params: Promise<{ rota?: string[] }> }) {
  const rota = (await params).rota ?? []
  if (rota[0] === 'manifest') {
    const q = await quem()
    const loja = 'erro' in q ? 'Menuzia' : q.entregador.restauranteNome
    return NextResponse.json({
      // 10/10: "Menuzia Entregador", abre direto no app do motoboy (tela cheia), com a sessão do celular.
      name: 'Menuzia Entregador', short_name: 'Entregador', description: `Suas entregas, rota e acerto — ${loja}.`, id: '/motoboy',
      start_url: '/motoboy', scope: '/motoboy', display: 'standalone', orientation: 'portrait',
      background_color: '#111827', theme_color: '#0688D4',
      icons: [
        { src: '/icons/motoboy-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/motoboy-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/motoboy-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/icons/motoboy-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }, { headers: { 'Content-Type': 'application/manifest+json' } })
  }
  if (rota.length) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  const q = await quem()
  if ('erro' in q) return q.erro
  try {
    return NextResponse.json(await dadosDoPortal(q.admin, q.entregador), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Erro ao carregar a rota' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ rota?: string[] }> }) {
  const rota = (await params).rota ?? []
  const q = await quem()
  if ('erro' in q) return q.erro
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (rota.length === 1 && rota[0] === 'heartbeat') {
    await heartbeat(q.admin, q.entregador, corpo).catch(() => {})
    return NextResponse.json({ ok: true })
  }
  if (rota.length === 1 && rota[0] === 'qr') {
    const r = await lerQrDaEntrega(q.admin, q.entregador, corpo?.texto)
    if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
    return NextResponse.json({ ok: true, ...(r.dados ?? {}) })
  }
  if (rota.length === 3 && rota[0] === 'pedidos') {
    const r = await acaoNoPedido(q.admin, q.entregador, rota[1], rota[2], corpo)
    if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
    return NextResponse.json({ ok: true, ...(r.dados ?? {}) })
  }
  return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
}
