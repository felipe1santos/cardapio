import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { aplicarPreco, type AlvoTipo } from '@/lib/financeiro/cmv'

/**
 * "Aplicar novo preço" (CMV). Permissão própria: precos_aplicar (padrão dono e gerente). Nunca automático:
 * a tela mostra antigo × novo e pede confirmação; o servidor confere que o "antigo" é o do banco agora
 * (corpo manipulado ou tela velha → 409) e audita. Reflete na vitrine, PDV e mesas como uma edição do cardápio.
 *   POST { alvo: { tipo, id, tamanhoId? }, precoAtualCentavos, novoCentavos }
 */
const UUID = /^[0-9a-f-]{36}$/i

export async function POST(request: Request) {
  const c = await contextoFinanceiro('precos_aplicar')
  if ('erro' in c) return c.erro
  const corpo = await request.json().catch(() => null)
  const a = corpo?.alvo
  if (!a || !['item', 'tamanho', 'sabor'].includes(a.tipo) || typeof a.id !== 'string' || !UUID.test(a.id)) {
    return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 })
  }
  const r = await aplicarPreco(c, { tipo: a.tipo as AlvoTipo, id: a.id, tamanhoId: typeof a.tamanhoId === 'string' && UUID.test(a.tamanhoId) ? a.tamanhoId : null },
    Number(corpo?.precoAtualCentavos), Number(corpo?.novoCentavos))
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
  if (r.valor.slug) revalidatePath(`/loja/${r.valor.slug}`)
  return NextResponse.json({ ok: true, antigoCentavos: r.valor.antigo, novoCentavos: r.valor.novo })
}
