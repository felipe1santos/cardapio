import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { verificarEmailAutorizado } from '@/lib/queries/lojistas'

/**
 * Checagem ao vivo do campo de e-mail em /cadastro: informa se o e-mail digitado
 * foi pré-autorizado pelo /superadmin e ainda não concluiu o primeiro acesso.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const email = (searchParams.get('email') ?? '').trim().toLowerCase()

  if (!email || !email.includes('@') || email.length > 254) {
    return NextResponse.json({ status: 'nao_encontrado' })
  }

  try {
    const status = await verificarEmailAutorizado(getAdminSupabase(), email)
    return NextResponse.json({ status })
  } catch {
    return NextResponse.json({ status: 'nao_encontrado' })
  }
}
