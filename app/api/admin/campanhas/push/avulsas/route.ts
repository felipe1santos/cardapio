import { NextResponse } from 'next/server'
import { exigirPushLiberado, lojaDoPainel } from '@/lib/push/painel'
import { linkDoDestino, processarAvulsas, resolverPublico, type DestinoAvulsa, type PublicoAvulsa } from '@/lib/push/motor'
import { processarFilaPush } from '@/lib/push/envio'

/** "AAAA-MM-DD" em Brasília. */
const diaSaoPaulo = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso))

function lerPublico(p: unknown): PublicoAvulsa | null {
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
  if (o.tipo === 'todos' || o.tipo === 'fidelidade') return { tipo: o.tipo }
  if (o.tipo === 'recentes' || o.tipo === 'inativos') {
    const dias = Math.round(Number(o.dias))
    return dias >= 1 && dias <= 365 ? { tipo: o.tipo, dias } : null
  }
  return null
}

function lerDestino(d: unknown): DestinoAvulsa | null {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
  if (o.tipo === 'cardapio' || o.tipo === 'promocoes') return { tipo: o.tipo }
  if (o.tipo === 'produto' && typeof o.id === 'string' && /^[0-9a-f-]{36}$/i.test(o.id)) return { tipo: 'produto', id: o.id }
  if (o.tipo === 'cupom' && typeof o.codigo === 'string' && o.codigo.trim()) return { tipo: 'cupom', codigo: o.codigo.trim().toUpperCase().slice(0, 40) }
  return null
}

/** Cria uma notificação avulsa: agora (sai no próximo ciclo da janela) ou agendada. */
export async function POST(request: Request) {
  const c = await lojaDoPainel()
  if ('erro' in c) return c.erro
  const bloqueio = exigirPushLiberado(c.loja)
  if (bloqueio) return bloqueio
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const titulo = String(b.titulo ?? '').trim()
  const texto = String(b.texto ?? '').trim()
  if (!titulo || titulo.length > 60) return NextResponse.json({ error: 'Título de 1 a 60 caracteres.' }, { status: 400 })
  if (!texto || texto.length > 200) return NextResponse.json({ error: 'Texto de 1 a 200 caracteres.' }, { status: 400 })
  const publico = lerPublico(b.publico)
  const destino = lerDestino(b.destino)
  if (!publico) return NextResponse.json({ error: 'Escolha o público.' }, { status: 400 })
  if (!destino) return NextResponse.json({ error: 'Escolha para onde a notificação leva.' }, { status: 400 })
  const imagem = typeof b.imagemUrl === 'string' && /^https:\/\//.test(b.imagemUrl.trim()) ? b.imagemUrl.trim().slice(0, 1000) : null
  let agendadoEm: string | null = null
  if (b.agendadoEm) {
    const t = new Date(String(b.agendadoEm))
    if (Number.isNaN(t.getTime()) || t.getTime() < Date.now() - 60_000) return NextResponse.json({ error: 'Horário de agendamento inválido.' }, { status: 400 })
    if (t.getTime() > Date.now() + 60 * 24 * 3600_000) return NextResponse.json({ error: 'Agende para no máximo 60 dias.' }, { status: 400 })
    agendadoEm = t.toISOString()
  }
  // Limite de notificações de campanha por dia (12/10): o da loja, preso ao teto do Super Admin (padrão 1).
  const dia = diaSaoPaulo(agendadoEm ?? new Date().toISOString())
  const [{ data: cfg }, { data: teto }, { data: doDia }] = await Promise.all([
    c.admin.from('push_config').select('limite_dia').eq('restaurante_id', c.loja.id).maybeSingle(),
    c.admin.from('plataforma_config').select('valor').eq('chave', 'push_teto_dia').maybeSingle(),
    c.admin.from('push_avulsas').select('agendado_em, criado_em').eq('restaurante_id', c.loja.id).neq('status', 'cancelada')
      .gte('criado_em', new Date(Date.now() - 62 * 86_400_000).toISOString()),
  ])
  const limite = Math.max(1, Math.min(Number(cfg?.limite_dia ?? 1) || 1, Number((teto as { valor?: unknown } | null)?.valor ?? 1) || 1))
  const usadas = (doDia ?? []).filter((x) => diaSaoPaulo((x.agendado_em as string | null) ?? (x.criado_em as string)) === dia).length
  if (usadas >= limite) return NextResponse.json({ error: `Limite de ${limite} notificação${limite > 1 ? 'ões' : ''} de campanha por dia já usado neste dia. Escolha outro dia.` }, { status: 409 })
  if (destino.tipo === 'produto') {
    const { data } = await c.admin.from('itens_cardapio').select('id').eq('id', destino.id).eq('restaurante_id', c.loja.id).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 400 })
  }
  const { clientes, aparelhos } = await resolverPublico(c.admin, c.loja.id, publico)
  const { data, error } = await c.admin.from('push_avulsas').insert({
    restaurante_id: c.loja.id, titulo, texto, imagem_url: imagem, destino, publico, agendado_em: agendadoEm,
    total_previsto: aparelhos.length, criado_por: c.usuario.id || null, criado_por_nome: c.usuario.nome,
  }).select('id').single()
  if (error || !data) return NextResponse.json({ error: 'Não foi possível criar.' }, { status: 500 })
  // "Agora": tenta já (se a loja estiver na janela de envio); senão o cron manda quando abrir.
  let enfileirados = 0
  if (!agendadoEm) {
    enfileirados = await processarAvulsas(c.admin)
    if (enfileirados) await processarFilaPush(c.admin, { limite: 300 })
  }
  return NextResponse.json({ ok: true, id: data.id, clientes, aparelhos: aparelhos.length, enfileirados, link: linkDoDestino(destino) }, { status: 201 })
}
