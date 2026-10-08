import { NextResponse } from 'next/server'
import { BASE_PUBLICA } from '@/lib/mensageria/robo'
import { pedidoDoCodigo } from '@/lib/motoboy/qr-rota'

/**
 * QR da rota impresso na comanda de entrega: /r/<código>.
 *
 * Item 61 (2026-10-08): leva SEMPRE para o app do motoboy (/motoboy?qr=<código>). Antes (item 59)
 * só ia para o app quando o navegador já tinha a sessão do motoboy; a câmera do celular abre o
 * navegador padrão, sem essa sessão, e o link caía na vitrine da loja. Agora o app pede o login
 * (nome + senha) quando precisa e depois mostra o pedido. Quem não é motoboy da loja só vê a tela
 * de login: o link não carrega e não mostra endereço nem dado do cliente.
 * Código adulterado ou de outro lugar → "Link inválido" (404).
 */
export const dynamic = 'force-dynamic'

const CABECALHOS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' }

export async function GET(_request: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params
  if (!pedidoDoCodigo(codigo)) {
    return new NextResponse('<!doctype html><meta charset="utf-8"><title>Link inválido</title><p style="font-family:system-ui;padding:24px">Link inválido.</p>', { status: 404, headers: { ...CABECALHOS, 'Content-Type': 'text/html; charset=utf-8' } })
  }
  return NextResponse.redirect(`${BASE_PUBLICA()}/motoboy?qr=${encodeURIComponent(codigo)}`, { status: 302, headers: CABECALHOS })
}
