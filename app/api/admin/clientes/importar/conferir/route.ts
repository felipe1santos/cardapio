import { NextResponse } from 'next/server'
import { autorizarClientesCsv, telefonesConhecidos } from '@/lib/queries/clientes-importacao'
import { telefoneWhatsapp } from '@/lib/telefone-br'
import { LIMITE_LINHAS } from '@/lib/clientes-csv'

/** Conferência (nada é gravado): quais telefones do arquivo já existem na loja e quem pediu para sair. */
export async function POST(request: Request) {
  const a = await autorizarClientesCsv()
  if ('erro' in a) return a.erro
  const corpo = await request.json().catch(() => null)
  if (!Array.isArray(corpo?.telefones) || corpo.telefones.length > LIMITE_LINHAS) return NextResponse.json({ error: 'Lista de telefones inválida.' }, { status: 400 })
  const tels = [...new Set((corpo.telefones as unknown[]).map((t) => telefoneWhatsapp(String(t ?? ''))).filter((t): t is string => !!t))]
  const r = await telefonesConhecidos(a.admin, a.sessao.restauranteId, tels)
  return NextResponse.json({
    existentes: r.filter((x) => x.no_cadastro || x.com_pedido).map((x) => x.telefone),
    descadastrados: r.filter((x) => x.descadastrado).map((x) => x.telefone),
  })
}
