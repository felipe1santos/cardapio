import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { dadosDoPreCadastro, verificarEmailAutorizado } from '@/lib/queries/lojistas'
import { criarLimitador, ipDaRequisicao } from '@/lib/limite-taxa'

// A resposta diz se o e-mail é de lojista pré-autorizado: sem freio, dava para varrer uma
// lista de e-mails (M25). Quem digita no formulário consulta poucas vezes por minuto.
const consultasPorIp = criarLimitador({ max: 20, janelaMs: 60_000 })

/**
 * Checagem ao vivo do campo de e-mail em /cadastro: informa se o e-mail digitado foi
 * pré-cadastrado pelo /superadmin. Desde 2026-10-04 só entra quem tem convite (o cadastro
 * automático saiu). Com convite pendente, devolve o que o superadmin já preencheu (nome da
 * loja, responsável e telefone) para adiantar o formulário.
 */
export async function GET(request: Request) {
  const ip = ipDaRequisicao(request.headers)
  if (consultasPorIp.excedeu(ip)) return NextResponse.json({ status: 'nao_encontrado' }, { status: 429 })
  consultasPorIp.registrar(ip)
  const { searchParams } = new URL(request.url)
  const email = (searchParams.get('email') ?? '').trim().toLowerCase()

  if (!email || !email.includes('@') || email.length > 254) {
    return NextResponse.json({ status: 'nao_encontrado' })
  }

  try {
    const admin = getAdminSupabase()
    const status = await verificarEmailAutorizado(admin, email)
    if (status !== 'autorizado') return NextResponse.json({ status })
    return NextResponse.json({ status, preenchido: await dadosDoPreCadastro(admin, email) })
  } catch {
    return NextResponse.json({ status: 'nao_encontrado' })
  }
}
