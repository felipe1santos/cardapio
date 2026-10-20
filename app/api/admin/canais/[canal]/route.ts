import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { registrarAuditoria } from '@/lib/auditoria'
import { buscarConfigCanal, canalValido, paraPublica, salvarConfigCanal } from '@/lib/canais/config'
import { tokenOd } from '@/lib/canais/opendelivery/cliente'
import { autorizarIfood, lojasIfood, pedirUserCodeIfood, tokenIfood } from '@/lib/canais/ifood/cliente'
import { CANAL_DISPONIVEL, NOME_CANAL } from '@/lib/canais/tipos'

export const dynamic = 'force-dynamic'

/**
 * Integrações › Keeta / 99Food / iFood (Etapa 2, 19/10). Só dono e gerente. Grátis para todas as lojas (20/10); enquanto o
 * canal não estiver homologado (CANAL_DISPONIVEL = false) a tela mostra "Em breve" e PUT/POST respondem 409.
 *   GET            → config pública + itens do app sem vínculo + itens do cardápio (para vincular)
 *   PUT  { ... }   → salva credenciais/URL/merchant/ativo
 *   POST { acao }  → 'testar' (token no app) · 'lojas' (iFood: lista merchants) · 'usercode' (iFood distribuído, passo 1)
 *                    · 'autorizar' (iFood, passo 2) · 'vincular' { codigoExterno, itemId|null }
 */
async function contexto(canal: string) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!['dono', 'gerente'].includes(sessao.papel)) return { erro: NextResponse.json({ error: 'Só o dono ou o gerente mexem nas integrações.' }, { status: 403 }) }
  if (!canalValido(canal)) return { erro: NextResponse.json({ error: 'Canal inválido.' }, { status: 404 }) }
  return { sessao, canal, admin: getAdminSupabase() }
}
const emBreve = (canal: keyof typeof CANAL_DISPONIVEL) => (CANAL_DISPONIVEL[canal] ? null : NextResponse.json({ error: `${NOME_CANAL[canal]}: em breve. A Menuzia ainda está homologando esta integração.`, codigo: 'em_breve' }, { status: 409 }))

const URL_PUBLICA = () => (process.env.MENUZIA_URL_PUBLICA ?? process.env.APP_URL ?? 'https://app.menuzia.com.br').replace(/\/$/, '')

export async function GET(_: Request, { params }: { params: Promise<{ canal: string }> }) {
  const ctx = await contexto((await params).canal)
  if ('erro' in ctx) return ctx.erro
  const cfg = await buscarConfigCanal(ctx.admin, ctx.sessao.restauranteId, ctx.canal).catch(() => null)
  const [{ data: vinculos }, { data: itens }] = await Promise.all([
    ctx.admin.from('canal_itens_vinculo').select('codigo_externo, nome_externo, item_id, visto_em').eq('restaurante_id', ctx.sessao.restauranteId).eq('canal', ctx.canal).order('visto_em', { ascending: false }).limit(300),
    ctx.admin.from('itens_cardapio').select('id, nome').eq('restaurante_id', ctx.sessao.restauranteId).order('nome').limit(1000),
  ])
  const publica = cfg ? paraPublica(cfg) : null
  return NextResponse.json({
    canal: ctx.canal, nome: NOME_CANAL[ctx.canal], config: publica,
    webhookUrl: ctx.canal === 'ifood' ? null : `${URL_PUBLICA()}/api/canais/opendelivery/webhook/${publica?.webhookToken ?? ''}`,
    merchantUrl: ctx.canal === 'ifood' ? null : `${URL_PUBLICA()}/api/canais/opendelivery/merchant/${publica?.webhookToken ?? ''}`,
    vinculos: (vinculos ?? []).map((v) => ({ codigoExterno: v.codigo_externo, nomeExterno: v.nome_externo, itemId: v.item_id, vistoEm: v.visto_em })),
    itens: (itens ?? []).map((i) => ({ id: i.id, nome: i.nome })),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request, { params }: { params: Promise<{ canal: string }> }) {
  const ctx = await contexto((await params).canal)
  if ('erro' in ctx) return ctx.erro
  const bloqueio = emBreve(ctx.canal)
  if (bloqueio) return bloqueio
  const c = (await request.json().catch(() => null)) as { ativo?: unknown; ambiente?: unknown; baseUrl?: unknown; clientId?: unknown; clientSecret?: unknown; limparCredenciais?: unknown; merchantIdExterno?: unknown; appIdExterno?: unknown } | null
  if (!c || typeof c !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })
  const patch: Parameters<typeof salvarConfigCanal>[3] = { porNome: ctx.sessao.nome }
  if (typeof c.ativo === 'boolean') patch.ativo = c.ativo
  if (c.ambiente === 'sandbox' || c.ambiente === 'producao') patch.ambiente = c.ambiente
  if (typeof c.baseUrl === 'string') {
    const u = c.baseUrl.trim()
    if (u && !/^https:\/\/[a-z0-9.-]+(\/[^\s]*)?$/i.test(u)) return NextResponse.json({ error: 'URL base inválida (precisa começar com https://).' }, { status: 400 })
    patch.baseUrl = u
  }
  if (typeof c.merchantIdExterno === 'string') patch.merchantIdExterno = c.merchantIdExterno
  if (typeof c.appIdExterno === 'string') patch.appIdExterno = c.appIdExterno
  if (c.limparCredenciais === true) patch.credenciais = null
  else if (typeof c.clientId === 'string' && typeof c.clientSecret === 'string' && c.clientId.trim() && c.clientSecret.trim()) {
    if (c.clientId.length > 200 || c.clientSecret.length > 500) return NextResponse.json({ error: 'Credenciais grandes demais.' }, { status: 400 })
    patch.credenciais = { clientId: c.clientId.trim(), clientSecret: c.clientSecret.trim() }
  }
  if (patch.ativo === true) {
    const atual = await buscarConfigCanal(ctx.admin, ctx.sessao.restauranteId, ctx.canal).catch(() => null)
    const temCred = !!(patch.credenciais || atual?.credenciais)
    const temUrl = ctx.canal === 'ifood' || !!(patch.baseUrl ?? atual?.baseUrl)
    if (!temCred || !temUrl) return NextResponse.json({ error: 'Para ligar, salve antes as credenciais' + (ctx.canal === 'ifood' ? '.' : ' e a URL base do app.') }, { status: 409 })
  }
  try {
    const cfg = await salvarConfigCanal(ctx.admin, ctx.sessao.restauranteId, ctx.canal, patch)
    await registrarAuditoria(ctx.admin, { restauranteId: ctx.sessao.restauranteId, usuarioId: ctx.sessao.userId, usuarioNome: ctx.sessao.nome, acao: 'canal.config', entidade: 'canal', entidadeId: ctx.canal, dados: { ativo: cfg.ativo, ambiente: cfg.ambiente, credenciais: !!patch.credenciais, limpou: patch.credenciais === null } })
    return NextResponse.json({ ok: true, config: paraPublica(cfg) })
  } catch (e) {
    if ((e as Error).message === 'cofre_indisponivel') return NextResponse.json({ error: 'O cofre de segredos não está configurado no servidor (PAGAMENTOS_CHAVE).' }, { status: 503 })
    console.error('[canais config]', (e as Error).message)
    return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ canal: string }> }) {
  const ctx = await contexto((await params).canal)
  if ('erro' in ctx) return ctx.erro
  const bloqueio = emBreve(ctx.canal)
  if (bloqueio) return bloqueio
  const corpo = (await request.json().catch(() => null)) as { acao?: string; codigoExterno?: string; itemId?: string | null; authorizationCode?: string; authorizationCodeVerifier?: string } | null
  const acao = corpo?.acao
  const cfg = await buscarConfigCanal(ctx.admin, ctx.sessao.restauranteId, ctx.canal).catch(() => null)
  try {
    if (acao === 'vincular') {
      if (!corpo?.codigoExterno) return NextResponse.json({ error: 'Código do item inválido.' }, { status: 400 })
      const itemId = corpo.itemId && /^[0-9a-f-]{36}$/i.test(corpo.itemId) ? corpo.itemId : null
      await ctx.admin.from('canal_itens_vinculo').upsert({ restaurante_id: ctx.sessao.restauranteId, canal: ctx.canal, codigo_externo: corpo.codigoExterno.slice(0, 120), item_id: itemId }, { onConflict: 'restaurante_id,canal,codigo_externo' })
      return NextResponse.json({ ok: true })
    }
    if (!cfg?.credenciais) return NextResponse.json({ error: 'Salve as credenciais primeiro.' }, { status: 409 })
    if (acao === 'testar') {
      if (ctx.canal === 'ifood') await tokenIfood(ctx.admin, cfg)
      else { if (!cfg.baseUrl) return NextResponse.json({ error: 'Informe a URL base do app.' }, { status: 409 }); await tokenOd(ctx.admin, cfg) }
      return NextResponse.json({ ok: true, mensagem: 'Conexão ok: o app aceitou as credenciais.' })
    }
    if (acao === 'lojas' && ctx.canal === 'ifood') return NextResponse.json({ ok: true, lojas: await lojasIfood(ctx.admin, cfg) })
    if (acao === 'usercode' && ctx.canal === 'ifood') return NextResponse.json({ ok: true, ...(await pedirUserCodeIfood(cfg)) })
    if (acao === 'autorizar' && ctx.canal === 'ifood') {
      if (!corpo?.authorizationCode || !corpo?.authorizationCodeVerifier) return NextResponse.json({ error: 'Cole o código de autorização.' }, { status: 400 })
      await autorizarIfood(ctx.admin, cfg, corpo.authorizationCode.trim(), corpo.authorizationCodeVerifier.trim())
      await registrarAuditoria(ctx.admin, { restauranteId: ctx.sessao.restauranteId, usuarioId: ctx.sessao.userId, usuarioNome: ctx.sessao.nome, acao: 'canal.autorizado', entidade: 'canal', entidadeId: 'ifood' })
      return NextResponse.json({ ok: true, mensagem: 'iFood autorizado para esta loja.' })
    }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: `${NOME_CANAL[ctx.canal]}: ${(e as Error).message?.slice(0, 200) || 'falhou'}` }, { status: 502 })
  }
}
