import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Vídeo da vitrine (21/10/2026): o binário do ffmpeg-static é achado pelo caminho do pacote — empacotado pelo
  // webpack o caminho quebra, então ele fica fora do bundle do servidor.
  serverExternalPackages: ['ffmpeg-static'],
  // Imagem enxuta (29/10/2026): o Dockerfile roda só o .next/standalone (sem o node_modules inteiro). O binário do
  // ffmpeg não é import — o rastreio não o acha sozinho, então entra à força.
  output: 'standalone',
  outputFileTracingIncludes: { '/**': ['./node_modules/ffmpeg-static/**'] },
  // Chave do Maps do navegador (docs/REGRAS-DE-CUSTO.md): GOOGLE_MAPS_BROWSER_KEY no Coolify, com Build time — só
  // Maps JavaScript, restrita a app.menuzia.com.br. A chave do servidor (GOOGLE_MAPS_SERVER_KEY) NUNCA entra aqui.
  env: {
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',  },
  // Fontes do projeto (public/fontes): o nome do arquivo tem hash, então podem ficar em cache
  // para sempre, como os de /_next/static.
  async headers() {
    return [{ source: '/fontes/:arquivo*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }]
  },
}

export default nextConfig
