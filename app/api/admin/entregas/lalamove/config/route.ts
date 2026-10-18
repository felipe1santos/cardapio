import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { criptografiaPronta } from '@/lib/pagamentos/cripto'
import { ambienteDaChave } from '@/lib/entregas/lalamove-regras'
import { cidadeDaLoja, coberturaLalamove } from '@/lib/entregas/lalamove-cidades'
import { buscarConfig, paraPublica, salvarConfig, type ConfigPatch } from '@/lib/entregas/queries'
import { urlWebhook } from '@/lib/entregas/lalamove-servidor'

/**
 * Integrações › Lalamove (0199). Só o dono. As chaves ficam cifradas e NUNCA voltam: o GET diz só se existem e os 4
 * últimos da API key.
 *   GET  → { config | null, cobertura, webhookUrl, cofrePronto }
 *   PUT  { apiKey?, apiSecret?, ambiente?, ativo?, remover? }
 */
async function sessaoDono() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) } as const
  if (!pode(sessao.papel, 'integracoes.gerenciar')) return { erro: NextResponse.json({ error: 'Só o dono configura as integrações.' }, { status: 403 }) } as const
  return { sessao, admin: getAdminSupabase() } as const
}

async function resposta(admin: ReturnType<typeof getAdminSupabase>, restauranteId: string) {
  const [cfg, { data: loja }] = await Promise.all([
    buscarConfig(admin, restauranteId),
    admin.from('restaurantes').select('endereco, endereco_cidade').eq('id', restauranteId).maybeSingle(),
  ])
  const cidade = cidadeDaLoja({ enderecoCidade: (loja?.endereco_cidade as string | null) ?? null, endereco: (loja?.endereco as string | null) ?? null })
  return NextResponse.json({
    config: cfg ? paraPublica(cfg) : null,
    cobertura: coberturaLalamove(cidade),
    webhookUrl: cfg ? urlWebhook(cfg.webhookToken) : null,
    cofrePronto: criptografiaPronta(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function GET() {
  const c = await sessaoDono()
  if ('erro' in c) return c.erro
  return resposta(c.admin, c.sessao.restauranteId)
}

export async function PUT(request: Request) {
  const c = await sessaoDono()
  if ('erro' in c) return c.erro
  const corpo = (await request.json().catch(() => null)) as { apiKey?: unknown; apiSecret?: unknown; ambiente?: unknown; ativo?: unknown; remover?: unknown } | null
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })
  const patch: ConfigPatch = { porNome: c.sessao.nome }
  const auditoria: Record<string, unknown> = {}
  if (corpo.remover === true) { patch.chaves = null; auditoria.chaves = 'removidas' }
  else if (typeof corpo.apiKey === 'string' || typeof corpo.apiSecret === 'string') {
    const apiKey = String(corpo.apiKey ?? '').trim(), apiSecret = String(corpo.apiSecret ?? '').trim()
    if (!/^[A-Za-z0-9_\-]{10,200}$/.test(apiKey) || !/^[A-Za-z0-9_\-]{10,300}$/.test(apiSecret)) {
      return NextResponse.json({ error: 'Cole a API key (pk_…) e o secret (sk_…) como aparecem no Partner Portal da Lalamove.' }, { status: 400 })
    }
    if (!criptografiaPronta()) return NextResponse.json({ error: 'O servidor está sem a chave do cofre (PAGAMENTOS_CHAVE). Fale com o suporte da Menuzia.' }, { status: 503 })
    patch.chaves = { apiKey, apiSecret }
    // O ambiente segue a chave colada (pk_test → Teste, pk_prod → Produção); a escolha manual só vale se a chave não disser.
    patch.ambiente = ambienteDaChave(apiKey) ?? (corpo.ambiente === 'producao' ? 'producao' : 'sandbox')
    auditoria.chaves = 'definidas'; auditoria.ambiente = patch.ambiente
  }
  if (corpo.ambiente === 'sandbox' || corpo.ambiente === 'producao') { patch.ambiente = patch.ambiente ?? corpo.ambiente; auditoria.ambiente = patch.ambiente }
  if (typeof corpo.ativo === 'boolean') {
    if (corpo.ativo) {
      const atual = await buscarConfig(c.admin, c.sessao.restauranteId)
      if (!atual?.chaves && !patch.chaves) return NextResponse.json({ error: 'Cole as chaves antes de ligar a Lalamove.' }, { status: 400 })
    }
    patch.ativo = corpo.ativo; auditoria.ativo = corpo.ativo
  }
  if (Object.keys(auditoria).length === 0) return NextResponse.json({ error: 'Nada para salvar.' }, { status: 400 })
  try {
    await salvarConfig(c.admin, c.sessao.restauranteId, patch)
  } catch (e) {
    console.error('[lalamove] salvar config:', (e as Error).message)
    return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  }
  await registrarAuditoria(c.admin, { restauranteId: c.sessao.restauranteId, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao: 'integracoes.lalamove', entidade: 'restaurante', entidadeId: c.sessao.restauranteId, dados: auditoria }).catch(() => {})
  return resposta(c.admin, c.sessao.restauranteId)
}
