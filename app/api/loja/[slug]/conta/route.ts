import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { atualizarPerfilCliente, buscarClientePorToken, buscarRestauranteIdPorSlug, type AtualizarPerfilInput } from '@/lib/queries/clientes'

/** Restaura a sessão do cliente (telefone + token salvos no navegador). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const { searchParams } = new URL(request.url)
    const telefone = searchParams.get('telefone')
    const token = searchParams.get('token')
    if (!telefone || !token) return NextResponse.json({ error: 'Sessão inválida' }, { status: 400 })

    const admin = getAdminSupabase()
    const restauranteId = await buscarRestauranteIdPorSlug(admin, slug)
    if (!restauranteId) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

    const cliente = await buscarClientePorToken(admin, restauranteId, telefone, token)
    if (!cliente) return NextResponse.json({ error: 'Sessão inválida' }, { status: 401 })
    return NextResponse.json(cliente)
  } catch (err) {
    console.error('[conta] GET erro inesperado:', err)
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 })
  }
}

/** Atualiza nome/endereço salvos do cliente. */
export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params

    let body: { telefone?: string; token?: string } & Partial<AtualizarPerfilInput>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
    }
    if (!body.telefone || !body.token) return NextResponse.json({ error: 'Sessão inválida' }, { status: 400 })

    const admin = getAdminSupabase()
    const restauranteId = await buscarRestauranteIdPorSlug(admin, slug)
    if (!restauranteId) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

    const cliente = await atualizarPerfilCliente(admin, restauranteId, body.telefone, body.token, {
      nome: body.nome ?? '',
      endereco: body.endereco ?? { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
    })
    if (!cliente) return NextResponse.json({ error: 'Sessão inválida' }, { status: 401 })
    return NextResponse.json(cliente)
  } catch (err) {
    console.error('[conta] PATCH erro inesperado:', err)
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 })
  }
}
