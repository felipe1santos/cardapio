import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import type { AcaoFin } from '@/lib/financeiro/permissoes'
import { ANEXO_MAX_BYTES, anexarConta, baixarConta, cancelarConta, editarConta, estornarBaixa, lerEntradaConta, linkDoAnexo } from '@/lib/financeiro/contas'
import type { CarteiraConta, FormaConta } from '@/lib/financeiro/contas-regras'

/**
 * Uma conta (Fase 5b).
 *   GET  → link curto (60 s) do anexo (contas_pagar)
 *   POST → envia anexo: corpo = o arquivo; cabeçalhos Content-Type e x-nome (contas_lancar)
 *   PATCH {acao}: editar | cancelar (contas_lancar) · baixar | estornar (contas_marcar_pago)
 * Não existe DELETE: conta não se apaga.
 */
type Ctx = { params: Promise<{ id: string }> }

export async function GET(_r: Request, { params }: Ctx) {
  const c = await contextoFinanceiro('contas_pagar')
  if ('erro' in c) return c.erro
  const link = await linkDoAnexo(c.admin, c.sessao.restauranteId, (await params).id)
  if (!link) return NextResponse.json({ error: 'Sem anexo.' }, { status: 404 })
  return NextResponse.json({ url: link }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request, { params }: Ctx) {
  const c = await contextoFinanceiro('contas_lancar')
  if ('erro' in c) return c.erro
  const tam = Number(request.headers.get('content-length') ?? 0)
  if (tam > ANEXO_MAX_BYTES) return NextResponse.json({ error: 'Arquivo maior que 5 MB.' }, { status: 413 })
  const bytes = new Uint8Array(await request.arrayBuffer())
  const r = await anexarConta(c, (await params).id, bytes, (request.headers.get('content-type') ?? '').split(';')[0].trim(), decodeURIComponent(request.headers.get('x-nome') ?? 'anexo'))
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

const PERMISSAO: Record<string, AcaoFin> = { editar: 'contas_lancar', cancelar: 'contas_lancar', baixar: 'contas_marcar_pago', estornar: 'contas_marcar_pago' }

export async function PATCH(request: Request, { params }: Ctx) {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const acao = String(b?.acao ?? '')
  if (!PERMISSAO[acao]) return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  const c = await contextoFinanceiro(PERMISSAO[acao])
  if ('erro' in c) return c.erro
  const id = (await params).id
  const ap = b?.aprovacao as { aprovadorId?: unknown; pin?: unknown; remotaId?: unknown } | undefined
  const aprovacao = ap ? { aprovadorId: String(ap.aprovadorId ?? ''), pin: String(ap.pin ?? ''), remotaId: typeof ap.remotaId === 'string' ? ap.remotaId : null } : null
  const r = acao === 'editar' ? await editarConta(c, id, lerEntradaConta(b))
    : acao === 'cancelar' ? await cancelarConta(c, id, String(b?.motivo ?? ''), b?.serie === true)
    : acao === 'baixar' ? await baixarConta(c, id, { carteira: String(b?.carteira ?? '') as CarteiraConta, forma: String(b?.forma ?? '') as FormaConta, aprovacao })
    : await estornarBaixa(c, id, { motivo: String(b?.motivo ?? ''), aprovacao })
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo, ...r.dados }, { status: r.status })
  return NextResponse.json({ ok: true, ...(r.valor ?? {}) })
}
