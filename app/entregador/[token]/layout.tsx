import type { Metadata, Viewport } from 'next'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0688D4',
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  return {
    title: 'Portal do Motoboy — Menuzia',
    manifest: `/api/entregador/${token}/manifest`,
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: 'Motoboy',
    },
    icons: {
      apple: '/icons/motoboy-apple-180.png',
    },
  }
}

export default function EntregadorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
