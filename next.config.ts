import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Fontes do projeto (public/fontes): o nome do arquivo tem hash, então podem ficar em cache
  // para sempre, como os de /_next/static.
  async headers() {
    return [{ source: '/fontes/:arquivo*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }]
  },
}

export default nextConfig
