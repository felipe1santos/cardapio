import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { codigoValido, conviteValido } from '@/lib/impressao/credenciais'
import { parear } from '@/lib/impressao/servico'

/**
 * Pareamento do Assistente 0.1.26+: troca o código de uso único (gerado pelo dono ou
 * gerente, 10 minutos) pela credencial deste computador. A credencial volta UMA vez,
 * nesta resposta, e o banco guarda só o hash. Código errado, usado ou vencido: 401.
 * 0.2.0-beta.10+: também { convite } — o de 24 h que chega pelo link menuzia:// ou no nome
 * do instalador (pareamento sem código). Mesma troca, mesma tabela.
 */
export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const segredo = conviteValido(corpo?.convite) ? (corpo!.convite as string) : codigoValido(corpo?.codigo) ? (corpo!.codigo as string) : null
  if (!segredo) return NextResponse.json({ error: 'Código de pareamento inválido.' }, { status: 400 })
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.slice(0, 60) : ''
  const versao = typeof corpo?.versao === 'string' ? corpo.versao.slice(0, 20) : null
  const r = await parear(getAdminSupabase(), { codigo: segredo, nome, versao })
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true, ...r.valor }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}
