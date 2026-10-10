import type { Metadata, Viewport } from 'next'

export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, viewportFit: 'cover', themeColor: '#0688D4' }

export const metadata: Metadata = {
  title: 'Menuzia Entregador',
  manifest: '/api/motoboy/manifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Entregador' },
  icons: { apple: '/icons/motoboy-apple-180.png' },
}

export default function MotoboyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
