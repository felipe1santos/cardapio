/**
 * Varredura 2026-09-29 — cenários de DISPARO que a e2e-campanhas-metricas não cobre.
 * Provedor SIMULADO, stack local, lojas camp-e2e-a/b (semeadas pela e2e de campanhas;
 * rode aquela antes). Nada sai para fora: o servidor local zera a Evolution.
 *
 * Cada cenário imprime ✅ (comportamento correto), 🐞 (bug confirmado) ou ℹ️ (fato).
 *
 *   CAMP_PROVEDOR=simulado WHATSAPP_SIMULADO_ARQUIVO=<o do servidor> CRON_SECRET=<o do servidor> \
 *     node scripts/seguranca/qa-disparos-varredura.mjs
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const ARQ = process.env.WHATSAPP_SIMULADO_ARQUIVO
if (process.env.CAMP_PROVEDOR !== 'simulado' || !ARQ || !process.env.CRON_SECRET) {
  console.error('Trava: CAMP_PROVEDOR=simulado, WHATSAPP_SIMULADO_ARQUIVO e CRON_SECRET. Nada foi escrito.')
  process.exit(2)
}
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const linha = (icone, n, d = '') => console.log(`   ${icone} ${n}${d ? ` — ${d}` : ''}`)
const secao = (t) => console.log(`\n── ${t} ──`)

const A = (await um(`select id from restaurantes where slug='camp-e2e-a'`))?.id
const B = (await um(`select id from restaurantes where slug='camp-e2e-b'`))?.id
if (!A || !B) { console.error('Rode antes a e2e-campanhas-metricas (semeia camp-e2e-a/b).'); process.exit(2) }

const enviados = () => (existsSync(ARQ) ? readFileSync(ARQ, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const controle = (c) => writeFileSync(`${ARQ}.controle.json`, JSON.stringify(c))
const limparSimulado = () => { if (existsSync(ARQ)) rmSync(ARQ); if (existsSync(`${ARQ}.controle.json`)) rmSync(`${ARQ}.controle.json`) }
const cron = () => fetch(`${BASE}/api/cron/campanhas`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))
const cronAteVazio = async (max = 20) => { for (let i = 0; i < max; i++) { const r = await cron(); if (!r.j?.processados) return } }

async function reset() {
  limparSimulado()
  for (const loja of [A, B]) {
    await db.query(`delete from campanhas where restaurante_id=$1`, [loja])
    await db.query(`delete from whatsapp_mensagens where restaurante_id=$1`, [loja])
    await db.query(`delete from whatsapp_conversas where restaurante_id=$1`, [loja])
    await db.query(`delete from clientes where restaurante_id=$1`, [loja])
    await db.query(`delete from whatsapp_descadastros where restaurante_id=$1`, [loja])
    await db.query(`update restaurantes set evolution_instance=$2 where id=$1`, [loja, loja === A ? 'camp-sim-a' : 'camp-sim-b'])
  }
}
const cliente = (loja, telefone, nome) => db.query(`insert into clientes (restaurante_id, telefone, nome) values ($1,$2,$3)`, [loja, telefone, nome])

const browser = await chromium.launch()
const ctx = await browser.newContext({ locale: 'pt-BR' })
const p = await ctx.newPage()
await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await p.fill('input[name="email"]', 'dono.campa')
await p.fill('input[name="password"]', SENHA)
await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
const api = (url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  return { s: r.status, j: await r.json().catch(() => null) }
}, { url: `${BASE}${url}`, metodo, corpo })
const criar = (extra) => api('/api/admin/campanhas', 'POST', {
  nome: 'QA', tipoMensagem: 'texto', mensagem: 'Oi', filtro: { tipo: 'todos' }, incluirLink: false,
  disparar: true, agendadoEm: new Date().toISOString(), ...extra,
})

try {
  secao('1. Variáveis, acentos, emoji e texto longo')
  await reset()
  await cliente(A, '5511912340101', 'João Ávila')
  const longo = 'Promoção de sábado! 🍔🔥 Açaí, pão de queijo & coração 💚\n' + 'x'.repeat(3000)
  const c1 = await criar({ mensagem: `Olá {nome}! ${longo}` })
  await cronAteVazio()
  const s1 = enviados().filter((e) => e.resultado === 'ok')
  linha(s1.length === 1 ? '✅' : '🐞', 'um envio', `${s1.length}`)
  const texto = s1[0]?.texto ?? ''
  linha(texto.startsWith('Olá João!') ? '✅' : '🐞', '{nome} vira o primeiro nome do cliente', texto.slice(0, 40))
  const desconhecida = await criar({ mensagem: 'Oi {Nome}, use o {cupom}' })
  linha(desconhecida.s === 400 && /Variável desconhecida/.test(desconhecida.j?.error ?? '') ? '✅' : '🐞', 'variável desconhecida bloqueia o salvar', `${desconhecida.s} ${desconhecida.j?.error ?? ''}`.slice(0, 90))
  linha(texto.includes('🍔🔥') && texto.includes('Açaí') && texto.includes('💚') ? '✅' : '🐞', 'acentos e emoji chegam intactos')
  linha(texto.length >= 3000 ? '✅' : '🐞', 'texto longo (3 mil+) não é cortado', `${texto.length} caracteres`)
  const hist = await um(`select origem, texto from whatsapp_mensagens where restaurante_id=$1 and direcao='loja' order by criado_em desc limit 1`, [A])
  linha(hist?.origem === 'disparo' ? '✅' : '🐞', 'histórico da central marca a mensagem como "disparo"', hist?.origem ?? 'nenhuma')
  void c1

  secao('2. Público: telefone vazio, inválido, duplicado; estimativa x envio')
  await reset()
  await cliente(A, '5511912340101', 'Válido')
  await cliente(A, '11912340101', 'Mesmo número sem 55')
  await cliente(A, '123', 'Curto')
  await cliente(A, '5511912340102999', 'Longo demais')
  await cliente(A, '5511912340103', 'Outro válido')
  await cliente(B, '5511912340104', 'Cliente da loja B')
  const est = await api('/api/admin/campanhas/estimativa', 'POST', { filtro: { tipo: 'todos' } })
  const c2 = (await criar({})).j
  const camp2 = await um(`select total_destinatarios, duplicados_bloqueados from campanhas where id=$1`, [c2.id])
  linha(est.j?.total === camp2.total_destinatarios ? '✅' : '🐞', 'estimativa na tela = destinatários da fila', `estimativa ${est.j?.total}, fila ${camp2.total_destinatarios} (+${camp2.duplicados_bloqueados} duplicado)`)
  await cronAteVazio()
  const fila2 = await q(`select telefone, status, erro from campanha_envios where campanha_id=$1 order by telefone`, [c2.id])
  const ruins = fila2.filter((e) => ['123', '5511912340102999'].includes(e.telefone))
  linha(ruins.length === 0 ? '✅' : '🐞', 'telefone inválido fica fora da fila (e fora da contagem)', ruins.map((e) => `${e.telefone}=${e.status} (${e.erro})`).join('; '))
  const numeros = enviados().filter((e) => e.resultado === 'ok').map((e) => e.numero)
  linha(!numeros.includes('5511912340104') ? '✅' : '🐞', 'cliente da loja B nunca entra na campanha da A')
  linha(new Set(numeros).size === numeros.length ? '✅' : '🐞', 'ninguém recebe duas vezes', numeros.join(','))
  const inst = [...new Set(enviados().map((e) => e.instancia))]
  linha(inst.length === 1 && inst[0] === 'camp-sim-a' ? '✅' : '🐞', 'saiu só pela instância da loja A', inst.join(','))

  secao('3. Descadastro (opt-out)')
  await reset()
  await cliente(A, '5511912340101', 'Quer sair')
  await criar({ incluirDescadastro: true })
  await cronAteVazio()
  const comRodape = enviados().find((e) => e.resultado === 'ok' && e.numero === '5511912340101')?.texto ?? ''
  linha(/Para não receber mais, responda SAIR\.$/.test(comRodape) ? '✅' : '🐞', 'rodapé "responda SAIR" no fim da campanha', comRodape.slice(-45))
  limparSimulado()
  // Cliente responde "SAIR" (webhook do robô grava a entrada).
  const seg = (await um(`select webhook_segredo s from whatsapp_robo_config where restaurante_id=$1`, [A])).s
  await fetch(`${BASE}/api/whatsapp/webhook/${seg}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    event: 'messages.upsert', instance: 'camp-sim-a', sender: '5511900000000@s.whatsapp.net',
    data: { key: { remoteJid: '5511912340101@s.whatsapp.net', fromMe: false, id: `QASAIR${Date.now()}` }, message: { conversation: 'SAIR' }, messageTimestamp: Math.floor(Date.now() / 1000) },
  }) })
  const confirmacao = enviados().find((e) => e.resultado === 'ok' && e.numero === '5511912340101')?.texto ?? ''
  linha(/não vai mais receber promoções/.test(confirmacao) ? '✅' : '🐞', 'SAIR responde confirmando (robô da loja desligado)', confirmacao.slice(0, 60))
  limparSimulado()
  await criar({ nome: 'QA 2' })
  await cronAteVazio()
  const aposSair = enviados().filter((e) => e.resultado === 'ok' && e.numero === '5511912340101')
  linha(aposSair.length === 0 ? '✅' : '🐞', 'quem respondeu SAIR não recebe a próxima campanha', `${aposSair.length} mensagem(ns) na 2ª campanha`)
  await fetch(`${BASE}/api/whatsapp/webhook/${seg}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    event: 'messages.upsert', instance: 'camp-sim-a', sender: '5511900000000@s.whatsapp.net',
    data: { key: { remoteJid: '5511912340101@s.whatsapp.net', fromMe: false, id: `QAVOLTAR${Date.now()}` }, message: { conversation: 'Voltar' }, messageTimestamp: Math.floor(Date.now() / 1000) },
  }) })
  limparSimulado()
  await criar({ nome: 'QA 3' })
  await cronAteVazio()
  const aposVoltar = enviados().filter((e) => e.resultado === 'ok' && e.numero === '5511912340101')
  linha(aposVoltar.length === 1 ? '✅' : '🐞', 'VOLTAR: volta a receber', `${aposVoltar.length} mensagem(ns) na 3ª campanha`)

  secao('4. Campanha sem destinatários')
  await reset()
  const r4 = await criar({ filtro: { tipo: 'valor_minimo', valor_minimo: 99999 } })
  await cron()
  const st4 = r4.j?.id ? await um(`select status, total_destinatarios from campanhas where id=$1`, [r4.j.id]) : null
  linha(st4?.status === 'agendada' ? '🐞' : '✅', 'campanha sem ninguém não fica "agendada" para sempre', st4 ? `status=${st4.status} total=${st4.total_destinatarios}` : `recusada: ${r4.s} ${r4.j?.error}`)

  secao('5. WhatsApp desconectado durante a campanha')
  await reset()
  for (let i = 0; i < 4; i++) await cliente(A, `55119123402${String(i).padStart(2, '0')}`, `D${i}`)
  const c5 = (await criar({})).j
  controle({ desconectado: true }) // Evolution responde "Connection Closed" com a instância fechada
  await cronAteVazio(3)
  const st5 = await q(`select status, count(*)::int n, sum(tentativas)::int t from campanha_envios where campanha_id=$1 group by 1`, [c5.id])
  const camp5 = await um(`select status, pausa_motivo, total_erros from campanhas where id=$1`, [c5.id])
  linha(camp5.status === 'pausada' && st5.every((r) => r.status === 'pendente') && camp5.total_erros === 0 ? '✅' : '🐞', 'desconectado: campanha PAUSA e os contatos ficam na fila (nada queimado)', `${camp5.status}/${camp5.pausa_motivo} ${JSON.stringify(st5)}`)
  // Reconecta.
  controle({})
  await cronAteVazio()
  const st5b = await q(`select status, count(*)::int n from campanha_envios where campanha_id=$1 group by 1`, [c5.id])
  const camp5b = await um(`select status, total_enviados from campanhas where id=$1`, [c5.id])
  linha(camp5b.status === 'concluida' && camp5b.total_enviados === 4 ? '✅' : '🐞', 'ao reconectar a campanha retoma sozinha e todos recebem uma vez', `${camp5b.status} ${JSON.stringify(st5b)}`)
  controle({})

  secao('6. Fila é global: campanha grande de uma loja segura a de outra')
  await reset()
  for (let i = 0; i < 12; i++) await cliente(A, `55119123403${String(i).padStart(2, '0')}`, `A${i}`)
  await criar({})
  // Loja B cria a campanha dela logo depois (direto no banco, mesmo formato da API).
  const cb = (await um(`insert into campanhas (restaurante_id, nome, status, mensagem, agendado_em, filtro) values ($1,'B urgente','agendada','Oi B', now(), '{"tipo":"todos"}') returning id`, [B])).id
  await db.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente) values ($1,$2,'5511912340499','B1')`, [cb, B])
  const r6 = await cron()
  const saiuB = enviados().some((e) => e.numero === '5511912340499')
  linha(saiuB ? '✅' : '🐞', 'a campanha da B sai na primeira rodada (lote de 5 dividido entre lojas)', `rodada 1: ${r6.j?.processados} envios, B ${saiuB ? 'saiu' : 'esperando'}`)
  await cronAteVazio()

  secao('7. Excluir campanha no meio do envio')
  await reset()
  for (let i = 0; i < 8; i++) await cliente(A, `55119123405${String(i).padStart(2, '0')}`, `E${i}`)
  const c7 = (await criar({})).j
  await cron() // 5 saem
  const antes7 = enviados().filter((e) => e.resultado === 'ok').length
  const del = await api(`/api/admin/campanhas/${c7.id}`, 'DELETE')
  const sobrou = await um(`select count(*)::int n from campanha_envios where campanha_id=$1`, [c7.id])
  linha(del.s === 200 && sobrou.n === 0 ? '🐞' : '✅', 'campanha que já começou a sair não é apagada (histórico e métricas)', `DELETE ${del.s}; ${antes7} já tinham saído; envios restantes no banco: ${sobrou.n}`)
  await cronAteVazio()

  secao('8. Reinício do servidor no meio do disparo (trava vencida)')
  await reset()
  for (let i = 0; i < 3; i++) await cliente(A, `55119123406${String(i).padStart(2, '0')}`, `R${i}`)
  const c8 = (await criar({})).j
  // Simula o processo caindo depois de reservar: reserva e não conclui.
  await db.query(`update campanha_envios set status='reservado', travado_ate=now() - interval '1 minute', tentativas=1 where campanha_id=$1 and telefone like '%0600'`, [c8.id])
  await cronAteVazio()
  const st8 = await q(`select right(telefone,4) t, status from campanha_envios where campanha_id=$1 order by 1`, [c8.id])
  const reenviou = enviados().filter((e) => e.numero?.endsWith('0600')).length
  linha(reenviou === 0 && st8.find((r) => r.t === '0600')?.status === 'incerto' ? '✅' : '🐞', 'o que estava em envio na queda vira "incerto" e NÃO é reenviado; o resto sai', JSON.stringify(st8))

  secao('9. Resposta do cliente: conversa da central (número sem o 9º dígito)')
  await reset()
  await cliente(A, '5531912340701', 'BH')
  await criar({})
  await cronAteVazio()
  // O WhatsApp informa este número SEM o 9 (formato do JID de muitos números).
  await fetch(`${BASE}/api/whatsapp/webhook/${seg}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    event: 'messages.upsert', instance: 'camp-sim-a', sender: '5511900000000@s.whatsapp.net',
    data: { key: { remoteJid: '553112340701@s.whatsapp.net', fromMe: false, id: `QA9${Date.now()}` }, message: { conversation: 'Quero pedir' }, messageTimestamp: Math.floor(Date.now() / 1000) },
  }) })
  const conv = await q(`select telefone, (select count(*)::int from whatsapp_mensagens m where m.conversa_id=c.id) n from whatsapp_conversas c where restaurante_id=$1 order by telefone`, [A])
  linha(conv.length === 1 ? '✅' : '🐞', 'disparo e resposta ficam na MESMA conversa da central', JSON.stringify(conv))
} catch (e) {
  console.error('\n❌ exceção:', e)
} finally {
  await reset()
  await browser.close()
  await db.end()
}
