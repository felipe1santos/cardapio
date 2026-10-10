import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Chave do Maps do navegador (docs/REGRAS-DE-CUSTO.md): GOOGLE_MAPS_BROWSER_KEY no Coolify, com Build time — só
  // Maps JavaScript, restrita a app.menuzia.com.br. A chave do servidor (GOOGLE_MAPS_SERVER_KEY) NUNCA entra aqui.
  env: {
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  },
  // Fontes do projeto (public/fontes): o nome do arquivo tem hash, então podem ficar em cache
  // para sempre, como os de /_next/static.
  async headers() {
    return [{ source: '/fontes/:arquivo*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }]
  },
}

export default nextConfig
