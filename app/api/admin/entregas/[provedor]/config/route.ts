import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { registrarAuditoria } from '@/lib/auditoria'
import { buscarConfig, paraPublica, PROVEDOR_DISPONIVEL, salvarConfig } from '@/lib/entregas/queries'
import { buscarConfigCanal } from '@/lib/canais/config'
import { configProvedorPronta, ehProvedorNovo, NOME_PROVEDOR } from '@/lib/entregas/provedores'
import { criptografiaPronta } from '@/lib/pagamentos/cripto'
import { tokenUber } from '@/lib/custo/uber-direct'

export const dynamic = 'force-dynamic'
const URL_PUBLICA = () => (process.env.MENUZIA_URL_PUBLICA ?? process.env.APP_URL ?? 'https://app.menuzia.com.br').replace(/\/$/, '')

/**
 * Integrações › Entregador iFood / Foody (Etapa 3). Só dono e gerente; o middleware já exige o módulo liberado.
 *   GET  → config pública (+ webhook da Foody; + se o canal iFood está conectado)
 *   PUT  { ativo?, baseUrl?, clientId?, clientSecret?, limparCredenciais? } → salva (Foody); iFood só liga/desliga
 *        Uber Direct (21/10): + { customerId?, webhookSecret?, ambiente? } e sem URL base
 *   POST { acao: 'testar' } → confere credenciais/conexão sem criar corrida
 */
async function contexto(provedor: string) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!['dono', 'gerente'].includes(sessao.papel)) return { erro: NextResponse.json({ error: 'Só o dono ou o gerente mexem nas integrações.' }, { status: 403 }) }
  if (!ehProvedorNovo(provedor)) return { erro: NextResponse.json({ error: 'Provedor inválido.' }, { status: 404 }) }
  return { sessao, provedor, admin: getAdminSupabase() }
}

export async function GET(_: Request, { params }: { params: Promise<{ provedor: string }> }) {
  const ctx = await contexto((await params).provedor)
  if ('erro' in ctx) return ctx.erro
  const cfg = await buscarConfig(ctx.admin, ctx.sessao.restauranteId, ctx.provedor).catch(() => null)
  const canalIfood = ctx.provedor === 'ifood' ? await buscarConfigCanal(ctx.admin, ctx.sessao.restauranteId, 'ifood').catch(() => null) : null
  return NextResponse.json({
    provedor: ctx.provedor, nome: NOME_PROVEDOR[ctx.provedor], config: cfg ? paraPublica(cfg) : null, cofrePronto: criptografiaPronta(),
    webhookUrl: ctx.provedor !== 'ifood' && cfg ? `${URL_PUBLICA()}/api/entregas/${ctx.provedor}/webhook/${cfg.webhookToken}` : null,
    canalIfoodPronto: ctx.provedor === 'ifood' ? !!(canalIfood?.credenciais && canalIfood.merchantIdExterno) : null,
    disponivel: PROVEDOR_DISPONIVEL[ctx.provedor],
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request, { params }: { params: Promise<{ provedor: string }> }) {
  const ctx = await contexto((await params).provedor)
  if ('erro' in ctx) return ctx.erro
  const c = (await request.json().catch(() => null)) as { ativo?: unknown; baseUrl?: unknown; clientId?: unknown; clientSecret?: unknown; limparCredenciais?: unknown; customerId?: unknown; webhookSecret?: unknown; ambiente?: unknown } | null
  if (!c || typeof c !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })
  if (!PROVEDOR_DISPONIVEL[ctx.provedor]) return NextResponse.json({ error: `${NOME_PROVEDOR[ctx.provedor]}: em breve. A Menuzia ainda está homologando esta integração.`, codigo: 'em_breve' }, { status: 409 })
  const patch: Parameters<typeof salvarConfig>[2] = { porNome: ctx.sessao.nome }
  if (typeof c.ativo === 'boolean') patch.ativo = c.ativo
  if (ctx.provedor !== 'ifood') {
    if (typeof c.baseUrl === 'string') {
      const u = c.baseUrl.trim()
      if (u && !/^https:\/\/[a-z0-9.-]+(\/[^\s]*)?$/i.test(u)) return NextResponse.json({ error: 'URL base inválida (precisa começar com https://).' }, { status: 400 })
      patch.baseUrl = u
    }
    if (ctx.provedor === 'uber') {
      if (typeof c.customerId === 'string') {
        const id = c.customerId.trim()
        if (id && !/^[\w-]{8,80}$/.test(id)) return NextResponse.json({ error: 'Customer ID inválido (copie de direct.uber.com › Developer).' }, { status: 400 })
        patch.contaId = id
      }
      if (typeof c.webhookSecret === 'string' && c.webhookSecret.trim()) patch.webhookSegredo = c.webhookSecret.trim().slice(0, 300)
      if (c.ambiente === 'sandbox' || c.ambiente === 'producao') patch.ambiente = c.ambiente
      if (c.limparCredenciais === true) patch.webhookSegredo = null
    }
    if (c.limparCredenciais === true) patch.chaves = null
    else if (typeof c.clientId === 'string' && typeof c.clientSecret === 'string' && c.clientId.trim() && c.clientSecret.trim()) patch.chaves = { apiKey: c.clientId.trim().slice(0, 200), apiSecret: c.clientSecret.trim().slice(0, 500) }
  }
  if (patch.ativo === true) {
    if (ctx.provedor === 'ifood') {
      const canal = await buscarConfigCanal(ctx.admin, ctx.sessao.restauranteId, 'ifood').catch(() => null)
      if (!canal?.credenciais || !canal.merchantIdExterno) return NextResponse.json({ error: 'Conecte a loja ao iFood em Integrações › iFood (credenciais e id da loja) antes de ligar o entregador.' }, { status: 409 })
    } else {
      const atual = await buscarConfig(ctx.admin, ctx.sessao.restauranteId, ctx.provedor).catch(() => null)
      if (ctx.provedor === 'uber') {
        if (!(patch.chaves || atual?.chaves) || !(patch.contaId ?? atual?.contaId)) return NextResponse.json({ error: 'Para ligar, salve antes o Customer ID, o Client ID e o Client Secret da Uber Direct.' }, { status: 409 })
      } else if (!(patch.chaves || atual?.chaves) || !(patch.baseUrl ?? atual?.baseUrl)) return NextResponse.json({ error: `Para ligar, salve antes a URL base e as credenciais (${NOME_PROVEDOR[ctx.provedor]}).` }, { status: 409 })
    }
  }
  try {
    const cfg = await salvarConfig(ctx.admin, ctx.sessao.restauranteId, patch, ctx.provedor)
    await registrarAuditoria(ctx.admin, { restauranteId: ctx.sessao.restauranteId, usuarioId: ctx.sessao.userId, usuarioNome: ctx.sessao.nome, acao: `entregas.${ctx.provedor}_config`, entidade: 'entregas', entidadeId: ctx.provedor, dados: { ativo: cfg.ativo, credenciais: !!patch.chaves } })
    return NextResponse.json({ ok: true, config: paraPublica(cfg) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.slice(0, 200) || 'Não foi possível salvar.' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ provedor: string }> }) {
  const ctx = await contexto((await params).provedor)
  if ('erro' in ctx) return ctx.erro
  const corpo = (await request.json().catch(() => null)) as { acao?: string } | null
  if (corpo?.acao !== 'testar') return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  try {
    const pronta = await configProvedorPronta(ctx.admin, ctx.sessao.restauranteId, ctx.provedor)
    if (ctx.provedor === 'uber' && pronta.contaUber) {
      await tokenUber(pronta.contaUber)
      return NextResponse.json({ ok: true, mensagem: `Conexão ok: a Uber aceitou as credenciais (${pronta.contaUber.teste ? 'conta de TESTE — corridas simuladas' : 'produção'}).` })
    }
    if (ctx.provedor !== 'ifood' && pronta.contaFoody) {
      const res = await fetch(`${pronta.contaFoody.baseUrl}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: pronta.contaFoody.clientId, client_secret: pronta.contaFoody.clientSecret }), signal: AbortSignal.timeout(12_000) })
      if (!res.ok) return NextResponse.json({ error: `${NOME_PROVEDOR[ctx.provedor]} recusou as credenciais (HTTP ${res.status}).` }, { status: 502 })
      return NextResponse.json({ ok: true, mensagem: `Conexão ok: ${NOME_PROVEDOR[ctx.provedor]} aceitou as credenciais.` })
    }
    return NextResponse.json({ ok: true, mensagem: 'Pronto: a loja está conectada ao iFood e o entregador pode ser chamado pelo Kanban.' })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.slice(0, 200) || 'Falhou.' }, { status: 409 })
  }
}
