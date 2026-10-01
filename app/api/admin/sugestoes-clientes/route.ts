import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { sugestoesDeClientes, type LinhaPedidoCliente } from '@/lib/sugestoes-clientes'

export const dynamic = 'force-dynamic'

const PAPEIS = new Set(['dono', 'gerente', 'garcom', 'atendente', 'logistica'])

/**
 * Sugestões de cliente ao digitar o nome (mesa, comanda, balcão, PDV) — 2026-10-01.
 * Busca por nome ou telefone a partir de 2 caracteres, só na loja da SESSÃO (nunca do
 * corpo), na base de pedidos (nome, telefone e última compra). Caminho fora das áreas do
 * menu: quem atende mesa ou balcão usa, mesmo sem acesso à tela Clientes.
 */
export async function GET(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!PAPEIS.has(sessao.papel)) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 60)
  if (q.length < 2) return NextResponse.json({ sugestoes: [] })
  const digitos = q.replace(/\D/g, '')
  const termo = q.replace(/[%_,()]/g, ' ').trim()
  const filtros = [`cliente_nome.ilike.%${termo}%`]
  if (digitos.length >= 2) filtros.push(`cliente_telefone.like.%${digitos}%`)
  const admin = getAdminSupabase()
  const { data, error } = await admin
    .from('pedidos')
    .select('cliente_nome, cliente_telefone, criado_em')
    .eq('restaurante_id', sessao.restauranteId)
    .neq('status', 'cancelado')
    .or(filtros.join(','))
    .order('criado_em', { ascending: false })
    .limit(300)
  if (error) return NextResponse.json({ error: 'Não foi possível buscar clientes.' }, { status: 500 })
  return NextResponse.json(
    { sugestoes: sugestoesDeClientes((data ?? []) as LinhaPedidoCliente[], q) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
