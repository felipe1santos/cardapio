import { NextResponse } from 'next/server'
import { contextoImpressao } from '@/lib/impressao/contexto'
import { definirModo } from '@/lib/impressao/servico'

/**
 * O que o Assistente Beta imprime (PUT { modo: "teste" | "caixa" | "cozinha_caixa" }).
 * Troca atômica e auditada no banco (0100). Voltar para "teste" devolve a cozinha ao
 * Assistente antigo na hora — é o botão de emergência do piloto.
 */
export async function PUT(request: Request) {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const corpo = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  // Modo misto ("Somente Caixa": pré-conta no Beta, comanda no antigo) não se escolhe mais
  // (noite 5): o Assistente novo é comanda E pré-conta. Loja que já está nele continua igual
  // (repetir o modo atual é idempotente); o recuo automático de garantirModoValido não passa aqui.
  if (corpo.modo === 'caixa') {
    const { data: l } = await ctx.admin.from('restaurantes').select('impressao_beta_modo').eq('id', ctx.op.restauranteId).maybeSingle()
    if (l?.impressao_beta_modo !== 'caixa') {
      return NextResponse.json({ error: 'O modo misto não existe mais: escolha o Assistente novo (comanda e pré-conta) ou o antigo.', codigo: 'modo_misto_descontinuado' }, { status: 400 })
    }
  }
  const r = await definirModo(ctx.admin, ctx.op, corpo.modo)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true, ...r.valor })
}
