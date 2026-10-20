import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Versão do build no ar (pública, sem dado nenhum): o id que o próprio Next grava em .next/BUILD_ID, único por build.
 * O painel guarda a versão que viu ao abrir e avisa quando ela muda (components/admin/nova-versao). 20/10: antes era um
 * carimbo do next.config, mas o navegador e o servidor recebiam valores diferentes e a faixa aparecia sempre.
 */
let versao: string | null = null
function lerVersao(): string {
  if (versao !== null) return versao
  try { versao = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() } catch { versao = '' }
  return versao
}

export function GET() {
  return NextResponse.json({ versao: lerVersao() }, { headers: { 'Cache-Control': 'no-store' } })
}
