import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Versão do build no ar (pública, sem dado nenhum): o painel compara com a sua e avisa quando há versão nova. */
export function GET() {
  return NextResponse.json({ versao: process.env.NEXT_PUBLIC_VERSAO_APP ?? '' }, { headers: { 'Cache-Control': 'no-store' } })
}
