import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarClientePorToken, buscarRestauranteIdPorSlug } from '@/lib/queries/clientes'
import { buscarCuponsPublicos, buscarFidelidadeCliente } from '@/lib/queries/fidelidade'
import { saldoCashbackCliente } from '@/lib/queries/cashback'

/**
 * Progresso de fidelidade do cliente na vitrine (aba Cupons): campanhas com progresso,
 * recompensas disponíveis e cupons públicos.
 *
 * Sessão inválida/ausente NÃO retorna 401 — a vitrine é usada por clientes anônimos também, e
 * eles ainda devem ver os cupons públicos da loja. Só que, sem confirmar telefone+token, nunca
 * consultamos progresso/recompensas (evita vazar dados de outro cliente por telefone adivinhado).
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const { searchParams } = new URL(request.url)
    const telefone = searchParams.get('telefone')
    const token = searchParams.get('token')

    const admin = getAdminSupabase()
    const restauranteId = await buscarRestauranteIdPorSlug(admin, slug)
    if (!restauranteId) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

    if (telefone && token) {
      const cliente = await buscarClientePorToken(admin, restauranteId, telefone, token)
      if (cliente) {
        // Cashback (Etapa 7, 0211): saldo do cliente; falha aqui não derruba a aba Cupons.
        const [fidelidade, cashback] = await Promise.all([buscarFidelidadeCliente(admin, restauranteId, telefone), saldoCashbackCliente(admin, restauranteId, telefone).catch(() => null)])
        return NextResponse.json({ ...fidelidade, cashback })
      }
    }

    const cuponsPublicos = await buscarCuponsPublicos(admin, restauranteId)
    return NextResponse.json({ campanhas: [], recompensas: [], cuponsPublicos })
  } catch (err) {
    console.error('[fidelidade] GET erro inesperado:', err)
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 })
  }
}
