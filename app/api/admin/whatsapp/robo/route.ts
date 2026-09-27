import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { BOAS_VINDAS_PADRAO, roboLiberadoNoServidor } from '@/lib/mensageria/robo'
import { LIMITES, TEMPOS_PADRAO, tempoValido } from '@/lib/mensageria/conversas'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'

/**
 * Robô de atendimento do WhatsApp — configuração da loja da sessão (Integrações).
 * Só quem gerencia integrações (dono), conferido aqui além do middleware. A loja vem da
 * sessão, nunca do corpo. O segredo do webhook sai daqui só MASCARADO (últimos 4).
 *
 * O dono liga e desliga o robô e vê os números. Boas-vindas, tempos, webhook e troca do
 * segredo são do SUPORTE da plataforma (e-mail em SUPERADMIN_EMAILS): só ele recebe esses
 * dados no GET e só ele altera (403 para os demais).
 *
 *   GET                                 → estado e números (+ avançado, se suporte)
 *   PUT  { roboAtivo? }                 → dono
 *   PUT  { boasVindas?, boasVindasHoras?, retornoMinutos? } → só suporte
 *   POST { acao: 'rotacionar_segredo' } → só suporte; segredo novo (o antigo para na hora)
 *
 * Ligar é recusado enquanto o servidor não estiver liberado (WHATSAPP_ROBO_LIBERADO=1):
 * publicar o código não pode virar mensagem real.
 */
async function contexto() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'integracoes.gerenciar')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  return { sessao, admin: getAdminSupabase() }
}

const semCache = { 'Cache-Control': 'no-store' }
const BASE = () => (process.env.MENUZIA_URL_PUBLICA ?? 'https://app.menuzia.com.br').replace(/\/$/, '')

/** Garante a linha da loja (desligada) — loja criada depois da 0103 ainda não tem. */
async function garantirConfig(admin: ReturnType<typeof getAdminSupabase>, restauranteId: string) {
  await admin.from('whatsapp_robo_config').upsert({ restaurante_id: restauranteId, robo_ativo: false }, { onConflict: 'restaurante_id', ignoreDuplicates: true })
}

export async function GET() {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx
  const loja = sessao.restauranteId
  await garantirConfig(admin, loja)
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString()
  const suporte = isSuperAdminEmail(sessao.email)
  const [cfg, dados, envios, recebidas] = await Promise.all([
    admin.from('whatsapp_robo_config')
      .select('robo_ativo, boas_vindas, boas_vindas_horas, retorno_minutos, webhook_segredo, atualizado_em, atualizado_por_nome')
      .eq('restaurante_id', loja).maybeSingle(),
    admin.from('restaurantes').select('nome, evolution_instance').eq('id', loja).maybeSingle(),
    admin.from('whatsapp_envios').select('estado').eq('restaurante_id', loja).gte('criado_em', desde),
    // Mensagens de clientes de verdade (não chamadas do webhook, que incluem status e marcadores).
    admin.from('whatsapp_mensagens').select('id', { count: 'exact', head: true }).eq('restaurante_id', loja).eq('direcao', 'entrada').gte('criado_em', desde),
  ])
  const contagem = { enviados: 0, pendentes: 0, falhas: 0 }
  for (const e of (envios.data ?? []) as { estado: string }[]) {
    if (e.estado === 'enviado') contagem.enviados++
    else if (e.estado === 'pendente' || e.estado === 'enviando') contagem.pendentes++
    else contagem.falhas++
  }
  const segredo = (cfg.data?.webhook_segredo as string | undefined) ?? ''
  const basico = {
    roboAtivo: cfg.data?.robo_ativo === true,
    liberadoNoServidor: roboLiberadoNoServidor(),
    instancia: (dados.data?.evolution_instance as string | null) ?? null,
    atualizadoEm: (cfg.data?.atualizado_em as string | null) ?? null,
    atualizadoPor: (cfg.data?.atualizado_por_nome as string | null) ?? null,
    envios24h: contagem,
    recebidas24h: recebidas.count ?? 0,
    suporte,
  }
  if (!suporte) return NextResponse.json(basico, { headers: semCache })
  return NextResponse.json({
    ...basico,
    boasVindas: (cfg.data?.boas_vindas as string | null) ?? null,
    boasVindasPadrao: BOAS_VINDAS_PADRAO((dados.data?.nome as string | undefined) ?? 'sua loja'),
    boasVindasHoras: (cfg.data?.boas_vindas_horas as number | undefined) ?? TEMPOS_PADRAO.boasVindasHoras,
    retornoMinutos: (cfg.data?.retorno_minutos as number | undefined) ?? TEMPOS_PADRAO.retornoMinutos,
    limites: LIMITES,
    webhookMascarado: segredo ? `${BASE()}/api/whatsapp/webhook/••••${segredo.slice(-4)}` : null,
  }, { headers: semCache })
}

export async function PUT(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx
  let corpo: { roboAtivo?: unknown; boasVindas?: unknown; boasVindasHoras?: unknown; retornoMinutos?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  const patch: Record<string, unknown> = {
    restaurante_id: sessao.restauranteId, atualizado_em: new Date().toISOString(), atualizado_por: sessao.userId,
    atualizado_por_nome: (sessao.nome ?? '').slice(0, 120) || null,
  }
  const resumo: string[] = []
  const avancado = corpo.boasVindas !== undefined || corpo.boasVindasHoras !== undefined || corpo.retornoMinutos !== undefined
  if (avancado && !isSuperAdminEmail(sessao.email)) {
    return NextResponse.json({ error: 'Essa configuração é feita pelo suporte Menuzia.', codigo: 'so_suporte' }, { status: 403 })
  }
  if (corpo.roboAtivo !== undefined) {
    if (typeof corpo.roboAtivo !== 'boolean') return NextResponse.json({ error: 'Valor inválido.' }, { status: 400 })
    if (corpo.roboAtivo && !roboLiberadoNoServidor()) {
      return NextResponse.json({ error: 'O robô ainda não foi liberado pela Menuzia. Fale com o suporte para ativar numa loja piloto.', codigo: 'nao_liberado' }, { status: 409 })
    }
    patch.robo_ativo = corpo.roboAtivo
    resumo.push(corpo.roboAtivo ? 'robô ligado' : 'robô desligado')
  }
  if (corpo.boasVindas !== undefined) {
    if (corpo.boasVindas !== null && typeof corpo.boasVindas !== 'string') return NextResponse.json({ error: 'Texto inválido.' }, { status: 400 })
    const texto = typeof corpo.boasVindas === 'string' ? corpo.boasVindas.trim() : ''
    if (texto.length > 500) return NextResponse.json({ error: 'O texto pode ter até 500 caracteres.' }, { status: 400 })
    patch.boas_vindas = texto || null
    resumo.push(texto ? 'boas-vindas personalizadas' : 'boas-vindas padrão')
  }
  if (corpo.boasVindasHoras !== undefined) {
    const v = tempoValido(corpo.boasVindasHoras, LIMITES.boasVindasHoras)
    if (v === null) return NextResponse.json({ error: `Boas-vindas: de ${LIMITES.boasVindasHoras[0]} a ${LIMITES.boasVindasHoras[1]} horas.` }, { status: 400 })
    patch.boas_vindas_horas = v
    resumo.push(`boas-vindas a cada ${v}h`)
  }
  if (corpo.retornoMinutos !== undefined) {
    const v = tempoValido(corpo.retornoMinutos, LIMITES.retornoMinutos)
    if (v === null) return NextResponse.json({ error: `Retorno do robô: de ${LIMITES.retornoMinutos[0]} a ${LIMITES.retornoMinutos[1]} minutos.` }, { status: 400 })
    patch.retorno_minutos = v
    resumo.push(`robô volta após ${v} min`)
  }
  if (!resumo.length) return NextResponse.json({ error: 'Nada para salvar.' }, { status: 400 })
  const { error } = await admin.from('whatsapp_robo_config').upsert(patch, { onConflict: 'restaurante_id' })
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome,
    acao: 'whatsapp.robo_configurado', entidade: 'restaurante', entidadeId: sessao.restauranteId, dados: { resumo: resumo.join(' · ') },
  })
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx
  const corpo = (await request.json().catch(() => null)) as { acao?: unknown } | null
  if (corpo?.acao !== 'rotacionar_segredo') return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
  if (!isSuperAdminEmail(sessao.email)) return NextResponse.json({ error: 'Essa configuração é feita pelo suporte Menuzia.', codigo: 'so_suporte' }, { status: 403 })
  await garantirConfig(admin, sessao.restauranteId)
  const novo = randomBytes(24).toString('hex')
  const { error } = await admin.from('whatsapp_robo_config')
    .update({ webhook_segredo: novo, atualizado_em: new Date().toISOString(), atualizado_por: sessao.userId, atualizado_por_nome: (sessao.nome ?? '').slice(0, 120) || null })
    .eq('restaurante_id', sessao.restauranteId)
  if (error) return NextResponse.json({ error: 'Não foi possível gerar o segredo.' }, { status: 500 })
  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome,
    acao: 'whatsapp.robo_configurado', entidade: 'restaurante', entidadeId: sessao.restauranteId, dados: { resumo: 'segredo do webhook trocado' },
  })
  return NextResponse.json({ ok: true, webhookMascarado: `${BASE()}/api/whatsapp/webhook/••••${novo.slice(-4)}` })
}
