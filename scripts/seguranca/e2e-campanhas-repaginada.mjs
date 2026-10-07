/**
 * E2E — Campanhas repaginadas (2026-10-01). Provedor SIMULADO, lojas isoladas camp-e2e-*,
 * telefones fictícios (11 91234-01xx). Nada sai para fora.
 *   · cabeçalho (título, Boas práticas, Disparar mensagem, envio automático ligado/desligado);
 *   · submenu com as 6 seções (trilho rolável no celular);
 *   · Visão geral: vazio, números com atribuição de 72 h (recorrente/recuperado/tempo),
 *     leitura e clique "Indisponível" até existirem, gráfico, tabela com ordem e paginação;
 *   · Campanhas: busca, filtro de status, paginação, selos;
 *   · Agendamentos: contadores clicáveis, + Filtro, resultado do envio, duplicar, destinatários, excluir;
 *   · disparo pela tela até o provedor simulado (cron);
 *   · Mensagens automáticas: padrão idêntico, texto próprio, variável inválida, desligar etapa,
 *     tipo e geral, restaurar padrão — conferido no que o provedor simulado "enviou";
 *   · Modelos: criar, validar, usar, salvar do disparo, excluir;
 *   · desktop, tablet e celular.
 *
 *   CAMP_E2E_LOJA=camp-e2e-a CAMP_E2E_VIZINHA=camp-e2e-b CAMP_PROVEDOR=simulado \
 *   WHATSAPP_SIMULADO_ARQUIVO=<o do servidor> CRON_SECRET=… node scripts/seguranca/e2e-campanhas-repaginada.mjs [prints]
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const LOJA = process.env.CAMP_E2E_LOJA
const VIZ = process.env.CAMP_E2E_VIZINHA
const ARQ = process.env.WHATSAPP_SIMULADO_ARQUIVO
if (!LOJA || !VIZ || !LOJA.startsWith('camp-e2e') || !VIZ.startsWith('camp-e2e') || LOJA === VIZ
  || process.env.CAMP_PROVEDOR !== 'simulado' || !ARQ || !process.env.CRON_SECRET) {
  console.error('Trava: CAMP_E2E_LOJA/CAMP_E2E_VIZINHA (camp-e2e-*), CAMP_PROVEDOR=simulado, WHATSAPP_SIMULADO_ARQUIVO e CRON_SECRET. Nada foi escrito.')
  process.exit(2)
}
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)

const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
const foto = async (p, nome, full = false) => { if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`), fullPage: full }) }

// ── semente ──────────────────────────────────────────────────────────────────
async function loja(slug, nome, instancia) {
  const id = (await um(`insert into restaurantes (nome, slug, status_loja) values ($1,$2,'aberto_manual')
    on conflict (slug) do update set nome=excluded.nome returning id`, [nome, slug])).id
  await db.query(`update restaurantes set evolution_instance=$2, mensagens_status=null where id=$1`, [id, instancia])
  await db.query(`delete from campanhas where restaurante_id=$1`, [id])
  await db.query(`delete from campanha_modelos where restaurante_id=$1`, [id])
  for (const t of ['whatsapp_eventos', 'whatsapp_envios', 'whatsapp_mensagens', 'whatsapp_conversas', 'whatsapp_robo_config', 'clientes']) await db.query(`delete from ${t} where restaurante_id=$1`, [id])
  await db.query(`delete from pedido_itens where pedido_id in (select id from pedidos where restaurante_id=$1)`, [id])
  await db.query(`delete from pedidos where restaurante_id=$1`, [id])
  await db.query(`insert into whatsapp_robo_config (restaurante_id, robo_ativo) values ($1, false)`, [id])
  return id
}
async function usuario(email, login, papel, restaurante) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  let uid = data?.user?.id
  if (!uid) {
    const { data: l } = await admin.auth.admin.listUsers({ perPage: 1000 })
    uid = l.users.find((u) => u.email === email).id
    await admin.auth.admin.updateUserById(uid, { password: SENHA })
  }
  await db.query(`insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,$3::papel_usuario,$4,$5,$6,true)
    on conflict (id) do update set restaurante_id=excluded.restaurante_id, papel=excluded.papel, autorizado=true, desativado_em=null, situacao=null, acessos=null, usuario=excluded.usuario`,
  [uid, restaurante, papel, login, email, login])
}
const A = await loja(LOJA, 'Lanchonete Campanha A', 'camp-sim-a')
await loja(VIZ, 'Lanchonete Campanha B', 'camp-sim-b')
await usuario('dono@camp-a.local', 'dono.campa', 'dono', A)
await usuario('garcom@camp-a.local', 'garcom.campa', 'garcom', A)
const C = { c1: '5511912340101', c2: '5511912340102', c3: '5511912340103', c4: '5511912340104' }
for (const [n, t] of Object.entries(C)) await db.query(`insert into clientes (restaurante_id, telefone, nome) values ($1,$2,$3)`, [A, t, `Cliente ${n.toUpperCase()}`])

const H = 3600e3
const agora = Date.now()
const iso = (ms) => new Date(ms).toISOString()
async function pedido(tel, quando, total, { tipo = 'retirada', status = 'entregue', nome = 'Cliente Teste' } = {}) {
  return um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, criado_em)
    values ($1,$2,$3,$4,$4,$5,$6,'pix',$7) returning id, numero`, [A, tipo, status, total, nome, tel, iso(quando)])
}
async function campanha(nome, { status = 'concluida', quando = agora - 48 * H, link = true, tipo = 'texto', envios = [] } = {}) {
  const c = await um(`insert into campanhas (restaurante_id, nome, status, tipo_mensagem, mensagem, filtro, agendado_em, total_destinatarios, total_enviados, total_erros, incluir_link, criado_em)
    values ($1,$2,$3,$4,$5,'{"tipo":"todos"}',$6,$7,$8,$9,$10,$11) returning id`,
  [A, nome, status, tipo, `Oi {nome}! ${nome}`, iso(quando), envios.length, envios.filter((e) => e.status === 'enviado').length, envios.filter((e) => e.status !== 'enviado').length, link, iso(quando - 2 * H)])
  for (const e of envios) {
    await db.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente, status, enviado_em, id_externo, criado_em)
      values ($1,$2,$3,'Cliente',$4,$5,$6,$7)`, [c.id, A, e.tel, e.status, e.status === 'enviado' ? iso(quando) : null, e.status === 'enviado' ? `SIM${Math.random().toString(36).slice(2)}` : null, iso(quando)])
  }
  return c.id
}
// Campanha principal: 3 envios há 48 h.
const K1 = await campanha('TESTE Promo sexta', { envios: [{ tel: C.c1, status: 'enviado' }, { tel: C.c2, status: 'enviado' }, { tel: C.c3, status: 'enviado' }] })
const env1 = agora - 48 * H
await pedido(C.c1, env1 - 10 * 24 * H, 30)  // c1 já pedia (10 dias antes) → recorrente
await pedido(C.c2, env1 - 60 * 24 * H, 30)  // c2 sumido há 60 dias → recuperado
await pedido(C.c1, env1 + 30 * H, 80)       // 30 h depois: conta em 72 h (não contaria em 12 h)
await pedido(C.c2, env1 + 2 * H, 40)        // 2 h depois
await pedido(C.c3, env1 + 80 * H, 99)       // 80 h depois: fora da janela
// Mais 11 para a paginação, com situações variadas.
for (let i = 2; i <= 11; i++) await campanha(`TESTE Lote ${String(i).padStart(2, '0')}`, { quando: agora - (50 + i) * H, envios: [{ tel: C.c4, status: i % 3 === 0 ? 'erro' : 'enviado' }] })
await campanha('TESTE Agendada futura', { status: 'agendada', quando: agora + 26 * H })
await campanha('TESTE Cancelada', { status: 'cancelada', quando: agora - 70 * H })
await campanha('TESTE Imagem', { tipo: 'imagem', quando: agora - 72 * H, envios: [{ tel: C.c4, status: 'enviado' }] })

const enviados = () => (existsSync(ARQ) ? readFileSync(ARQ, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const cron = () => fetch(`${BASE}/api/cron/campanhas`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } }).then((r) => r.status)

const browser = await chromium.launch()
async function logar(login, viewport = { width: 1366, height: 860 }) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  const b = p.getByRole('button', { name: /OK, entendi/ }).first()
  await b.waitFor({ timeout: 3000 }).catch(() => {})
  if (await b.isVisible().catch(() => false)) await b.click()
  return { ctx, p }
}
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  return { s: r.status, j: await r.json().catch(() => null) }
}, { url: `${BASE}${url}`, metodo, corpo })
const valor = async (p, id) => (await p.getByTestId(id).locator('[data-valor]').innerText()).trim()
const secaoAba = async (p, rotulo) => { await p.getByRole('navigation', { name: 'Seções de campanhas' }).getByRole('button', { name: rotulo }).click(); await espera(400) }
const AJUSTES = { 'Mensagens automáticas': 'mensagens', 'Modelos de mensagem': 'modelos', 'Notificações do app': 'notificacoes' }
const secaoAjustes = async (p, rotulo) => { await p.goto(`${BASE}/admin/ajustes?aba=${AJUSTES[rotulo]}`, { waitUntil: 'networkidle' }); await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 1500 }).catch(() => {}); await espera(1200) }

try {
  const { p, ctx } = await logar('dono.campa')
  await p.goto(`${BASE}/admin/campanhas`, { waitUntil: 'networkidle' })
  await p.getByTestId('m-receita').locator('[data-valor]').filter({ hasNotText: '—' }).waitFor({ timeout: 15000 }).catch(() => {})

  secao('1. Cabeçalho e submenu')
  ok('título "Campanhas via WhatsApp"', (await p.getByRole('heading', { name: 'Campanhas via WhatsApp' }).count()) === 1 || (await p.getByText('Campanhas via WhatsApp').count()) > 0)
  const itens = await p.getByRole('navigation', { name: 'Seções de campanhas' }).getByRole('button').allInnerTexts()
  ok('submenu só com o disparo: Visão geral, Campanhas e Agendamentos', JSON.stringify(itens.map((t) => t.trim())) === JSON.stringify(['Visão geral', 'Campanhas', 'Agendamentos']), itens.join(' | '))
  // Noite 5: o botão "Envio automático" saiu — os avisos de status saem sempre que o WhatsApp está conectado.
  ok('sem o botão "Envio automático" em Campanhas', (await p.getByTestId('status-automatico').count()) === 0)
  await p.getByTestId('abrir-boas-praticas').click()
  ok('"Boas práticas" abre o painel', await p.getByTestId('boas-praticas').isVisible())
  await foto(p, '10-boas-praticas')
  await p.keyboard.press('Escape')
  ok('Esc fecha as boas práticas', (await p.getByTestId('boas-praticas').count()) === 0)

  secao('2. Visão geral (atribuição de 72 h)')
  await foto(p, '11-visao-geral-desktop', true)
  ok('receita = R$ 120,00 (80 em 30 h + 40 em 2 h; o de 80 h fica fora)', /120,00/.test(await valor(p, 'm-receita')), await valor(p, 'm-receita'))
  ok('2 pedidos atribuídos', (await valor(p, 'm-pedidos')) === '2', await valor(p, 'm-pedidos'))
  ok('4 contatos impactados (c1–c3 na principal + c4 nos lotes)', ['4'].includes(await valor(p, 'm-contatos')), await valor(p, 'm-contatos'))
  ok('1 pedido de cliente recorrente', (await valor(p, 'm-recorrentes')) === '1', await valor(p, 'm-recorrentes'))
  ok('1 pedido de cliente recuperado', (await valor(p, 'm-recuperados')) === '1', await valor(p, 'm-recuperados'))
  ok('tempo médio para pedir = 16 h ((30 + 2) / 2)', (await valor(p, 'm-tempo')) === '16 h', await valor(p, 'm-tempo'))
  ok('leitura "Indisponível" sem retorno do WhatsApp', /Indisponível/.test(await valor(p, 'm-leitura')))
  ok('envios com sucesso mostra "x de y" e %', /\d+ de \d+/.test(await valor(p, 'm-sucesso')), await valor(p, 'm-sucesso'))
  ok('gráfico por dia e por campanha aparecem', (await p.getByTestId('grafico-dias').count()) === 1 && (await p.getByTestId('grafico-campanhas').count()) === 1)
  const linhas1 = await p.getByTestId('linha-envio').count()
  ok('tabela de envios paginada (10 na primeira página)', linhas1 === 10, String(linhas1))
  ok('faixa "1–10 de 12"', /1–10 de 12/.test(await p.getByTestId('faixa').innerText()), await p.getByTestId('faixa').innerText())
  await p.getByTestId('pagina-proxima').click()
  ok('próxima página mostra o restante', (await p.getByTestId('linha-envio').count()) === 2)
  await p.getByTestId('ordenar-receita').click()
  const primeira = await p.getByTestId('linha-envio').first().innerText()
  ok('ordenar por receita (maior primeiro) traz a campanha principal', /TESTE Promo sexta/.test(primeira), primeira.slice(0, 60))
  await p.getByTestId('ver-detalhado').click()
  ok('relatório detalhado (métricas antigas) continua acessível', await p.getByText(/Entregues|Enviadas/).first().isVisible())
  await p.getByTestId('ver-detalhado').click()
  // Leitura e clique passam a existir quando o WhatsApp devolve.
  await db.query(`update campanha_envios set entregue_em=enviado_em + interval '1 minute', lido_em=enviado_em + interval '5 minutes' where campanha_id=$1 and telefone=$2`, [K1, C.c1])
  await db.query(`update campanha_envios set clicado_em=enviado_em + interval '3 minutes', cliques=1 where campanha_id=$1 and telefone=$2`, [K1, C.c2])
  await p.reload({ waitUntil: 'networkidle' })
  await p.getByTestId('m-leitura').locator('[data-valor]').filter({ hasText: '%' }).waitFor({ timeout: 10000 }).catch(() => {})
  ok('com retorno, leitura vira % de verdade', /%/.test(await valor(p, 'm-leitura')), await valor(p, 'm-leitura'))
  ok('taxa de cliques com o clique registrado', /%/.test(await valor(p, 'm-cliques')) && !/^0%$/.test(await valor(p, 'm-cliques')), await valor(p, 'm-cliques'))
  // Período vazio.
  await p.getByTestId('periodo-rotulo').click()
  await p.getByTestId('periodo-de').fill('2025-01-01')
  await p.getByTestId('periodo-ate').fill('2025-01-31')
  await p.getByTestId('vazio-envios').waitFor({ timeout: 10000 }).catch(() => {})
  ok('período sem envios: ilustração + "Nenhum envio neste período" + botão', (await p.getByTestId('vazio-envios').count()) === 1 && /Nenhum envio neste período/.test(await p.getByTestId('vazio-envios').innerText()))
  await foto(p, '12-visao-geral-vazia')
  await p.getByTestId('periodo-proximo').click()
  ok('setas ‹ › andam o período', /01\/02\/2025|02\/2025/.test(await p.getByTestId('periodo-rotulo').innerText()), await p.getByTestId('periodo-rotulo').innerText())

  secao('3. Campanhas: busca, filtro, paginação')
  await secaoAba(p, 'Campanhas')
  ok('lista paginada (10 de 14)', (await p.getByTestId('campanha-linha').count()) === 10 && /de 14/.test(await p.getByTestId('faixa').innerText()))
  await p.getByTestId('busca-campanha').fill('lote 0')
  ok('busca filtra pelo nome', (await p.getByTestId('campanha-linha').count()) === 8)
  await p.getByTestId('busca-campanha').fill('')
  await p.getByTestId('filtro-status').selectOption('cancelada')
  ok('filtro de status (Canceladas)', (await p.getByTestId('campanha-linha').count()) === 1 && (await p.getByTestId('campanha-linha').getByTestId('status-campanha').getAttribute('data-status')) === 'cancelada')
  await p.getByTestId('filtro-status').selectOption('todas')
  const selos = new Set(await p.locator('[data-testid="campanha-linha"] [data-testid="status-campanha"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-status'))))
  ok('selos coloridos por status (processada, com falha, agendada…)', selos.size >= 3, [...selos].join(','))
  await foto(p, '13-campanhas-lista')

  secao('4. Agendamentos')
  await secaoAba(p, 'Agendamentos')
  const n = async (g) => Number(await p.getByTestId(`contador-${g}`).locator('[data-n]').innerText())
  const banco = await um(`select count(*) filter (where status in ('agendada','enviando','pausada'))::int a, count(*) filter (where status='concluida')::int p, count(*) filter (where status='cancelada')::int c from campanhas where restaurante_id=$1 and agendado_em is not null`, [A])
  ok('contadores Ativas/Processadas/Canceladas batem com o banco', (await n('ativas')) === banco.a && (await n('processadas')) === banco.p && (await n('canceladas')) === banco.c, `${await n('ativas')}/${await n('processadas')}/${await n('canceladas')} vs ${banco.a}/${banco.p}/${banco.c}`)
  await p.getByTestId('contador-canceladas').click()
  ok('contador clicado filtra', (await p.getByTestId('agendamento-linha').count()) === banco.c)
  await p.getByTestId('contador-canceladas').click()
  await p.getByTestId('mais-filtro').click()
  await p.getByTestId('filtro-tipo').selectOption('imagem')
  ok('"+ Filtro" por tipo de mensagem', (await p.getByTestId('agendamento-linha').count()) === 1)
  await p.getByTestId('filtro-tipo').selectOption('')
  await p.getByRole('button', { name: 'Pronto' }).click()
  const linhaK1 = p.locator('[data-testid="agendamento-linha"][data-nome="TESTE Promo sexta"]')
  ok('"Enviada em" com resultado (Sucesso)', /Sucesso/.test(await linhaK1.getByTestId('resultado-envio').innerText()))
  ok('"Registros por página" na paginação', (await p.getByTestId('por-pagina').count()) === 1)
  const bx = await linhaK1.getByTestId('campanha-duplicar').boundingBox()
  ok('ações dos agendamentos à vista em 1366 px (sem rolar a tabela)', !!bx && bx.x + bx.width <= 1366, JSON.stringify(bx))
  await foto(p, '14-agendamentos')
  await linhaK1.getByTestId('campanha-destinatarios').click()
  await p.getByTestId('destinatarios').waitFor({ timeout: 10000 }).catch(() => {})
  ok('ver destinatários abre a lista', (await p.getByTestId('destinatarios').count()) === 1)
  await p.keyboard.press('Escape')
  await p.getByRole('button', { name: /Fechar|×/ }).last().click({ timeout: 2000 }).catch(() => {})
  await linhaK1.getByTestId('campanha-duplicar').click()
  const nomeCopia = await p.getByPlaceholder('Ex: Promoção de quinta-feira').inputValue()
  ok('duplicar abre o disparo com "(cópia)" e sem horário', /TESTE Promo sexta \(cópia\)/.test(nomeCopia), nomeCopia)
  await p.getByTestId('drawer-campanha').getByRole('button', { name: 'Cancelar', exact: true }).click()
  await espera(400)
  await p.getByTestId('busca-agendamento').fill('cancelada')
  const canc = p.locator('[data-testid="agendamento-linha"][data-nome="TESTE Cancelada"]')
  await canc.getByTestId('campanha-excluir').click()
  ok('excluir pede confirmação (sem confirm() do navegador)', (await p.getByTestId('confirmar').count()) === 1)
  await p.getByTestId('confirmar-ok').click()
  await espera(1500)
  ok('excluída sai da lista e do banco', (await canc.count()) === 0 && !(await um(`select 1 from campanhas where restaurante_id=$1 and nome='TESTE Cancelada'`, [A])))

  secao('5. Disparo pela tela até o provedor simulado')
  const antes = enviados().length
  await p.getByTestId('disparar-mensagem').click()
  await p.getByPlaceholder('Ex: Promoção de quinta-feira').fill('TESTE Disparo tela')
  await p.locator('textarea').first().fill('Oi {nome}, hoje tem TESTE!')
  await p.getByRole('button', { name: 'Disparar agora' }).click()
  await espera(1500)
  for (let i = 0; i < 6 && enviados().length - antes < 4; i++) { await cron(); await espera(800) }
  const novos = enviados().slice(antes)
  ok('disparo saiu pelo provedor simulado para os 4 clientes fictícios', novos.length === 4 && novos.every((m) => /^55119123401/.test(m.numero) && /hoje tem TESTE/.test(m.texto)), `${novos.length} ${novos.map((m) => m.numero).join(',')}`)

  secao('6. Mensagens automáticas (o que sai de verdade)')
  await secaoAjustes(p, 'Mensagens automáticas')
  ok('um cartão por etapa (7)', (await p.locator('[data-testid^="etapa-"]').count()) === 7)
  ok('todas "Ativo" e "Mensagem padrão" sem configuração', (await p.locator('[data-testid^="etapa-"][data-ativo="sim"]').count()) === 7 && (await p.getByTestId('selo-padrao').count()) === 6)
  ok('variáveis destacadas no texto', (await p.getByTestId('etapa-recebido').locator('[data-variavel]').count()) >= 1)
  ok('resumo do pedido aceito não é personalizável', /não permite personalização/.test(await p.getByTestId('etapa-aceito').innerText()))
  await foto(p, '15-mensagens-automaticas', true)
  const notificar = async (status, opts) => {
    const ped = await pedido(C.c4, Date.now(), 55, opts)
    const antes2 = enviados().length
    const r = await api(p, `/api/pedidos/${ped.id}/notificar`, 'POST', { status })
    await espera(600)
    return { ped, r, msg: enviados().slice(antes2).at(-1) ?? null }
  }
  let n1 = await notificar('recebido')
  ok('sem configuração sai o texto padrão de sempre', n1.msg?.texto === `📥 Recebemos seu pedido *#${n1.ped.numero}*! Aguarde a confirmação da loja 🙌`, n1.msg?.texto)
  await p.getByTestId('etapa-recebido').getByTestId('editar-etapa').click()
  await p.getByTestId('editor-texto').fill('Oi {cliente}')
  ok('variável desconhecida é recusada na hora', /desconhecida/.test(await p.getByTestId('erro-texto').innerText()) && await p.getByTestId('salvar-texto').isDisabled())
  await p.getByTestId('editor-texto').fill('Oi ')
  await p.getByTestId('editor-texto').press('End')
  await p.getByTestId('var-nome').click()
  await espera(200)
  ok('chip de variável insere no texto', (await p.getByTestId('editor-texto').inputValue()) === 'Oi {nome}', await p.getByTestId('editor-texto').inputValue())
  await p.getByTestId('editor-texto').fill('Oi {nome}, seu pedido #{numero} chegou na {loja}')
  await foto(p, '16-editor-mensagem')
  await p.getByTestId('salvar-texto').click()
  await espera(800)
  ok('salvo: selo "Personalizada"', (await p.getByTestId('etapa-recebido').getByTestId('selo-personalizada').count()) === 1)
  n1 = await notificar('recebido')
  ok('cliente recebe o texto da loja com as variáveis', n1.msg?.texto === `Oi Cliente, seu pedido #${n1.ped.numero} chegou na Lanchonete Campanha A`, n1.msg?.texto)
  await p.getByTestId('etapa-recebido').getByRole('switch').click()
  await espera(800)
  n1 = await notificar('recebido')
  ok('etapa desligada não envia', n1.msg === null, JSON.stringify(n1.msg))
  ok('etapa desligada mostra "Inativo"', (await p.getByTestId('etapa-recebido').getAttribute('data-ativo')) === 'nao')
  await p.getByTestId('etapa-recebido').getByRole('switch').click()
  await espera(600)
  await p.getByTestId('etapa-recebido').getByTestId('editar-etapa').click()
  await p.getByTestId('restaurar-padrao').click()
  await p.getByTestId('salvar-texto').click()
  await espera(800)
  n1 = await notificar('recebido')
  ok('"Restaurar padrão" volta exatamente ao texto padrão', n1.msg?.texto === `📥 Recebemos seu pedido *#${n1.ped.numero}*! Aguarde a confirmação da loja 🙌`, n1.msg?.texto)
  await p.getByTestId('tipo-retirada').uncheck()
  await espera(800)
  n1 = await notificar('recebido')
  const n2 = await notificar('recebido', { tipo: 'entrega' })
  ok('tipo Retirada desligado: retirada não recebe, entrega recebe', n1.msg === null && !!n2.msg, `${JSON.stringify(n1.msg)} / ${!!n2.msg}`)
  await p.getByTestId('tipo-retirada').check()
  await espera(600)
  ok('sem a chave geral "Envio automático" em Mensagens automáticas', (await p.getByTestId('mensagens-automaticas').getByRole('switch', { name: 'Envio automático' }).count()) === 0)
  // Loja que já tinha desligado (antes da noite 5) continua sem envio e vê o aviso — só o suporte religa.
  await db.query(`update restaurantes set mensagens_status = coalesce(mensagens_status, '{}'::jsonb) || '{"ativo": false}'::jsonb where id=$1`, [A])
  n1 = await notificar('recebido', { tipo: 'entrega' })
  ok('loja com envio desligado salvo: nada sai (comportamento mantido)', n1.msg === null)
  await p.reload({ waitUntil: 'networkidle' }); await espera(1200)
  ok('aviso "Envio pausado nesta loja" para quem tinha desligado', await p.getByTestId('envio-pausado-suporte').isVisible())
  await db.query(`update restaurantes set mensagens_status = mensagens_status - 'ativo' where id=$1`, [A])
  const aud = await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao='campanhas.mensagens_automaticas'`, [A])
  ok('auditoria registra cada mudança', aud.n >= 3, String(aud.n))
  const r403 = await api(p, '/api/admin/campanhas/automaticas', 'PUT', { config: { etapas: { recebido: { texto: 'x {senha}' } } } })
  ok('servidor recusa variável desconhecida também', r403.s === 400, String(r403.s))

  secao('7. Modelos de mensagem')
  await secaoAjustes(p, 'Modelos de mensagem')
  ok('vazio com ilustração', (await p.getByTestId('modelos-vazio').count()) === 1)
  await p.getByTestId('novo-modelo').click()
  await p.getByTestId('modelo-nome').fill('TESTE Modelo fim de semana')
  await p.getByTestId('modelo-mensagem').fill('Oi {cliente}')
  await p.getByTestId('modelo-salvar').click()
  ok('modelo com variável inválida é recusado', /desconhecida|inválid|não existe|Variável/i.test(await p.getByTestId('modelo-erro').innerText()), await p.getByTestId('modelo-erro').innerText())
  await p.getByTestId('modelo-mensagem').fill('Oi {nome}! Fim de semana com 10% off. Peça: {link}')
  await p.getByTestId('modelo-salvar').click()
  await p.getByTestId('modelo-cartao').first().waitFor({ timeout: 8000 }).catch(() => {})
  ok('modelo criado aparece como cartão', (await p.getByTestId('modelo-cartao').count()) === 1)
  await foto(p, '17-modelos')
  await p.getByTestId('modelo-usar').click()
  await p.waitForURL((u) => u.pathname === '/admin/campanhas', { timeout: 15000 })
  await p.getByTestId('drawer-campanha').waitFor({ timeout: 15000 })
  const txtModelo = await p.waitForFunction(() => [...document.querySelectorAll('[data-testid=drawer-campanha] textarea')].some((t) => t.value.includes('Fim de semana com 10% off')), null, { timeout: 15000 }).then(() => true, () => false)
  ok('"Usar modelo" (Ajustes) abre o disparo em Campanhas com o texto', txtModelo)
  await p.getByTestId('salvar-como-modelo').click()
  await espera(1000)
  await p.getByTestId('drawer-campanha').getByRole('button', { name: 'Cancelar', exact: true }).click()
  await espera(500)
  await secaoAjustes(p, 'Modelos de mensagem')
  ok('"Salvar como modelo" do disparo cria outro modelo', (await p.getByTestId('modelo-cartao').count()) === 2)
  await p.getByTestId('modelo-excluir').first().click()
  await p.getByTestId('confirmar-ok').click()
  await espera(1000)
  ok('excluir modelo', (await p.getByTestId('modelo-cartao').count()) === 1)

  secao('8. Notificações do app e permissões')
  await secaoAjustes(p, 'Notificações do app')
  ok('seção de notificações do app abre (Ajustes)', (await p.getByTestId('ajustes-notificacoes').count()) === 1)
  const g = await logar('garcom.campa')
  await g.p.goto(`${BASE}/admin/campanhas`, { waitUntil: 'networkidle' })
  ok('garçom não entra em Campanhas', !g.p.url().endsWith('/admin/campanhas'), g.p.url())
  const ga = await api(g.p, '/api/admin/campanhas/automaticas')
  ok('garçom não lê as mensagens automáticas (API)', ga.s === 403 || ga.s === 401, String(ga.s))
  const gv = await api(g.p, '/api/admin/campanhas/visao-geral')
  ok('garçom não lê a visão geral (API)', gv.s === 403 || gv.s === 401, String(gv.s))
  await g.ctx.close()
  await ctx.close()

  secao('9. Tablet e celular')
  for (const [nome, vp] of [['tablet', { width: 820, height: 1180 }], ['celular', { width: 390, height: 844 }]]) {
    const s = await logar('dono.campa', vp)
    await s.p.goto(`${BASE}/admin/campanhas`, { waitUntil: 'networkidle' })
    await espera(800)
    const sobra = await s.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(`${nome}: sem rolagem lateral na página`, sobra <= 1, String(sobra))
    const nav = s.p.getByRole('navigation', { name: 'Seções de campanhas' })
    const box = await nav.boundingBox()
    ok(`${nome}: submenu vira trilho horizontal`, !!box && box.width > box.height, JSON.stringify(box))
    await foto(s.p, `18-visao-${nome}`)
    await secaoAba(s.p, 'Agendamentos')
    await foto(s.p, `19-agendamentos-${nome}`)
    await secaoAjustes(s.p, 'Mensagens automáticas')
    const sobra2 = await s.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(`${nome}: mensagens automáticas sem rolagem lateral`, sobra2 <= 1, String(sobra2))
    await foto(s.p, `20-automaticas-${nome}`)
    await s.ctx.close()
  }
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await db.query(`update restaurantes set mensagens_status=null where id=$1`, [A])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
