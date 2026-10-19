// Auditoria do atendimento (19/10): recria na Menuzia, com o número do dono, os casos que quebraram na Ponto 400 e mostra a
// resposta ANTES (transcrição real, anonimizada) × DEPOIS (resposta do robô/servidor local agora). Só os caminhos que não
// precisam da chave da IA (o .env.local não tem ANTHROPIC_API_KEY): robô + pedido em andamento no servidor.
//   WHATSAPP_ROBO_LIBERADO=1 npm run dev   →   node .medidas/testes-atendimento-menuzia.mjs
// Mexe SÓ na Menuzia: tempo_entrega do Perfil (e devolve), status da loja (e devolve), conversa do dono (limpa).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const BASE = process.argv[2] ?? 'http://localhost:3000'
const TEL55 = '5527992534407'
const { data: loja } = await admin.from('restaurantes').select('id, slug, status_loja, evolution_instance, tempo_entrega, tempo_retirada').eq('slug', 'menuzia').single()
if (loja?.slug !== 'menuzia') throw new Error('loja errada')
const { data: cfg } = await admin.from('whatsapp_robo_config').select('webhook_segredo, protecao_curta, protecao_longa').eq('restaurante_id', loja.id).single()
// A proteção anti-loop (8 respostas curtas) barraria o próprio teste: afrouxa na Menuzia e devolve no fim.
await admin.from('whatsapp_robo_config').update({ protecao_curta: 200, protecao_longa: 500 }).eq('restaurante_id', loja.id)
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const CONVERSA_LIMPA = { estado: 'robo', atendimento: 'robo', pediu_atendente_em: null, pediu_atendente_motivo: null, pediu_atendente_aviso_em: null, silenciada_em: null, silenciada_motivo: null, auto_estado: null, auto_estado_em: null, ia_rascunho: null, ia_desde: null, ia_respostas: 0 }
const limpar = () => admin.from('whatsapp_conversas').update(CONVERSA_LIMPA).eq('restaurante_id', loja.id).eq('telefone', TEL55)
const zap = async (texto) => {
  const desde = new Date().toISOString()
  const r = await fetch(`${BASE}/api/whatsapp/webhook/${cfg.webhook_segredo}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'messages.upsert', instance: loja.evolution_instance, data: { key: { remoteJid: `${TEL55}@s.whatsapp.net`, fromMe: false, id: `AUD${randomUUID().replace(/-/g, '').toUpperCase()}` }, pushName: 'Felipe', messageType: 'conversation', message: { conversation: texto }, messageTimestamp: Math.floor(Date.now() / 1000) } }) })
  const j = await r.json().catch(() => null)
  await espera(2500)
  const { data: env } = await admin.from('whatsapp_envios').select('texto').eq('restaurante_id', loja.id).eq('telefone', TEL55).gte('criado_em', desde).order('criado_em')
  return { status: r.status, j, respostas: (env ?? []).map((e) => e.texto) }
}
const { data: conv } = await admin.from('whatsapp_conversas').select('estado, atendimento, pediu_atendente_motivo').eq('restaurante_id', loja.id).eq('telefone', TEL55).maybeSingle()

const CASOS = [
  { n: 1, antes: '#26 tnicoli 17/10 23:03 — "Vcs tá fazendo entrega ainda" → ROBÔ: "📍 Não encontrei o bairro \'ainda\'" + lista de 25 bairros', msg: 'Vcs tá fazendo entrega ainda', espera: /HORÁRIO|fechados|abertos/i },
  { n: 2, antes: '#28 Monique 18/10 18:33 — "Consegue entregar uns lanches aqui na minha casa e o Rherisson acerta depois?" → ROBÔ: lista de bairros', msg: 'Consegue entregar uns lanches aqui na minha casa e o Rherisson acerta depois?', espera: /atendente|alguém da loja|Chamei/i },
  { n: 3, antes: '#3 heloara 16/10 18:56 — "Queria saber se vcs estão precisando de gente pra trabalhar" → ROBÔ: "Nosso pedido é feito online, no link"', msg: 'Queria saber se vcs estão precisando de gente pra trabalhar', espera: /atendente|Chamei/i },
  { n: 4, antes: '#31 Cicera 18/10 19:19 — "quanto tempo demora a entrega?" → IA: "O tempo de entrega não está cadastrado aqui, então não consigo informar"', msg: 'quanto tempo demora a entrega?', espera: /TEMPO DE ENTREGA.*costuma levar|Chamei|atendente/is, prep: async () => admin.from('restaurantes').update({ tempo_entrega: '30–40 min' }).eq('id', loja.id) },
  { n: 5, antes: '#40 Iasminy 18/10 20:38 — "2" / "Valparaiso" → IA: "Não tenho o tempo de entrega informado"', msg: ['2', 'Jaburuna'], espera: /Tempo de entrega: \*30–40 min\*/ },
  { n: 6, antes: '#20/#29 17/10 — "tá aberto?" com loja fechada na mão → "Estamos fechados agora." (sem dizer que hoje não abre)', msg: 'tá aberto?', espera: /fechados (hoje \(fora do horário normal\)|agora)/i, prep: async () => admin.from('restaurantes').update({ status_loja: 'fechado_manual' }).eq('id', loja.id) },
  { n: 7, antes: '#43 Rafaela 18/10 18:51 — "Vou paga pelo pix logo aqui posso ??" → ROBÔ: formas de pagamento + chave (ok hoje)', msg: 'Vou paga pelo pix logo aqui posso ??', espera: /Pix/i },
  { n: 8, antes: '#6 Adriana 16/10 — "#FQfZV67" → ROBÔ: "Não encontrei o pedido #67"', msg: ['3', '#FQfZV67'], espera: /número do pedido|Não encontrei|Confira/i },
]

const DIR = join(homedir(), 'menuzia-relatorios', 'ponto400-atendimento-2026-10-19'); mkdirSync(DIR, { recursive: true })
let md = `# Testes na Menuzia (local, ${new Date().toLocaleString('pt-BR')}) — antes (Ponto 400) × depois\n\nConversa do dono antes: ${JSON.stringify(conv)}\n`
let ok = 0
await admin.from('restaurantes').update({ status_loja: 'aberto_manual', tempo_entrega: null, tempo_retirada: null }).eq('id', loja.id)
try {
  for (const c of CASOS) {
    // O banco só deixa 5 respostas do robô por minuto na conversa: espaça os casos.
    if (c.n > 1) await espera(26_000)
    await limpar()
    if (c.prep) await c.prep()
    const msgs = Array.isArray(c.msg) ? c.msg : [c.msg]
    let resp = []
    for (const m of msgs) { const r = await zap(m); resp.push(`> ${m}\n${r.respostas.map((t) => '  ROBÔ: ' + t.replace(/\n/g, ' ⏎ ')).join('\n') || `  (sem resposta; webhook ${r.status} ${JSON.stringify(r.j).slice(0, 120)})`}`) }
    const texto = resp.join('\n')
    const passou = c.espera.test(texto)
    if (passou) ok++
    console.log(passou ? 'ok  ' : 'ERRO', `caso ${c.n}`)
    md += `\n## Caso ${c.n} ${passou ? '✅' : '❌'}\nANTES: ${c.antes}\nDEPOIS:\n${texto}\n`
  }
} finally {
  await admin.from('restaurantes').update({ status_loja: loja.status_loja, tempo_entrega: loja.tempo_entrega, tempo_retirada: loja.tempo_retirada }).eq('id', loja.id)
  await admin.from('whatsapp_robo_config').update({ protecao_curta: cfg.protecao_curta, protecao_longa: cfg.protecao_longa }).eq('restaurante_id', loja.id)
  await limpar()
  writeFileSync(join(DIR, 'testes-menuzia.md'), md)
  console.log(`${ok} de ${CASOS.length} — ${join(DIR, 'testes-menuzia.md')}`)
}
