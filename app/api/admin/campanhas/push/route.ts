import { NextResponse } from 'next/server'
import { lojaDoPainel } from '@/lib/push/painel'
import { carregarAutomacoes, carregarConfig, versaoIcone } from '@/lib/push/motor'
import { pushConfigurado } from '@/lib/push/envio'
import { TETO_DIA, TETO_SEMANA } from '@/lib/push/regras'
import { VARIAVEIS_DO_TIPO } from '@/lib/push/conteudo'

export const dynamic = 'force-dynamic'

const DIA = 24 * 3600_000

/** Tudo da tela "Notificações do app": resumo, configuração, automações, avulsas e relatórios. */
export async function GET() {
  const c = await lojaDoPainel()
  if ('erro' in c) return c.erro
  const { admin, loja } = c

  const [config, automacoes] = await Promise.all([carregarConfig(admin, loja.id), carregarAutomacoes(admin, loja.id)])

  const { data: assinaturas } = await admin.from('push_assinaturas').select('plataforma, instalado, cliente_telefone').eq('restaurante_id', loja.id).eq('status', 'ativa')
  const resumo = { total: 0, android: 0, ios: 0, desktop: 0, outro: 0, instalados: 0, clientes: 0 }
  const clientes = new Set<string>()
  for (const a of assinaturas ?? []) {
    resumo.total++
    resumo[a.plataforma as 'android' | 'ios' | 'desktop' | 'outro']++
    if (a.instalado) resumo.instalados++
    if (a.cliente_telefone) clientes.add(a.cliente_telefone)
  }
  resumo.clientes = clientes.size

  // Relatórios dos últimos 30 dias, por automação e por avulsa.
  const { data: envios } = await admin
    .from('push_envios')
    .select('origem, tipo, avulsa_id, status, clicado_em, pedido_id')
    .eq('restaurante_id', loja.id)
    .gte('criado_em', new Date(Date.now() - 30 * DIA).toISOString())
    .limit(100000)
  type Linha = { enviadas: number; falhas: number; pendentes: number; cliques: number; pedidos: number }
  const nova = (): Linha => ({ enviadas: 0, falhas: 0, pendentes: 0, cliques: 0, pedidos: 0 })
  const porTipo: Record<string, Linha> = {}
  const porAvulsa: Record<string, Linha> = {}
  for (const e of envios ?? []) {
    const alvo = e.avulsa_id ? (porAvulsa[e.avulsa_id] ??= nova()) : (porTipo[e.origem === 'teste' ? 'teste' : e.tipo] ??= nova())
    if (e.status === 'enviado') alvo.enviadas++
    else if (e.status === 'pendente') alvo.pendentes++
    else if (e.status === 'falhou' || e.status === 'invalida') alvo.falhas++
    if (e.clicado_em) alvo.cliques++
    if (e.pedido_id) alvo.pedidos++
  }

  const { data: avulsas } = await admin
    .from('push_avulsas')
    .select('id, titulo, texto, imagem_url, destino, publico, agendado_em, status, total_previsto, criado_por_nome, criado_em')
    .eq('restaurante_id', loja.id)
    .order('criado_em', { ascending: false })
    .limit(30)

  return NextResponse.json({
    liberado: loja.pushLiberado,
    servidorConfigurado: pushConfigurado() || process.env.PUSH_PROVEDOR === 'simulado',
    loja: { nome: loja.nome, slug: loja.slug, icone: `/api/loja/${loja.slug}/icone/192?v=${versaoIcone(loja)}`, badge: `/api/loja/${loja.slug}/push/badge?v=${versaoIcone(loja)}` },
    config: { limiteDia: config.limiteDia, limiteSemana: config.limiteSemana, antecedenciaMin: config.antecedenciaMin, telefoneTeste: config.telefoneTeste, tetoDia: TETO_DIA, tetoSemana: TETO_SEMANA },
    automacoes: automacoes.map((a) => ({ ...a, variaveis: VARIAVEIS_DO_TIPO[a.tipo] })),
    resumo,
    relatorio: { porTipo, porAvulsa },
    avulsas: (avulsas ?? []).map((a) => ({ ...a, relatorio: porAvulsa[a.id] ?? nova() })),
  })
}
