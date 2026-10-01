/**
 * E2E das notificações push do app do cardápio (0127, 2026-10-01). Stack LOCAL, servidor com
 * PUSH_PROVEDOR=simulado (cada envio vira uma linha em PUSH_SIMULADO_ARQUIVO; endpoint com
 * "expirada" responde 410) e chaves VAPID locais. Lojas isoladas ordem-qr-e2e (A) e
 * ordem-qr-vizinha (B). Apaga tudo o que cria e devolve as lojas como estavam.
 *
 *   PUSH_SIMULADO_ARQUIVO=<mesmo do servidor> CRON_SECRET=<mesmo do servidor> node scripts/seguranca/e2e-push.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
import { LOJA, SENHA, USUARIOS, VIZINHA } from './semear-cardapio-ordem.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SIM = process.env.PUSH_SIMULADO_ARQUIVO
const CRON = process.env.CRON_SECRET
if (!SIM || !CRON) { console.error('Defina PUSH_SIMULADO_ARQUIVO e CRON_SECRET (os mesmos do servidor).'); process.exit(1) }
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d !== '' && d !== undefined && d !== null ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const DIA = 24 * 3600_000

const A = await um(`select id, nome, status_loja, frete_gratis_acima, push_liberado from restaurantes where slug=$1`, [LOJA])
const B = await um(`select id, nome, push_liberado from restaurantes where slug=$1`, [VIZINHA])
const ITEM = await um(`select id, nome from itens_cardapio where restaurante_id=$1 and nome ilike 'Coca Lata%' limit 1`, [A.id])
const TEL = (n) => `55279998770${String(n).padStart(2, '0')}`
const TELS = Array.from({ length: 12 }, (_, i) => TEL(i + 1))
const criados = { cupons: [], itens: [], campanhas: [] }

async function limparPush() {
  for (const id of [A.id, B.id]) {
    await db.query(`delete from push_envios where restaurante_id=$1`, [id])
    await db.query(`delete from push_avulsas where restaurante_id=$1`, [id])
    await db.query(`delete from push_assinaturas where restaurante_id=$1`, [id])
    await db.query(`delete from push_automacoes where restaurante_id=$1`, [id])
    await db.query(`delete from push_config where restaurante_id=$1`, [id])
  }
}
async function limparPedidos() {
  const ids = (await q(`select id from pedidos where restaurante_id=$1 and (cliente_telefone = any($2) or cliente_telefone = any($3))`, [A.id, TELS, TELS.map((t) => t.slice(2))])).map((r) => r.id)
  if (ids.length) {
    await db.query(`delete from pedido_itens where pedido_id = any($1)`, [ids])
    await db.query(`delete from pedidos where id = any($1)`, [ids])
  }
}

const enviarPedido = (tel, extra = {}) => fetch(`${BASE}/api/loja/${LOJA}/pedido`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tipo: 'retirada', cliente: { nome: `TESTE Push ${tel.slice(-2)}`, telefone: tel },
    endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' }, pagamento: 'dinheiro', trocoPara: null,
    itens: [{ itemId: ITEM.id, quantidade: 1, observacao: '', complementos: [] }], chavePedido: randomUUID(), ...extra,
  }),
}).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))

const sub = (nome) => ({ endpoint: `https://push.teste.local/${nome}/${randomUUID()}`, keys: { p256dh: `B${'x'.repeat(86)}`, auth: 'y'.repeat(22) } })
const assinar = (slug, corpo, metodo = 'POST') => fetch(`${BASE}/api/loja/${slug}/push/assinar`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  .then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))
const cron = () => fetch(`${BASE}/api/cron/push?forcar=1`, { method: 'POST', headers: { 'x-cron-secret': CRON } }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))
const sim = () => (existsSync(SIM) ? readFileSync(SIM, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const doEndpoint = (ep) => sim().filter((l) => l.endpoint === ep)
const enviosDe = (ep, extra = '') => q(`select e.* from push_envios e join push_assinaturas a on a.id=e.assinatura_id where a.endpoint=$1 ${extra} order by e.criado_em`, [ep])

// ── navegador (dono da loja A, para as rotas do painel) ─────────────────────
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' })
const painel = await ctx.newPage()
const api = (url, metodo = 'GET', corpo) => painel.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  return { s: r.status, j: await r.json().catch(() => null) }
}, { url: `${BASE}${url}`, metodo, corpo })
const soLigar = async (tipos) => {
  for (const tipo of ['loja_abriu', 'recompra', 'inativo', 'item_novo', 'cupom_novo', 'frete_gratis', 'fidelidade']) {
    const textos = { loja_abriu: 'Abrimos! Hoje tem {desconto}', recompra: 'Bateu a fome, {nome}? Peça de novo seu {produto}.', inativo: 'Sentimos sua falta, {nome}!', item_novo: 'Novidade: {produto}', cupom_novo: 'Cupom {cupom}: {desconto}', frete_gratis: 'Frete grátis {desconto}!', fidelidade: 'Faltam {faltam} para o seu prêmio, {nome}!' }
    const r = await api('/api/admin/campanhas/push/automacoes', 'PUT', { tipo, ativo: tipos.includes(tipo), titulo: '{loja}', texto: textos[tipo], params: tipo === 'recompra' ? { dias: 3 } : tipo === 'inativo' ? { dias: 6, repetir_dias: 14 } : {} })
    if (r.s !== 200) throw new Error(`automação ${tipo}: ${r.s} ${JSON.stringify(r.j)}`)
  }
}

try {
  await limparPush()
  await limparPedidos()
  writeFileSync(SIM, '')
  await db.query(`update restaurantes set push_liberado=true, status_loja='aberto_manual', frete_gratis_acima=null where id=$1`, [A.id])
  await db.query(`update restaurantes set push_liberado=false where id=$1`, [B.id])

  await painel.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await painel.fill('input[name="email"]', USUARIOS.dono)
  await painel.fill('input[name="password"]', SENHA)
  await Promise.all([painel.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }), painel.click('button[type="submit"]')])

  // ══════════════════════════════════════════════════════════════════════════
  secao('1. Flag por loja e chave pública')
  const cfgA = await fetch(`${BASE}/api/loja/${LOJA}/push/config`).then((r) => r.json())
  const cfgB = await fetch(`${BASE}/api/loja/${VIZINHA}/push/config`).then((r) => r.json())
  ok('loja com flag: ativo + chave pública VAPID', cfgA.ativo === true && /^[A-Za-z0-9_-]{80,}$/.test(cfgA.chavePublica ?? ''))
  ok('loja sem flag (padrão): ativo false, sem chave', cfgB.ativo === false && !cfgB.chavePublica)
  const flagPadrao = await um(`select column_default from information_schema.columns where table_name='restaurantes' and column_name='push_liberado'`)
  ok('flag nasce desligada em todas as lojas (default false)', flagPadrao?.column_default === 'false')

  // ══════════════════════════════════════════════════════════════════════════
  secao('2. Assinatura (vínculo só com prova)')
  const p1 = await enviarPedido(TEL(1))
  ok('pedido de teste criado', p1.s === 201, p1.s)
  const S1 = sub('s1')
  const a1 = await assinar(LOJA, { subscription: S1, plataforma: 'android', navegador: 'Chrome', instalado: true, pedidoId: p1.j.id })
  ok('assina com o pedido recém-feito → ligada ao telefone', a1.s === 200 && a1.j?.vinculado === true, a1.s)
  const row1 = await um(`select * from push_assinaturas where endpoint=$1`, [S1.endpoint])
  ok('consentimento registrado (data, aparelho, categorias)', row1?.cliente_telefone === TEL(1) && row1.plataforma === 'android' && row1.instalado && row1.categorias.length === 4 && row1.consentimento_em)
  const SANON = sub('anon')
  const aAnon = await assinar(LOJA, { subscription: SANON, plataforma: 'desktop', pedidoId: randomUUID() })
  ok('pedido que não existe nesta loja não liga telefone', aAnon.s === 200 && aAnon.j?.vinculado === false)
  ok('endpoint sem https é recusado', (await assinar(LOJA, { subscription: { ...sub('x'), endpoint: 'http://inseguro/x' } })).s === 400)
  ok('loja sem a flag recusa assinatura (403)', (await assinar(VIZINHA, { subscription: sub('b') })).s === 403)
  const again = await assinar(LOJA, { subscription: S1, plataforma: 'android' })
  ok('reassinar o mesmo aparelho sem prova não perde o vínculo', again.s === 200 && (await um(`select cliente_telefone from push_assinaturas where endpoint=$1`, [S1.endpoint])).cliente_telefone === TEL(1))
  ok('um aparelho = uma linha', Number((await um(`select count(*) n from push_assinaturas where endpoint=$1`, [S1.endpoint])).n) === 1)

  // ══════════════════════════════════════════════════════════════════════════
  secao('3. Status do pedido (transacional)')
  await db.query(`update pedidos set status='preparando' where id=$1`, [p1.j.id])
  const n1 = await api(`/api/pedidos/${p1.j.id}/notificar`, 'POST', { status: 'preparando' })
  await esperar(500)
  let linhas = doEndpoint(S1.endpoint)
  const pl = linhas.at(-1)?.payload
  ok('pedido aceito → push no aparelho do cliente', n1.s === 200 && linhas.length === 1 && /aceito/.test(pl?.body ?? ''), `${n1.s} ${pl?.body}`)
  ok('título = nome da loja; ícone e badge da loja', pl?.title === A.nome && pl?.icon?.startsWith(`/api/loja/${LOJA}/icone/192`) && pl?.badge?.startsWith(`/api/loja/${LOJA}/push/badge`))
  ok('link leva aos pedidos da loja, com a origem', /^\/loja\/ordem-qr-e2e\?aba=pedidos&push=[0-9a-f-]{36}$/.test(pl?.data?.url ?? ''), pl?.data?.url)
  ok('aparelho anônimo não recebe status de pedido alheio', doEndpoint(SANON.endpoint).length === 0)
  await db.query(`update pedidos set status='pronto' where id=$1`, [p1.j.id])
  await api(`/api/pedidos/${p1.j.id}/notificar`, 'POST', { status: 'pronto' })
  await esperar(500)
  ok('retirada pronta → "pronto para retirada"', /pronto para retirada/.test(doEndpoint(S1.endpoint).at(-1)?.payload?.body ?? ''))
  const envStatus = await enviosDe(S1.endpoint, `and e.origem='status'`)
  ok('envios de status gravados como enviados', envStatus.length === 2 && envStatus.every((e) => e.status === 'enviado'))

  // ══════════════════════════════════════════════════════════════════════════
  secao('4. Automações: dedup, limite, prioridade, categorias, janela')
  await soLigar(['cupom_novo'])
  const c1 = await um(`insert into cupons (restaurante_id, codigo, ativo, tipo, valor, publico) values ($1,'PUSHE2E1',true,'desconto_percentual',10,'todos') returning id`, [A.id])
  criados.cupons.push(c1.id)
  let cr = await cron()
  ok('cron responde e avalia a loja', cr.s === 200 && cr.j?.lojas?.some((l) => l.loja === LOJA && l.avaliada), JSON.stringify(cr.j?.lojas?.find((l) => l.loja === LOJA)))
  const cup1 = doEndpoint(S1.endpoint).filter((l) => /PUSHE2E1/.test(l.payload.body))
  ok('cupom novo → notificação com o código e o desconto', cup1.length === 1 && /10% de desconto/.test(cup1[0].payload.body), cup1[0]?.payload.body)
  ok('cupom público chega também ao aparelho anônimo', doEndpoint(SANON.endpoint).some((l) => /PUSHE2E1/.test(l.payload.body)))
  ok('link do cupom leva o código', /\?cupom=PUSHE2E1&push=/.test(cup1[0]?.payload.data.url ?? ''))
  await cron()
  ok('dedup: segunda avaliação não repete', doEndpoint(S1.endpoint).filter((l) => /PUSHE2E1/.test(l.payload.body)).length === 1)

  await soLigar(['cupom_novo', 'item_novo'])
  const novo = await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, status) select restaurante_id, grupo_id, 'TESTE Push Novidade', 19.9, 'disponivel' from itens_cardapio where id=$1 returning id`, [ITEM.id])
  criados.itens.push(novo.id)
  await cron()
  ok('limite de 1 por dia segura o item novo (S1 já recebeu o cupom hoje)', !doEndpoint(S1.endpoint).some((l) => /TESTE Push Novidade/.test(l.payload.body)))
  ok('limite a 3/dia pelo painel', (await api('/api/admin/campanhas/push/config', 'PUT', { limiteDia: 3, limiteSemana: 10, antecedenciaMin: 30, telefoneTeste: '' })).s === 200)
  ok('limite acima do teto é recusado', (await api('/api/admin/campanhas/push/config', 'PUT', { limiteDia: 9, limiteSemana: 10, antecedenciaMin: 30 })).s === 400)
  await cron()
  ok('com limite maior, o item novo sai', doEndpoint(S1.endpoint).some((l) => /TESTE Push Novidade/.test(l.payload.body)))

  // prioridade: aparelho novo com cupom E item novo valendo → só o cupom
  const p2 = await enviarPedido(TEL(2))
  const S2 = sub('s2')
  await assinar(LOJA, { subscription: S2, plataforma: 'ios', instalado: true, pedidoId: p2.j.id })
  await cron()
  const l2 = doEndpoint(S2.endpoint)
  ok('prioridade: com cupom e item novo, só o cupom sai', l2.length === 1 && /PUSHE2E1/.test(l2[0].payload.body), l2.map((l) => l.payload.body).join(' | '))
  // categorias: sem promoções, recebe o item novo (novidades)
  const p3 = await enviarPedido(TEL(3))
  const S3 = sub('s3')
  await assinar(LOJA, { subscription: S3, plataforma: 'android', pedidoId: p3.j.id })
  ok('cliente troca as categorias (sem promoções)', (await assinar(LOJA, { endpoint: S3.endpoint, categorias: ['pedido', 'novidades'] }, 'PATCH')).s === 200)
  await cron()
  const l3 = doEndpoint(S3.endpoint)
  ok('categoria desligada é respeitada: recebe novidade, não cupom', l3.length === 1 && /TESTE Push Novidade/.test(l3[0].payload.body), l3.map((l) => l.payload.body).join(' | '))

  // janela: loja fechada → nada de marketing
  await db.query(`update restaurantes set status_loja='fechado_manual' where id=$1`, [A.id])
  const c2 = await um(`insert into cupons (restaurante_id, codigo, ativo, tipo, valor, publico) values ($1,'PUSHE2E2',true,'desconto_valor',5,'todos') returning id`, [A.id])
  criados.cupons.push(c2.id)
  const SJ = sub('janela')
  await assinar(LOJA, { subscription: SJ, plataforma: 'desktop' })
  cr = await cron()
  ok('loja fechada: nenhum marketing sai ("fora da janela")', doEndpoint(SJ.endpoint).length === 0 && cr.j?.lojas?.find((l) => l.loja === LOJA)?.motivo === 'fora da janela', cr.j?.lojas?.find((l) => l.loja === LOJA)?.motivo)
  await db.query(`update restaurantes set status_loja='aberto_manual' where id=$1`, [A.id])
  await cron()
  ok('reaberta: o cupom novo sai', doEndpoint(SJ.endpoint).some((l) => /PUSHE2E2/.test(l.payload.body)))

  // ══════════════════════════════════════════════════════════════════════════
  secao('5. Assinatura expirada e isolamento entre lojas')
  const SX = { ...sub('x'), endpoint: `https://push.teste.local/expirada/${randomUUID()}` }
  await assinar(LOJA, { subscription: SX })
  await cron()
  ok('404/410 → assinatura marcada inválida', (await um(`select status from push_assinaturas where endpoint=$1`, [SX.endpoint])).status === 'invalida')
  ok('o envio também fica "invalida" e não é tentado de novo', (await enviosDe(SX.endpoint)).every((e) => e.status === 'invalida'))
  await db.query(`update restaurantes set push_liberado=true where id=$1`, [B.id])
  const SB = sub('vizinha')
  ok('loja B (liberada só para o teste) aceita assinatura dela', (await assinar(VIZINHA, { subscription: SB })).s === 200)
  const c3 = await um(`insert into cupons (restaurante_id, codigo, ativo, tipo, valor, publico) values ($1,'PUSHE2E3',true,'entrega_gratis',null,'todos') returning id`, [A.id])
  criados.cupons.push(c3.id)
  await cron()
  ok('isolamento: cupom da loja A não chega a assinante da loja B', doEndpoint(SB.endpoint).length === 0)
  ok('loja B sem automação ligada não envia nada', Number((await um(`select count(*) n from push_envios where restaurante_id=$1`, [B.id])).n) === 0)
  ok('todo envio da loja A tem ícone/link da loja A', sim().filter((l) => l.payload.data.loja).every((l) => l.payload.data.loja === LOJA && l.payload.data.url.startsWith(`/loja/${LOJA}`)))
  await db.query(`update restaurantes set push_liberado=false where id=$1`, [B.id])

  // ══════════════════════════════════════════════════════════════════════════
  secao('6. Recompra, inativo, fidelidade, frete grátis, loja abriu')
  // A loja de teste já tem produto em promoção: "loja abriu" (prioridade maior) venceria a recompra.
  // Cada regra é ligada sozinha para provar o gatilho dela.
  await soLigar(['recompra', 'inativo', 'fidelidade'])
  // recompra: 1 pedido há 3 dias
  const p4 = await enviarPedido(TEL(4))
  const S4 = sub('s4')
  await assinar(LOJA, { subscription: S4, pedidoId: p4.j.id })
  await db.query(`update pedidos set criado_em = now() - interval '3 days 1 hour' where id=$1`, [p4.j.id])
  // inativo: 2 pedidos, o último há 7 dias
  const p5a = await enviarPedido(TEL(5))
  const S5 = sub('s5')
  await assinar(LOJA, { subscription: S5, pedidoId: p5a.j.id })
  const p5b = await enviarPedido(TEL(5))
  await db.query(`update pedidos set criado_em = now() - interval '20 days' where id=$1`, [p5a.j.id])
  await db.query(`update pedidos set criado_em = now() - interval '7 days' where id=$1`, [p5b.j.id])
  // fidelidade: faltam 2
  const p6 = await enviarPedido(TEL(6))
  const S6 = sub('s6')
  await assinar(LOJA, { subscription: S6, pedidoId: p6.j.id })
  const camp = await um(`insert into campanhas_fidelidade (restaurante_id, nome, tipo_meta, meta_quantidade, premio_tipo, premio_valor) values ($1,'TESTE Push Fidelidade','qtd_pedidos',5,'desconto_valor',10) returning id`, [A.id])
  criados.campanhas.push(camp.id)
  await db.query(`insert into fidelidade_progresso (restaurante_id, campanha_id, cliente_telefone, progresso_qtd) values ($1,$2,$3,3)`, [A.id, camp.id, TEL(6)])
  await cron()
  ok('recompra: 1 pedido há 3 dias → "Peça de novo seu <produto>"', doEndpoint(S4.endpoint).some((l) => l.payload.body.includes('Peça de novo seu') && l.payload.body.includes(ITEM.nome)), doEndpoint(S4.endpoint).map((l) => l.payload.body).join(' | '))
  ok('{nome} vira o primeiro nome do cliente', doEndpoint(S4.endpoint).some((l) => /fome, TESTE\?/.test(l.payload.body)))
  ok('inativo: último pedido há 7 dias → "Sentimos sua falta"', doEndpoint(S5.endpoint).some((l) => /Sentimos sua falta/.test(l.payload.body)))
  ok('fidelidade: "Faltam 2 pedidos para o seu prêmio"', doEndpoint(S6.endpoint).some((l) => /Faltam 2 pedidos/.test(l.payload.body)), doEndpoint(S6.endpoint).map((l) => l.payload.body).join(' | '))
  // frete grátis ligado agora (o estado anterior já foi fotografado)
  await soLigar(['frete_gratis'])
  await cron() // fotografa o frete atual (sem frete grátis)
  const S7 = sub('s7')
  await assinar(LOJA, { subscription: S7 })
  await db.query(`update restaurantes set frete_gratis_acima=60 where id=$1`, [A.id])
  await cron()
  ok('frete grátis ligado → "Frete grátis acima de R$ 60,00"', doEndpoint(S7.endpoint).some((l) => /Frete grátis acima de R\$\s?60,00/.test(l.payload.body)), doEndpoint(S7.endpoint).map((l) => l.payload.body).join(' | '))
  // loja abriu com promoção: aparelho novo, frete desligado da disputa
  await soLigar(['loja_abriu'])
  await db.query(`update itens_cardapio set promocao_preco=4.5, promocao_inicio=null, promocao_fim=null where id=$1`, [novo.id])
  const S8 = sub('s8')
  await assinar(LOJA, { subscription: S8 })
  await cron()
  ok('loja aberta com promoção → "Abrimos! Hoje tem <produto> por R$"', doEndpoint(S8.endpoint).some((l) => /Abrimos! Hoje tem .+ por R\$/.test(l.payload.body)), doEndpoint(S8.endpoint).map((l) => l.payload.body).join(' | '))
  ok('promoção leva ao produto (?item=)', doEndpoint(S8.endpoint).some((l) => /\?item=[0-9a-f-]{36}&push=/.test(l.payload.data.url)))
  await cron()
  ok('loja abriu: no máximo 1 por dia', doEndpoint(S8.endpoint).filter((l) => /Abrimos!/.test(l.payload.body)).length === 1)
  await soLigar([])

  // ══════════════════════════════════════════════════════════════════════════
  secao('7. Painel: avulsa, contagem, agendamento, teste')
  const est = await api('/api/admin/campanhas/push/estimativa', 'POST', { publico: { tipo: 'todos' } })
  const ativasPromo = Number((await um(`select count(*) n from push_assinaturas where restaurante_id=$1 and status='ativa' and 'promocoes' = any(categorias)`, [A.id])).n)
  ok('contagem prevista = aparelhos ativos com promoções', est.s === 200 && est.j.aparelhos === ativasPromo, `${est.j?.aparelhos} × ${ativasPromo}`)
  const estRec = await api('/api/admin/campanhas/push/estimativa', 'POST', { publico: { tipo: 'inativos', dias: 6 } })
  ok('público "sem pedir há 6 dias" pega só o cliente inativo', estRec.j?.clientes === 1, JSON.stringify(estRec.j))
  const av = await api('/api/admin/campanhas/push/avulsas', 'POST', { titulo: 'TESTE Avulsa', texto: 'Oi {nome}, hoje tem novidade!', destino: { tipo: 'promocoes' }, publico: { tipo: 'todos' } })
  ok('avulsa "agora" sai na hora (loja aberta)', av.s === 201 && av.j.enfileirados === ativasPromo, `${av.s} ${JSON.stringify(av.j)}`)
  ok('avulsa chega com o link de promoções', doEndpoint(S1.endpoint).some((l) => l.payload.title === 'TESTE Avulsa' && l.payload.data.url.includes('?aba=promocoes')))
  const ag = await api('/api/admin/campanhas/push/avulsas', 'POST', { titulo: 'TESTE Agendada', texto: 'Mais tarde', destino: { tipo: 'cardapio' }, publico: { tipo: 'todos' }, agendadoEm: new Date(Date.now() + 2 * 3600_000).toISOString() })
  ok('avulsa agendada fica aguardando', ag.s === 201 && (await um(`select status from push_avulsas where id=$1`, [ag.j.id])).status === 'agendada')
  ok('agendada pode ser cancelada', (await api(`/api/admin/campanhas/push/avulsas/${ag.j.id}`, 'PATCH', {})).s === 200 && (await um(`select status from push_avulsas where id=$1`, [ag.j.id])).status === 'cancelada')
  ok('avulsa sem texto é recusada', (await api('/api/admin/campanhas/push/avulsas', 'POST', { titulo: 'x', texto: '', destino: { tipo: 'cardapio' }, publico: { tipo: 'todos' } })).s === 400)
  ok('variável desconhecida na automação é recusada', (await api('/api/admin/campanhas/push/automacoes', 'PUT', { tipo: 'recompra', ativo: false, titulo: '{loja}', texto: 'Oi {cupom}' })).s === 400)
  const semTel = await api('/api/admin/campanhas/push/teste', 'POST', {})
  ok('teste sem telefone de teste explica o que fazer', semTel.s === 409 && /telefone de teste/i.test(semTel.j?.error ?? ''))
  await api('/api/admin/campanhas/push/config', 'PUT', { limiteDia: 3, limiteSemana: 10, antecedenciaMin: 30, telefoneTeste: '(27) 99987-7001' })
  const antesTeste = doEndpoint(S1.endpoint).length
  const tt = await api('/api/admin/campanhas/push/teste', 'POST', {})
  ok('"Enviar teste para mim" vai só para os aparelhos do telefone de teste', tt.s === 200 && tt.j.aparelhos === 1 && doEndpoint(S1.endpoint).length === antesTeste + 1 && /Teste de notificação/.test(doEndpoint(S1.endpoint).at(-1).payload.body))

  // ══════════════════════════════════════════════════════════════════════════
  secao('8. Clique, pedido em até 48 h e relatório')
  const envCupom = (await enviosDe(S1.endpoint, `and e.tipo='cupom_novo'`))[0]
  await fetch(`${BASE}/api/loja/${LOJA}/push/clique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envio: envCupom.id }) })
  ok('clique registrado', !!(await um(`select clicado_em from push_envios where id=$1`, [envCupom.id])).clicado_em)
  ok('clique de envio de outra loja é ignorado', (await fetch(`${BASE}/api/loja/${VIZINHA}/push/clique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envio: envCupom.id }) })).status === 200
    && (await um(`select clicado_em from push_envios where id=$1`, [envCupom.id])).clicado_em !== null)
  const pc = await enviarPedido(TEL(1), { origemPush: envCupom.id })
  await esperar(400)
  ok('pedido depois do clique conta para a notificação', pc.s === 201 && (await um(`select pedido_id from push_envios where id=$1`, [envCupom.id])).pedido_id === pc.j.id)
  const g = await api('/api/admin/campanhas/push')
  const rel = g.j?.relatorio?.porTipo?.cupom_novo
  ok('relatório por automação: enviadas, cliques e pedidos', g.s === 200 && rel?.enviadas >= 3 && rel?.cliques === 1 && rel?.pedidos === 1, JSON.stringify(rel))
  const ativas = Number((await um(`select count(*) n from push_assinaturas where restaurante_id=$1 and status='ativa'`, [A.id])).n)
  ok('resumo: total e por plataforma batem com o banco', g.j?.resumo?.total === ativas && g.j.resumo.android >= 2 && g.j.resumo.ios === 1 && g.j.resumo.instalados >= 1 && g.j.resumo.clientes >= 5, JSON.stringify(g.j?.resumo))
  ok('relatório da avulsa', g.j?.avulsas?.find((a) => a.titulo === 'TESTE Avulsa')?.relatorio?.enviadas === ativasPromo)

  // ══════════════════════════════════════════════════════════════════════════
  secao('9. Cancelar no aparelho')
  ok('cliente desativa: assinatura cancelada', (await assinar(LOJA, { endpoint: S1.endpoint }, 'DELETE')).s === 200 && (await um(`select status from push_assinaturas where endpoint=$1`, [S1.endpoint])).status === 'cancelada')
  const p1b = await enviarPedido(TEL(1))
  await db.query(`update pedidos set status='preparando' where id=$1`, [p1b.j.id])
  const antes = doEndpoint(S1.endpoint).length
  await api(`/api/pedidos/${p1b.j.id}/notificar`, 'POST', { status: 'preparando' })
  await esperar(500)
  ok('cancelada não recebe mais nada', doEndpoint(S1.endpoint).length === antes)

  // ══════════════════════════════════════════════════════════════════════════
  secao('10. Vitrine: convite e Perfil › Notificações')
  // Chrome instalado (channel): no Chromium do Playwright a permissão de notificação nem chega a 'granted'.
  const chrome = await chromium.launch({ channel: 'chrome' }).catch(() => browser)
  const cv = await chrome.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' })
  await cv.grantPermissions(['notifications'], { origin: BASE })
  const v = await cv.newPage()
  await v.goto(`${BASE}/loja/${LOJA}?push=${envCupom.id}&aba=promocoes`, { waitUntil: 'networkidle' })
  await esperar(800)
  ok('parâmetros do push saem da barra de endereço', !/push=|aba=/.test(v.url()), v.url())
  ok('nenhum convite de notificação ao abrir o cardápio', (await v.locator('[data-push-convite]').count()) === 0)
  // Pop-up de cupom da loja (os cupons do teste são públicos) fecha antes de seguir.
  for (let i = 0; i < 3 && await v.locator('div.fixed.inset-0.z-\\[85\\]').count(); i++) {
    await v.keyboard.press('Escape')
    await v.locator('div.fixed.inset-0.z-\\[85\\]').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
    await esperar(300)
  }
  await v.getByRole('button', { name: /Entrar|Perfil/ }).last().click()
  await v.locator('[data-push-perfil]').waitFor({ timeout: 10000 })
  ok('Perfil › Notificações aparece (loja com push)', await v.locator('[data-push-perfil]').isVisible())
  await v.locator('[data-push-alternar]').click({ timeout: 8000 })
  // Espera o fim da ativação: "Ativadas…" (exato — "Desativadas" também contém "ativadas") ou o erro.
  const ativou = await Promise.race([
    v.locator('[data-push-estado]').filter({ hasText: /^Ativadas/ }).waitFor({ timeout: 20000 }).then(() => true),
    v.getByText('Não foi possível ativar agora').waitFor({ timeout: 20000 }).then(() => false),
  ]).catch(() => false)
  const escopo = await v.evaluate(async (slug) => (await navigator.serviceWorker.getRegistration(`/loja/${slug}`))?.scope, LOJA)
  ok('ativar registra o service worker com o escopo da loja (/loja/<slug>)', escopo === `${BASE}/loja/${LOJA}`, escopo)
  if (!ativou) {
    // Playwright libera a NOTIFICAÇÃO mas não o serviço de PUSH do Chrome ("Registration failed - permission
    // denied"): a assinatura real é conferida no Chrome de verdade (docs/push/relatorio.md).
    ok('sem serviço de push: mensagem amigável, nada quebra', await v.getByText('Não foi possível ativar agora').isVisible())
  } else {
    ok('ativar no Perfil assina de verdade', !!(await um(`select 1 from push_assinaturas where restaurante_id=$1 and endpoint not like 'https://push.teste.local/%'`, [A.id])))
    await v.locator('[data-push-categoria="promocoes"]').uncheck()
    await esperar(800)
    const cats = (await um(`select categorias from push_assinaturas where restaurante_id=$1 and endpoint not like 'https://push.teste.local/%' order by criado_em desc limit 1`, [A.id])).categorias
    ok('desmarcar categoria no Perfil salva no servidor', !cats.includes('promocoes') && cats.includes('pedido'), cats.join(','))
  }
  await cv.close()
  if (chrome !== browser) await chrome.close()
} catch (e) {
  console.error(e)
  res.push(false)
} finally {
  await limparPush()
  await limparPedidos()
  for (const id of criados.cupons) await db.query(`delete from cupons where id=$1`, [id])
  for (const id of criados.campanhas) await db.query(`delete from campanhas_fidelidade where id=$1`, [id])
  for (const id of criados.itens) await db.query(`delete from itens_cardapio where id=$1`, [id])
  await db.query(`update restaurantes set push_liberado=$2, status_loja=$3, frete_gratis_acima=$4 where id=$1`, [A.id, A.push_liberado, A.status_loja, A.frete_gratis_acima])
  await db.query(`update restaurantes set push_liberado=$2 where id=$1`, [B.id, B.push_liberado])
  await browser.close()
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
