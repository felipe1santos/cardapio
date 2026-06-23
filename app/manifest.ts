import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Menuzia — Painel',
    short_name: 'Menuzia',
    description: 'Cardápio digital e gestão de delivery',
    start_url: '/admin/pedidos',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#EDEEF1',
    theme_color: '#0688D4',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
