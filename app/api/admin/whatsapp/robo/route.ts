import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { mascararTelefone } from '@/lib/mensageria/mascara'
import { BOAS_VINDAS_PADRAO } from '@/lib/mensageria/robo'

/**
 * Robô de atendimento do WhatsApp — configuração da loja da sessão (Integrações).
 * Só quem gerencia integrações (dono), conferido aqui além do middleware. A loja vem da
 * sessão. O segredo do webhook NUNCA sai daqui.
 */
async function contexto() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'integracoes.gerenciar')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  return { sessao, admin: getAdminSupabase() }
}

export async function GET() {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx
  const loja = sessao.restauranteId
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString()
  const [cfg, nome, silenciadas, envios] = await Promise.all([
    admin.from('whatsapp_robo_config').select('robo_ativo, boas_vindas, atualizado_em').eq('restaurante_id', loja).maybeSingle(),
    admin.from('restaurantes').select('nome').eq('id', loja).maybeSingle(),
    admin.from('whatsapp_conversas').select('id, telefone, silenciada_motivo, silenciada_em, ultima_mensagem_em')
      .eq('restaurante_id', loja).eq('estado', 'silenciada').order('ultima_mensagem_em', { ascending: false }).limit(50),
    admin.from('whatsapp_envios').select('estado').eq('restaurante_id', loja).gte('criado_em', desde),
  ])
  const contagem = { enviados: 0, pendentes: 0, falhas: 0 }
  for (const e of (envios.data ?? []) as { estado: string }[]) {
    if (e.estado === 'enviado') contagem.enviados++
    else if (e.estado === 'pendente' || e.estado === 'enviando') contagem.pendentes++
    else contagem.falhas++
  }
  const agora = Date.now()
  return NextResponse.json({
    roboAtivo: cfg.data?.robo_ativo === true,
    boasVindas: (cfg.data?.boas_vindas as string | null) ?? null,
    boasVindasPadrao: BOAS_VINDAS_PADRAO((nome.data?.nome as string | undefined) ?? 'sua loja'),
    silenciadas: ((silenciadas.data ?? []) as { id: string; telefone: string; silenciada_motivo: string | null; silenciada_em: string | null; ultima_mensagem_em: string | null }[])
      // Depois de 2h sem mensagem ela já volta sozinha na próxima mensagem: não pede ação.
      .filter((c) => !c.ultima_mensagem_em || agora - Date.parse(c.ultima_mensagem_em) < 2 * 3600_000)
      .map((c) => ({ id: c.id, telefone: mascararTelefone(c.telefone), motivo: c.silenciada_motivo, desde: c.silenciada_em, ultimaMensagem: c.ultima_mensagem_em })),
    envios24h: contagem,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx
  let corpo: { roboAtivo?: unknown; boasVindas?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  const patch: Record<string, unknown> = { restaurante_id: sessao.restauranteId, atualizado_em: new Date().toISOString(), atualizado_por: sessao.userId }
  const resumo: string[] = []
  if (corpo.roboAtivo !== undefined) {
    if (typeof corpo.roboAtivo !== 'boolean') return NextResponse.json({ error: 'Valor inválido.' }, { status: 400 })
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
  if (!resumo.length) return NextResponse.json({ error: 'Nada para salvar.' }, { status: 400 })
  const { error } = await admin.from('whatsapp_robo_config').upsert(patch, { onConflict: 'restaurante_id' })
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome,
    acao: 'whatsapp.robo_configurado', entidade: 'restaurante', entidadeId: sessao.restauranteId, dados: { resumo: resumo.join(' · ') },
  })
  return NextResponse.json({ ok: true })
}
