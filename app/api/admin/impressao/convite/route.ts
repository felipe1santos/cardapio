import { NextResponse } from 'next/server'
import { contextoImpressao, semCache } from '@/lib/impressao/contexto'
import { gerarConvite } from '@/lib/impressao/servico'

/**
 * Pareamento sem código (noite 5): convite de 24 h e uso único para o link
 * menuzia://parear?c=… — o painel abre o link no computador da impressora e o Assistente
 * (0.2.0-beta.10+) se conecta sozinho. O convite aparece só nesta resposta.
 */
export async function POST() {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const r = await gerarConvite(ctx.admin, ctx.op, 'link')
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status, headers: semCache })
  return NextResponse.json({ ...r.valor, link: `menuzia://parear?c=${r.valor.convite}` }, { status: 201, headers: semCache })
}
