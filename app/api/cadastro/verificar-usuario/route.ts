import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { normalizarUsuario, usuarioDisponivel } from '@/lib/queries/lojistas'

/** Checagem ao vivo do nome de usuário em /cadastro: formato válido + disponibilidade. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const usuario = normalizarUsuario(searchParams.get('usuario') ?? '')

  if (!usuario) {
    return NextResponse.json({ status: 'invalido' })
  }

  try {
    const livre = await usuarioDisponivel(getAdminSupabase(), usuario)
    return NextResponse.json({ status: livre ? 'disponivel' : 'em_uso' })
  } catch {
    return NextResponse.json({ status: 'invalido' })
  }
}
