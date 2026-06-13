import { NextResponse } from 'next/server'

/** Manifest do PWA do portal do motoboy — por token, abre direto na rota dele. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  return NextResponse.json(
    {
      name: 'Portal do Motoboy — Menuzia',
      short_name: 'Motoboy',
      description: 'Acompanhe sua rota de entregas em tempo real.',
      start_url: `/entregador/${token}`,
      scope: `/entregador/${token}`,
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#111827',
      theme_color: '#06B6D4',
      icons: [
        { src: '/icons/motoboy-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/motoboy-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/motoboy-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/icons/motoboy-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json' } }
  )
}
