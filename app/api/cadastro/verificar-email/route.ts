import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigPlataforma, verificarEmailAutorizado } from '@/lib/queries/lojistas'

/**
 * Checagem ao vivo do campo de e-mail em /cadastro: informa se o e-mail digitado
 * pode seguir com o cadastro — pré-autorizado pelo /superadmin ou, com o cadastro
 * automático ligado, qualquer e-mail ainda não usado.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const email = (searchParams.get('email') ?? '').trim().toLowerCase()

  if (!email || !email.includes('@') || email.length > 254) {
    return NextResponse.json({ status: 'nao_encontrado' })
  }

  try {
    const admin = getAdminSupabase()
    let status = await verificarEmailAutorizado(admin, email)
    if (status === 'nao_encontrado') {
      const config = await buscarConfigPlataforma(admin)
      if (config.cadastroAutomatico) status = 'autorizado'
    }
    return NextResponse.json({ status })
  } catch {
    return NextResponse.json({ status: 'nao_encontrado' })
  }
}
