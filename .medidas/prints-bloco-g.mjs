// Bloco G (19/10): prints do Kanban redesenhado (1366×768), LOCAL, loja Menuzia, sessão do dono no Playwright.
//   node .medidas/prints-bloco-g.mjs C:/Users/felipe/.menuzia-pw-local [http://localhost:3000]
// Cria: 1 pedido pela vitrine e o EDITA pela rota do painel (item removido + item adicionado), 1 "Não entregue"
// (cancelado pelo motoboy, já em rota) e, no fim, 1 pedido novo para os 3 frames da animação. Usa os fakes do iFood
// (#544 recebido, #545 preparando/dinheiro, #546 cancelado pelo cliente) criados por criar-pedidos-ifood-fake.mjs.
// Impressão automática da Menuzia fica DESLIGADA durante o teste (e volta ao que era). Pedidos ficam abertos para o
// dono ver no dev server; fechar depois com: node .medidas/prints-bloco-g.mjs --fechar
import { readFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: loja } = await admin.from('restaurantes').select('id, slug, status_loja, impressao_automatica').eq('slug', 'menuzia').single()
if (loja?.slug !== 'menuzia') throw new Error('loja errada')
const fecharTudo = async () => {
  const { data: abertos } = await admin.from('pedidos').select('id, numero').eq('restaurante_id', loja.id).ilike('cliente_nome', 'Teste %').not('status', 'in', '("entregue","cancelado")')
  for (const p of abertos ?? []) await admin.from('pedidos').update({ status: 'cancelado', cancelado_motivo: 'teste', cancelado_observacao: 'Pedido de teste do redesign (Bloco G, 19/10)', cancelado_por: 'Loja: Teste', cancelado_em: new Date().toISOString(), reimprimir: false }).eq('id', p.id).eq('restaurante_id', loja.id)
  console.log('fechados:', (abertos ?? []).map((p) => '#' + p.numero).join(' ') || 'nenhum')
}
if (process.argv[2] === '--fechar') { await fecharTudo(); process.exit(0) }

const [PERFIL, BASE = 'http://localhost:3000'] = process.argv.slice(2)
const TEL = '27992534407'
const FSD = '58030688-26b9-48b5-9fe4-9b9e26592670', COCA = 'a7733efd-3ffd-4857-baef-77d096702e90'
const DIR = '.shots/bloco-g'; mkdirSync(DIR, { recursive: true })
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = 0, n = 0
const v = (r, c, extra = '') => { n++; if (c) ok++; console.log(c ? 'ok  ' : 'ERRO', r, extra ? '— ' + extra : '') }
const statusOriginal = loja.status_loja, impressaoOriginal = loja.impressao_automatica
await admin.from('restaurantes').update({ status_loja: 'aberto_manual', impressao_automatica: false }).eq('id', loja.id)

const criar = async (rotulo, itens, extra = {}) => {
  const r = await fetch(`${BASE}/api/loja/menuzia/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'entrega', cliente: { nome: `Teste Bloco G ${rotulo}`, telefone: TEL },
    endereco: { rua: 'Rua Teste Kanban', numero: '10', complemento: 'TESTE - não entregar', bairro: 'Jaburuna', cep: '29102000', cidade: 'Vila Velha', referencia: '' },
    pagamento: 'dinheiro', trocoPara: 100, itens, chavePedido: `bg-${randomUUID()}`, ...extra }) })
  const j = await r.json(); const id = j.pedidoId ?? j.id ?? j.pedido?.id; if (!id) console.log('criar falhou', r.status, JSON.stringify(j).slice(0, 300)); return id
}
const ped = async (id) => (await admin.from('pedidos').select('id, numero, status, total, observacao, edicoes, editado_em, pedido_itens ( id, nome, quantidade, cancelado_em, cancelado_motivo )').eq('id', id).single()).data

const ctx = await chromium.launchPersistentContext(PERFIL, { headless: true, viewport: { width: 1366, height: 768 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
const p = ctx.pages()[0] ?? await ctx.newPage()
const api = (metodo, caminho, corpo) => p.evaluate(async ([m, c, b]) => { const r = await fetch(c, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json() } catch { /* */ } return { s: r.status, j } }, [metodo, caminho, corpo])
const kanban = async () => { await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('[data-testid="kanban-quadro"]', { timeout: 120_000 }); await espera(2500) }
const shot = (nome, el) => (el ?? p).screenshot({ path: `${DIR}/${nome}.png` })
const fecharPainel = async () => { await p.keyboard.press('Escape').catch(() => {}); await espera(400) }
const abrirCard = async (numero) => { const c = p.locator(`[data-testid="pedido-${numero}"], [data-testid="fluxo-${numero}"]`).first(); await c.scrollIntoViewIfNeeded().catch(() => {}); await c.click({ position: { x: 60, y: 12 } }); await p.waitForSelector('[data-testid="painel-pedido"]', { timeout: 10_000 }); await espera(700); return c }

try {
  // ── Pedido editado (item removido + item adicionado) pela MESMA rota do painel ──
  const P1 = await criar('Editado', [{ itemId: FSD, quantidade: 2, observacao: '', complementos: [] }, { itemId: FSD, quantidade: 1, observacao: 'obs original', complementos: [] }])
  const a1 = await ped(P1); const l2 = a1.pedido_itens.find((l) => l.quantidade === 1)
  await kanban()
  const e1 = await api('POST', `/api/admin/pedidos/${P1}/editar`, { itens: { remover: [l2.id], adicionar: [{ itemId: COCA, quantidade: 1, observacao: '', complementos: [] }] }, reimprimir: false })
  const b1 = await ped(P1)
  v(`edição pela rota (${e1.s}): observação do cliente intocada, alteracoes estruturadas, item removido com cancelado_motivo=edicao`,
    e1.s === 200 && !String(b1.observacao ?? '').includes('PEDIDO ALTERADO') && (b1.edicoes?.[0]?.alteracoes ?? []).length === 2 && b1.pedido_itens.some((l) => l.cancelado_motivo === 'edicao'), JSON.stringify(b1.edicoes?.[0]?.alteracoes))

  // ── "Não entregue": saiu para entrega e o motoboy não entregou (inserido direto, já fechado) ──
  const { data: ne } = await admin.from('pedidos').insert({ restaurante_id: loja.id, tipo: 'entrega', status: 'cancelado', cliente_nome: 'Teste Bloco G Não entregue', cliente_telefone: TEL, telefone_verificado: true, origem: 'cardapio', canal: 'delivery', origem_canal: 'direto',
    endereco_rua: 'Rua Teste Kanban', endereco_numero: '10', endereco_bairro: 'Jaburuna', endereco_cidade: 'Vila Velha', forma_pagamento: 'dinheiro', troco_para: 50, subtotal: 30, taxa_entrega: 5.89, total: 35.89, impresso: true, reimprimir: false,
    preparando_em: new Date(Date.now() - 50 * 60_000).toISOString(), pronto_em: new Date(Date.now() - 40 * 60_000).toISOString(), em_rota_em: new Date(Date.now() - 30 * 60_000).toISOString(), saiu_para_entrega_em: new Date(Date.now() - 30 * 60_000).toISOString(),
    cancelado_motivo: 'nao_entregue', cancelado_observacao: 'cliente não atendeu o interfone', cancelado_por: 'Entregador: Zé', cancelado_em: new Date(Date.now() - 5 * 60_000).toISOString() }).select('id, numero').single()
  if (ne) await admin.from('pedido_itens').insert({ pedido_id: ne.id, nome: 'Xtudo', preco_unitario: 30, quantidade: 1, observacao: '', complementos: [] })
  v('pedido "Não entregue" inserido (em rota + motoboy)', !!ne, ne ? '#' + ne.numero : '')

  const { data: fakes } = await admin.from('pedidos').select('numero, status, forma_pagamento, cancelado_por').eq('restaurante_id', loja.id).ilike('cliente_nome', 'Teste iFood%').order('numero')
  v('fakes do iFood presentes (recebido, preparando/dinheiro, cancelado pelo cliente)', (fakes ?? []).length >= 3, (fakes ?? []).map((f) => `#${f.numero} ${f.status} ${f.forma_pagamento}`).join(' · '))
  const dinheiro = (fakes ?? []).find((f) => f.status === 'preparando' && f.forma_pagamento === 'dinheiro')
  const cancCliente = (fakes ?? []).find((f) => f.status === 'cancelado')

  // ── 1) Kanban com as colunas (iFood + cancelado pelo cliente + não entregue) ──
  await kanban()
  const col4 = p.locator('[data-testid="kanban-entregas"]')
  if ((await col4.getAttribute('aria-pressed')) !== 'true') { await col4.click(); await espera(800) }
  const cardIfood = p.locator('[data-testid="card-app"][data-app="ifood"]')
  v('card do iFood com o logo grande', (await cardIfood.count()) >= 1)
  const cardEditado = p.locator(`[data-testid="pedido-${b1.numero}"]`)
  v('card editado: item removido riscado e adicionado em amarelo', (await cardEditado.locator('[data-testid="etiqueta-removido"]').count()) === 1 && (await cardEditado.locator('[data-testid="etiqueta-adicionado"]').count()) === 1)
  await shot('01-kanban-colunas')

  // ── 2) Modal do pedido EDITADO ──
  await abrirCard(b1.numero)
  const painel = p.locator('[data-testid="painel-pedido"]')
  v('modal: linha "Alterado às …" + item removido + adicionado', (await painel.locator('[data-testid="painel-editado-linha"]').count()) === 1 && (await painel.locator('[data-testid="painel-item-removido"]').count()) === 1 && (await painel.locator('[data-testid="painel-item-adicionado"]').count()) === 1)
  v('modal: observação do cliente sem "PEDIDO ALTERADO"', !/PEDIDO ALTERADO/.test(await painel.innerText()))
  v('modal: cabeçalho com botões só de ícone (lápis, impressora, X)', (await painel.locator('[data-testid="painel-editar"]').innerText()).trim() === '' && (await painel.locator('[data-testid="painel-cancelar"]').innerText()).trim() === '')
  await shot('02-modal-editado')
  await painel.locator('[data-testid="painel-editado-linha"]').click(); await espera(400)
  v('modal: histórico abre com uma alteração por linha', (await painel.locator('[data-testid="painel-historico"] li li').count()) >= 2)
  await shot('02b-modal-historico')
  await fecharPainel()

  // ── 3) Modal com pagamento em dinheiro (fake iFood em preparo) ──
  if (dinheiro) {
    await abrirCard(dinheiro.numero)
    v('modal dinheiro: cédula colorida + troco', (await painel.locator('[data-testid="painel-troco"]').count()) === 1)
    await shot('03-modal-dinheiro')
    await fecharPainel()
  }

  // ── 4) Coluna Entregas & concluídos: Cancelados × Não entregues ──
  const coluna = p.locator('h3:has-text("Entregas & concluídos")').locator('xpath=ancestor::div[2]')
  const txt = await coluna.innerText()
  v('coluna 4: seções "Cancelados" e "Não entregues"', /CANCELADOS/i.test(txt) && /NÃO ENTREGUES/i.test(txt))
  v('coluna 4: card do cancelado pelo cliente mostra quem + motivo', /pelo cliente \(robô\)/.test(txt) && /Cliente desistiu/.test(txt))
  v('coluna 4: card do não entregue mostra o motoboy', /pelo motoboy Zé/.test(txt))
  await shot('04-coluna-concluidos', coluna)
  if (cancCliente) { await abrirCard(cancCliente.numero); v('modal: "Cancelado pelo cliente (robô)"', /Cancelado pelo cliente \(robô\)/.test(await painel.innerText())); await shot('04b-modal-cancelado-cliente'); await fecharPainel() }
  if (ne) { await abrirCard(ne.numero); v('modal: "Não entregue pelo motoboy Zé"', /Não entregue pelo motoboy Zé/.test(await painel.innerText())); await shot('04c-modal-nao-entregue'); await fecharPainel() }

  // ── 5) Pedido novo chegando: 3 frames da animação ──
  const P2 = await criar('Novo', [{ itemId: FSD, quantidade: 1, observacao: '', complementos: [] }])
  const c2 = await ped(P2)
  const novo = p.locator(`[data-testid="pedido-${c2.numero}"]`)
  await novo.waitFor({ timeout: 20_000 })
  await shot('05-novo-frame1-entrada')
  v('pedido novo: classe da animação no card', /animate-new-order/.test((await novo.getAttribute('class')) ?? ''))
  await espera(1400); await shot('05-novo-frame2-piscando')
  await espera(4000); await shot('05-novo-frame3-verde-claro')
  await fecharPainel()
} finally {
  await admin.from('restaurantes').update({ status_loja: statusOriginal, impressao_automatica: impressaoOriginal }).eq('id', loja.id)
  await ctx.close()
  console.log(`\n${ok} de ${n} — prints em ${DIR}/ (pedidos de teste ficam abertos; fechar com --fechar)`)
}
