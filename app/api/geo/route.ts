import { NextResponse } from 'next/server'

/** Resolve a cidade aproximada do visitante a partir do IP (best-effort, sem chave). */
export async function GET(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim()

  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('192.168.')) {
    return NextResponse.json({})
  }

  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, { headers: { 'User-Agent': 'menuzia' } })
    if (!res.ok) return NextResponse.json({})
    const data = await res.json()
    if (data?.error) return NextResponse.json({})
    return NextResponse.json({ cidade: data.city ?? null, regiao: data.region ?? null })
  } catch {
    return NextResponse.json({})
  }
}
