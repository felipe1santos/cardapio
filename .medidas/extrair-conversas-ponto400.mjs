// Auditoria do atendimento (19/10): extrai, SÓ LEITURA, as conversas da Ponto 400 desde 16/10 para FORA do git
// (dados de cliente). Telefones mascarados. Saída: C:/Users/felipe/menuzia-relatorios/ponto400-atendimento-2026-10-19/
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const R = 'dd4edbbb-879f-4b41-acf4-c06570fab400'
const DESDE = '2026-10-16T00:00:00-03:00'
const DIR = join(homedir(), 'menuzia-relatorios', 'ponto400-atendimento-2026-10-19'); mkdirSync(DIR, { recursive: true })
const mask = (t) => String(t ?? '').replace(/\d(?=\d{4})/g, '•')
const hora = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const { data: convs } = await admin.from('whatsapp_conversas').select('*').eq('restaurante_id', R).gte('ultima_atividade_em', DESDE).order('ultima_atividade_em')
const { data: msgs } = await admin.from('whatsapp_mensagens').select('conversa_id, direcao, origem, tipo, texto, criado_em, acao_robo, intencao_robo, autor_nome, status_envio, erro').eq('restaurante_id', R).gte('criado_em', DESDE).order('criado_em')
const { data: evs } = await admin.from('whatsapp_eventos').select('conversa_id, tipo, resultado, criado_em').eq('restaurante_id', R).gte('criado_em', DESDE).not('conversa_id', 'is', null).order('criado_em')
const { data: peds } = await admin.from('pedidos').select('numero, status, criado_em, cliente_telefone, cliente_nome, tipo, total, origem, origem_canal, origem_detalhe, cancelado_motivo, cancelado_por').eq('restaurante_id', R).gte('criado_em', DESDE).order('criado_em')
const { data: sol } = await admin.from('pedido_solicitacoes').select('*').eq('restaurante_id', R).gte('criado_em', DESDE)
const { data: cfg } = await admin.from('whatsapp_robo_config').select('autoatendimento_ativo, auto_assuntos_desligados, auto_textos, auto_palavras, auto_tempo_entrega, auto_limite_loja_min, ia_ativo, ia_teto_usd_dia, pix_chave_tipo').eq('restaurante_id', R).maybeSingle()
const { data: loja } = await admin.from('restaurantes').select('nome, status_loja, aceita_retirada, aceita_entrega, tempo_entrega_min, tempo_entrega_max, horarios, horario_funcionamento, taxa_entrega_padrao, entrega_raio_km, endereco_cidade, pedido_minimo').eq('id', R).maybeSingle()

const porConv = new Map()
for (const m of msgs ?? []) { if (!porConv.has(m.conversa_id)) porConv.set(m.conversa_id, []); porConv.get(m.conversa_id).push(m) }
const evPorConv = new Map()
for (const e of evs ?? []) { if (!evPorConv.has(e.conversa_id)) evPorConv.set(e.conversa_id, []); evPorConv.get(e.conversa_id).push(e) }
const dig = (t) => String(t ?? '').replace(/\D/g, '').slice(-8)

let md = `# Conversas Ponto 400 desde 16/10 (extração ${new Date().toLocaleString('pt-BR')})\n\nLoja: ${JSON.stringify(loja)}\n\nConfig robô/IA: ${JSON.stringify(cfg)}\n\nConversas: ${convs.length} · mensagens: ${msgs.length} · pedidos no período: ${peds.length} · solicitações: ${(sol ?? []).length}\n`
const json = []
let i = 0
for (const c of convs) {
  i++
  const ms = porConv.get(c.id) ?? []
  const ps = (peds ?? []).filter((p) => dig(p.cliente_telefone) === dig(c.telefone))
  const es = evPorConv.get(c.id) ?? []
  json.push({ n: i, telefone: mask(c.telefone), nome: c.nome_contato, estado: c.estado, atendimento: c.atendimento, atendente: c.atendente_nome, pediu_atendente_em: c.pediu_atendente_em, pediu_atendente_motivo: c.pediu_atendente_motivo, auto_estado: c.auto_estado, ia_desde: c.ia_desde, ia_respostas: c.ia_respostas, ia_pedido_id: c.ia_pedido_id, ia_rascunho: c.ia_rascunho, ia_carrinho: c.ia_carrinho, mensagens: ms, eventos: es, pedidos: ps })
  md += `\n\n## ${i}. ${c.nome_contato ?? '(sem nome)'} · ${mask(c.telefone)} · estado=${c.estado} atendimento=${c.atendimento}${c.atendente_nome ? ` (${c.atendente_nome})` : ''}${c.pediu_atendente_motivo ? ` · pediu atendente: ${c.pediu_atendente_motivo}` : ''} · ia_respostas=${c.ia_respostas ?? 0} · auto_estado=${c.auto_estado ?? '-'}\n`
  if (ps.length) md += `Pedidos: ${ps.map((p) => `#${p.numero} ${p.status} ${hora(p.criado_em)} ${p.tipo} R$${p.total} origem=${p.origem_canal ?? p.origem}${p.origem_detalhe?.meio ? '/' + p.origem_detalhe.meio : ''}${p.cancelado_motivo ? ' cancel=' + p.cancelado_motivo : ''}`).join(' | ')}\n`
  if (c.ia_rascunho) md += `ia_rascunho: ${JSON.stringify(c.ia_rascunho).slice(0, 400)}\n`
  md += '\n'
  for (const m of ms) {
    const quem = m.direcao === 'entrada' ? 'CLIENTE' : m.origem === 'ia' ? 'IA' : m.origem === 'robo' ? 'ROBÔ' : m.origem === 'automatico' ? 'AUTO' : `LOJA${m.autor_nome ? ':' + m.autor_nome : ''}`
    const extra = [m.tipo !== 'texto' ? `[${m.tipo}]` : '', m.acao_robo ? `{robo:${m.acao_robo}${m.intencao_robo ? '/' + m.intencao_robo : ''}}` : '', m.status_envio && m.status_envio !== 'enviada' ? `(${m.status_envio}${m.erro ? ': ' + String(m.erro).slice(0, 60) : ''})` : ''].filter(Boolean).join(' ')
    md += `- ${hora(m.criado_em)} **${quem}** ${extra}: ${String(m.texto ?? '').replace(/\n/g, ' ⏎ ').slice(0, 700)}\n`
  }
  if (es.length) md += `eventos: ${es.map((e) => `${hora(e.criado_em)} ${e.tipo}${e.resultado ? ' ' + JSON.stringify(e.resultado).slice(0, 80) : ''}`).join(' | ')}\n`
}
writeFileSync(join(DIR, 'conversas.md'), md)
writeFileSync(join(DIR, 'conversas.json'), JSON.stringify(json, null, 1))
console.log('ok', DIR, 'conversas', convs.length, 'msgs', msgs.length, 'pedidos', peds.length, 'solic', (sol ?? []).length)
console.log('loja:', JSON.stringify(loja))
console.log('cfg:', JSON.stringify(cfg))
