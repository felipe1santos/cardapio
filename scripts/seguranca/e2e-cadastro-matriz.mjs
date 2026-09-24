// Matriz do cadastro de produtos (banco LOCAL, loja cantina-demo, só dados de teste com
// prefixo "Matriz <sufixo>"). Categoria, item simples, açaí/volumes, complementos,
// Peça também e os canais (delivery, PDV, garçom, QR, cozinha) com preço do servidor,
// idempotência e isolamento. Pizza e marmita têm E2E próprios (tamanhos e massa).
// Nada existente é apagado; o único item excluído é um criado aqui para testar a exclusão.
//   node scripts/seguranca/e2e-cadastro-matriz.mjs [pasta-de-screenshots]
import { chromium } from 'playwright'
import pg from 'pg'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
exigirLoopback(BASE)
const SHOTS = process.argv[2] ?? null
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`${c ? '✔' : '✘'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const SUF = Date.now().toString().slice(-5)
const P = `Matriz ${SUF}`
const criados = []
const PNG = { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHUlEQVR4nGP8z4APMOGVZRhVMKpgVMGoglEFQ0kBAKpcAR+E1d8pAAAAAElFTkSuQmCC', 'base64') }

const loja = await um(`select id from restaurantes where slug = 'cantina-demo'`)
const browser = await chromium.launch()
async function logar(usuario, w = 1366, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', isMobile: w < 900, hasTouch: w < 900 })
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', usuario)
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }), p.click('button[type="submit"]')])
  await p.waitForLoadState('networkidle')
  return p
}
const dispensar = (p) => p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}, { url, metodo, corpo })
const foto = async (p, nome) => { if (SHOTS) await p.screenshot({ path: join(SHOTS, `${nome}.png`) }) }
async function pedidoDelivery(itens, slug = 'cantina-demo') {
  const r = await fetch(`${BASE}/api/loja/${slug}/pedido`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'retirada', cliente: { nome: `${P} Cliente`, telefone: '11977776666' }, pagamento: 'pix', itens }),
  })
  return { s: r.status, j: await r.json().catch(() => ({})) }
}
const linhaDoPedido = (pedidoId) => um(`select preco_unitario, complementos from pedido_itens where pedido_id = $1`, [pedidoId])
async function vitrine(texto) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' })
  const v = await c.newPage()
  await v.goto(`${BASE}/loja/cantina-demo`, { waitUntil: 'networkidle' }); await v.waitForTimeout(1500)
  await v.getByRole('button', { name: 'Continuar no cardápio' }).click({ timeout: 2500 }).catch(() => {})
  const t = await v.locator('body').innerText()
  await c.close()
  return t.includes(texto)
}

try {
  const g = await logar('gerente.local')

  // ══════════════════════════════════════════════════════════════════════════
  secao('Categorias')
  await g.goto(`${BASE}/admin/cardapio`, { waitUntil: 'networkidle' }); await dispensar(g)
  const CAT = `${P} Cat`
  await g.getByRole('button', { name: /^Nova$/ }).first().click()
  await g.getByPlaceholder('Ex.: Lanches').fill(CAT)
  await g.getByLabel('Escolher imagem — Foto de capa').first().setInputFiles(PNG)
  await g.waitForTimeout(2500)
  await g.getByRole('button', { name: 'Criar categoria' }).click()
  await g.waitForTimeout(1500)
  let cat = await um(`select id, nome, posicao, imagem_url from grupos_cardapio where restaurante_id = $1 and nome = $2`, [loja.id, CAT])
  ok('criar categoria com foto de capa', !!cat?.imagem_url, cat?.nome)
  criados.push(`categoria "${CAT}"`)
  ok('categoria vazia não aparece na vitrine', !(await vitrine(CAT)))
  const posAntes = cat.posicao
  await g.getByRole('button', { name: 'Subir categoria (ordem na vitrine)' }).locator('visible=true').first().click()
  await g.waitForTimeout(1200)
  ok('ordenar: subir a categoria muda a posição', (await um(`select posicao from grupos_cardapio where id = $1`, [cat.id])).posicao < posAntes)
  await g.getByRole('button', { name: 'Editar categoria (nome e foto)' }).locator('visible=true').first().click()
  const campoNome = g.locator('aside input:focus')
  await campoNome.fill(`${CAT} Editada`)
  await g.getByTitle('Salvar', { exact: true }).locator('visible=true').first().click()
  await g.waitForTimeout(1200)
  ok('editar nome da categoria', (await um(`select nome from grupos_cardapio where id = $1`, [cat.id])).nome === `${CAT} Editada`)
  const CATN = `${CAT} Editada`

  // ══════════════════════════════════════════════════════════════════════════
  secao('Item simples')
  await g.getByTestId('novo-item').click()
  await g.getByRole('button', { name: /Lanche \/ Simples/ }).click()
  const SIMPLES = `${P} Lanche`
  await g.getByPlaceholder('Ex.: Burger Duplo Artesanal').fill(`${P} SemPreco`)
  await g.getByRole('button', { name: /Salvar e continuar/ }).click()
  await g.waitForTimeout(800)
  ok('item simples sem preço é barrado com mensagem', /ficaria de graça/.test(await g.locator('aside').last().innerText()))
  await g.getByPlaceholder('Ex.: Burger Duplo Artesanal').fill(SIMPLES)
  await g.getByPlaceholder('32,90').fill('12,50')
  await g.locator('aside input[type="file"][accept="image/*"]').last().setInputFiles(PNG)
  await g.waitForTimeout(2500)
  await g.getByRole('button', { name: /Salvar e continuar/ }).click()
  await g.waitForTimeout(1200)
  await g.getByRole('button', { name: /Continuar/ }).click(); await g.waitForTimeout(400)
  await g.getByPlaceholder('Opcional').fill('12,50')
  await g.getByRole('button', { name: /Concluir/ }).click(); await g.waitForTimeout(800)
  ok('promoção igual ao preço é barrada', /MENOR que o preço normal/.test(await g.locator('aside').last().innerText()))
  await g.getByPlaceholder('Opcional').fill('10,00')
  await g.getByRole('button', { name: /Concluir/ }).click(); await g.waitForTimeout(1500)
  let simples = await um(`select id, preco, promocao_preco, imagem_url, status, grupo_id from itens_cardapio where restaurante_id = $1 and nome = $2`, [loja.id, SIMPLES])
  ok('item simples com nome, preço, foto e promoção', simples && Number(simples.preco) === 12.5 && Number(simples.promocao_preco) === 10 && !!simples.imagem_url, JSON.stringify({ ...simples, imagem_url: !!simples?.imagem_url }))
  ok('item criado na categoria aberta', simples?.grupo_id === cat.id)
  criados.push(`item simples "${SIMPLES}"`)
  ok('com o item, a categoria aparece na vitrine', await vitrine(CATN))
  let r = await pedidoDelivery([{ itemId: simples.id, quantidade: 1, observacao: 'sem cebola', complementos: [] }])
  ok('delivery cobra o preço promocional (servidor)', r.s === 201 && Number((await linhaDoPedido(r.j.id))?.preco_unitario) === 10, `${r.s}`)
  ok('observação chega ao pedido', (await um(`select observacao from pedido_itens where pedido_id = $1`, [r.j.id])).observacao === 'sem cebola')
  await q(`update itens_cardapio set status = 'pausado' where id = $1`, [simples.id])
  ok('pausado: some da vitrine', !(await vitrine(SIMPLES)))
  ok('pausado: servidor recusa', (await pedidoDelivery([{ itemId: simples.id, quantidade: 1, complementos: [] }])).s >= 400)
  const hoje = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' })
  const diaHoje = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(hoje)
  await q(`update itens_cardapio set status = 'disponivel', dias_disponiveis = $2 where id = $1`, [simples.id, [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== diaHoje)])
  ok('fora dos dias: some da vitrine e o servidor recusa', !(await vitrine(SIMPLES)) && (await pedidoDelivery([{ itemId: simples.id, quantidade: 1, complementos: [] }])).s >= 400)
  await q(`update itens_cardapio set dias_disponiveis = '{0,1,2,3,4,5,6}' where id = $1`, [simples.id])
  await q(`update grupos_cardapio set horario_ativo_inicio = '03:00', horario_ativo_fim = '03:01' where id = $1`, [cat.id])
  ok('categoria fora do horário some da vitrine', !(await vitrine(CATN)))
  await q(`update grupos_cardapio set horario_ativo_inicio = null, horario_ativo_fim = null where id = $1`, [cat.id])

  // Exclusão (item criado só para isto)
  const EXC = `${P} Excluir`
  const exc = await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, status, tipo_item) values ($1,$2,$3,'',5,'disponivel','simples') returning id`, [loja.id, cat.id, EXC])
  await g.goto(`${BASE}/admin/cardapio`, { waitUntil: 'networkidle' }); await dispensar(g)
  await g.getByRole('button', { name: new RegExp(CATN) }).locator('visible=true').first().click(); await g.waitForTimeout(600)
  await g.getByLabel(`Selecionar ${EXC}`).locator('visible=true').first().check()
  await g.getByRole('button', { name: /^Ação/ }).locator('visible=true').first().click()
  await g.getByRole('button', { name: 'Excluir', exact: true }).locator('visible=true').first().click(); await g.waitForTimeout(1200)
  ok('exclusão pela ação em lote (regra atual: remove o item)', !(await um(`select 1 from itens_cardapio where id = $1`, [exc.id])))

  // ══════════════════════════════════════════════════════════════════════════
  secao('Complementos (grupo reutilizável)')
  await g.goto(`${BASE}/admin/cardapio?tab=complementos`, { waitUntil: 'networkidle' }); await dispensar(g)
  const GRUPO = `${P} Adicionais`
  await g.getByLabel('Nome do novo grupo').fill(GRUPO)
  await g.getByRole('button', { name: /Criar grupo/ }).click(); await g.waitForTimeout(1200)
  await g.getByLabel('Nome do novo grupo').fill(GRUPO.toLowerCase())
  await g.getByRole('button', { name: /Criar grupo/ }).click(); await g.waitForTimeout(500)
  ok('grupo com nome repetido é recusado com aviso', /Já existe um grupo/.test(await g.locator('main').innerText()))
  const cartao = g.locator('div', { has: g.getByRole('heading', { name: GRUPO }) }).filter({ has: g.getByLabel('Nome da nova opção') }).last()
  for (const [n, pr] of [['Granola', ''], ['Nutella', '5,00'], ['Leite Ninho', '3,00']]) {
    await cartao.getByLabel('Nome da nova opção').fill(n)
    await cartao.getByLabel('Preço da nova opção').fill(pr)
    await cartao.getByRole('button', { name: 'Adicionar' }).click(); await g.waitForTimeout(700)
  }
  await cartao.getByRole('radio', { name: 'Obrigatório' }).click(); await g.waitForTimeout(700)
  const campoMax = cartao.getByLabel('Máximo', { exact: false })
  await campoMax.fill('2'); await campoMax.press('Enter'); await g.waitForTimeout(900)
  let preset = await um(`select id, obrigatorio, min_escolhas, max_escolhas from presets_complementos where restaurante_id = $1 and nome = $2`, [loja.id, GRUPO])
  ok('regras: obrigatório, mínimo 1, máximo 2', preset?.obrigatorio && preset.min_escolhas === 1 && preset.max_escolhas === 2, JSON.stringify(preset))
  const opcoes = await q(`select nome, preco from preset_complemento_itens where preset_id = $1 order by posicao`, [preset.id])
  ok('opções gratuita e pagas gravadas', opcoes.length === 3 && Number(opcoes.find((o) => o.nome === 'Granola')?.preco) === 0 && Number(opcoes.find((o) => o.nome === 'Nutella')?.preco) === 5, JSON.stringify(opcoes))
  criados.push(`grupo de complementos "${GRUPO}"`)
  await foto(g, '10-complementos')

  // ══════════════════════════════════════════════════════════════════════════
  secao('Açaí / volumes com grupo obrigatório importado')
  await g.goto(`${BASE}/admin/cardapio`, { waitUntil: 'networkidle' }); await dispensar(g)
  await g.getByRole('button', { name: new RegExp(CATN) }).locator('visible=true').first().click(); await g.waitForTimeout(500)
  await g.getByTestId('novo-item').click()
  await g.getByRole('button', { name: /Açaí \/ Volumes/ }).click()
  const ACAI = `${P} Açaí`
  await g.getByPlaceholder('Ex.: Burger Duplo Artesanal').fill(ACAI)
  await g.getByRole('button', { name: /Salvar e continuar/ }).click()
  await g.getByTestId('tamanhos-do-item').waitFor({ timeout: 15000 })
  let acai = await um(`select id, status from itens_cardapio where restaurante_id = $1 and nome = $2`, [loja.id, ACAI])
  ok('açaí sem preço-base é salvo pausado', acai?.status === 'pausado')
  criados.push(`açaí "${ACAI}"`)
  for (const [n, pr] of [['300 ml', '15'], ['500 ml', '22']]) {
    await g.getByLabel('Nome do novo volume').fill(n)
    await g.getByLabel('Preço do novo volume').fill(pr)
    await g.getByTestId('tamanhos-do-item').getByRole('button', { name: 'Adicionar' }).click(); await g.waitForTimeout(900)
  }
  await g.getByLabel('Nome do novo volume').fill('300 ML')
  await g.getByTestId('tamanhos-do-item').getByRole('button', { name: 'Adicionar' }).click(); await g.waitForTimeout(500)
  ok('volume repetido é recusado', /já tem/.test(await g.getByTestId('tamanhos-do-item').innerText()))
  await g.getByLabel('Nome do novo volume').fill('')
  await g.getByRole('button', { name: /Continuar/ }).click(); await g.waitForTimeout(600)
  await g.getByRole('button', { name: 'Importar grupo' }).click(); await g.waitForTimeout(500)
  await g.locator('aside', { hasText: 'Importar grupo de complementos' }).locator('div', { has: g.getByRole('heading', { name: GRUPO }) }).getByRole('button', { name: 'Importar neste item' }).last().click()
  await g.waitForTimeout(1500)
  await g.getByRole('button', { name: /Continuar/ }).click(); await g.waitForTimeout(400)
  await g.getByRole('button', { name: /Concluir/ }).click(); await g.waitForTimeout(1500)
  acai = await um(`select id, status from itens_cardapio where id = $1`, [acai.id])
  ok('com volume precificado, o açaí fica disponível ao concluir', acai.status === 'disponivel')
  const gAcai = await um(`select id, obrigatorio, min_escolhas, max_escolhas from grupos_item_complementos where item_id = $1`, [acai.id])
  ok('grupo importado com as regras', gAcai?.obrigatorio && gAcai.max_escolhas === 2)

  const L = (extra) => [{ itemId: acai.id, quantidade: 1, complementos: [], tamanhoNome: '500 ml', ...extra }]
  r = await pedidoDelivery(L())
  ok('servidor: grupo obrigatório sem escolha é recusado', r.s >= 400 && /Escolha/.test(r.j?.error ?? ''), r.j?.error)
  r = await pedidoDelivery(L({ complementos: ['Granola', 'Nutella', 'Leite Ninho'] }))
  ok('servidor: acima do máximo é recusado', r.s >= 400 && /no máximo/.test(r.j?.error ?? ''), r.j?.error)
  r = await pedidoDelivery(L({ complementos: ['Nutella', 'Granola'] }))
  ok('volume substitui o preço-base; pago soma, gratuito não (22 + 5)', r.s === 201 && Number((await linhaDoPedido(r.j.id))?.preco_unitario) === 27, `${r.s} ${r.j?.error ?? ''}`)
  await q(`update item_complementos set pausado = true where item_id = $1 and nome = 'Nutella'`, [acai.id])
  r = await pedidoDelivery(L({ complementos: ['Nutella'] }))
  ok('servidor: opção pausada é recusada', r.s >= 400 && /não está disponível/.test(r.j?.error ?? ''), r.j?.error)
  await q(`update item_complementos set pausado = false where item_id = $1 and nome = 'Nutella'`, [acai.id])
  r = await pedidoDelivery([{ itemId: acai.id, quantidade: 1, complementos: ['Granola'], tamanhoNome: '1 litro' }])
  ok('volume inexistente é recusado', r.s >= 400)

  // ══════════════════════════════════════════════════════════════════════════
  secao('Peça também')
  await g.goto(`${BASE}/admin/cardapio?tab=orderbump`, { waitUntil: 'networkidle' }); await dispensar(g)
  ok('link antigo abre "Peça também"', (await g.getByTestId('aba-peca-tambem').getAttribute('aria-selected')) === 'true')
  for (const nome of [SIMPLES, ACAI]) {
    await g.getByLabel('Buscar produto').fill(nome)
    await g.getByRole('button', { name: new RegExp(nome) }).first().click(); await g.waitForTimeout(900)
  }
  let bumps = await q(`select b.id, i.nome, b.posicao, b.ativo from order_bumps b join itens_cardapio i on i.id = b.item_id where b.restaurante_id = $1 and i.nome like $2 order by b.posicao`, [loja.id, `${P}%`])
  ok('adicionar dois produtos', bumps.length === 2)
  criados.push('2 sugestões em Peça também')
  await q(`update itens_cardapio set status = 'pausado' where id = $1`, [simples.id])
  await g.reload({ waitUntil: 'networkidle' }); await g.waitForTimeout(800)
  ok('produto pausado mostra o motivo', /Item pausado/.test(await g.locator('main').innerText()))
  await q(`update itens_cardapio set status = 'disponivel' where id = $1`, [simples.id])
  await q(`update grupos_cardapio set horario_ativo_inicio = '03:00', horario_ativo_fim = '03:01' where id = $1`, [cat.id])
  await g.reload({ waitUntil: 'networkidle' }); await g.waitForTimeout(800)
  ok('categoria fora do horário mostra o motivo', /Categoria fora do horário/.test(await g.locator('main').innerText()))
  await q(`update grupos_cardapio set horario_ativo_inicio = null, horario_ativo_fim = null where id = $1`, [cat.id])
  await g.reload({ waitUntil: 'networkidle' }); await g.waitForTimeout(800)
  await g.getByRole('button', { name: 'Descer' }).first().click().catch(() => {})
  await g.waitForTimeout(800)
  await g.getByRole('switch', { name: new RegExp(`Pausar sugestão de ${ACAI}`) }).click(); await g.waitForTimeout(800)
  ok('pausar uma sugestão', (await um(`select b.ativo from order_bumps b join itens_cardapio i on i.id=b.item_id where i.nome = $1`, [ACAI])).ativo === false)
  await g.getByRole('button', { name: `Tirar ${ACAI} das sugestões` }).click(); await g.waitForTimeout(900)
  ok('remover uma sugestão', !(await um(`select 1 from order_bumps b join itens_cardapio i on i.id=b.item_id where i.nome = $1`, [ACAI])))
  const bumpItem = await um(`select b.item_id from order_bumps b join itens_cardapio i on i.id=b.item_id where i.nome = $1`, [SIMPLES])
  ok('referência circular: a sugestão aponta para um produto, nunca para outra sugestão', !!bumpItem && bumpItem.item_id === simples.id)
  await foto(g, '11-peca-tambem')

  // ══════════════════════════════════════════════════════════════════════════
  secao('Canais: PDV, garçom, QR, cozinha, idempotência e isolamento')
  const at = await logar('atendente.local')
  const cb = await api(at, '/api/admin/balcao/comandas', 'POST', { nome: `${P} PDV`, chave: uuid(), modalidade: 'retirada' })
  const chave = uuid()
  const linhaAcai = [{ itemId: acai.id, quantidade: 1, complementos: ['Leite Ninho'], tamanhoNome: '300 ml' }]
  const l1 = await api(at, '/api/admin/pdv/lancamento', 'POST', { comandaId: cb.j?.id, chave, itens: linhaAcai })
  await api(at, '/api/admin/pdv/lancamento', 'POST', { comandaId: cb.j?.id, chave, itens: linhaAcai })
  ok('PDV lança o açaí (15 + 3)', l1.s === 201 && Number((await linhaDoPedido(l1.j?.id))?.preco_unitario) === 18, `${l1.s} ${l1.j?.error ?? ''}`)
  ok('idempotência: mesma chave não duplica o pedido', Number((await um(`select count(*) n from pedidos where comanda_id = $1`, [cb.j?.id])).n) === 1)
  ok('PDV: opção pausada/obrigatória também conferida', (await api(at, '/api/admin/pdv/lancamento', 'POST', { comandaId: cb.j?.id, chave: uuid(), itens: [{ itemId: acai.id, quantidade: 1, complementos: [], tamanhoNome: '300 ml' }] })).s >= 400)
  const gar = await logar('garcom.local', 390, 844)
  const mesa = await um(`select id, token from mesas where restaurante_id = $1 and ativa and nome = 'Mesa 02'`, [loja.id])
  await api(gar, `/api/admin/mesas/${mesa.id}/atendimento`, 'POST', { acao: 'abrir', nome: `${P} Mesa`, chave: uuid() })
  const lg = await api(gar, `/api/admin/mesas/${mesa.id}/lancamento`, 'POST', { chaveIdempotencia: uuid(), selecoesVistas: [], itens: [{ itemId: simples.id, quantidade: 2, observacao: '', complementos: [] }] })
  ok('garçom lança o item simples com preço promocional', lg.s === 201 && Number((await um(`select pi.preco_unitario from pedido_itens pi join pedidos p on p.id=pi.pedido_id where p.comanda_id is not null and pi.item_id = $1 order by p.criado_em desc limit 1`, [simples.id])).preco_unitario) === 10, `${lg.s} ${lg.j?.error ?? ''}`)
  const sel = await fetch(`${BASE}/api/mesa/${mesa.token}/selecao`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dispositivo: uuid(), itens: [{ itemId: acai.id, quantidade: 1, opcoes: [{ grupo: 'Tamanho', escolha: '500 ml', preco: 0, tipo: 'tamanho' }, { grupo: GRUPO, escolha: 'Nutella', preco: 0.01, tipo: 'opcao' }] }] }),
  })
  const sj = await sel.json().catch(() => ({}))
  const linhaSel = await um(`select si.preco_snapshot, si.opcoes from selecao_itens si where si.item_id = $1 order by si.criado_em desc limit 1`, [acai.id])
  const nutella = (linhaSel?.opcoes ?? []).find((o) => o.escolha === 'Nutella')
  ok('QR: seleção grava o preço do catálogo, não o do navegador (volume 22 + Nutella 5)', sel.ok && sj?.ok && Number(linhaSel?.preco_snapshot) === 22 && Number(nutella?.preco) === 5, JSON.stringify({ base: linhaSel?.preco_snapshot, nutella: nutella?.preco }))
  ok('QR continua sendo seleção: nenhum pedido criado pela mesa', Number((await um(`select count(*) n from pedidos where comanda_id is null and mesa = 'Mesa 02' and criado_em > now() - interval '5 minutes'`)).n) === 0)
  const est = await um(`select token from estacoes where restaurante_id = $1 limit 1`, [loja.id])
  if (est?.token) {
    const coz = await fetch(`${BASE}/api/cozinha/${est.token}`)
    const cj = await coz.json().catch(() => ({}))
    ok('cozinha (token) recebe o pedido do PDV', coz.ok && JSON.stringify(cj).includes(ACAI), `${coz.status}`)
  } else ok('cozinha (token) — estação local sem token', true, 'pulado')
  const viz = await logar('dono@vizinha.local')
  ok('isolamento: outra loja não lê a comanda', (await api(viz, `/api/admin/comandas/${cb.j?.id}`)).s >= 400)
  ok('isolamento: outra loja não vende o item desta', (await pedidoDelivery([{ itemId: simples.id, quantidade: 1, complementos: [] }], 'vizinha-demo')).s >= 400)
  ok('isolamento: outra loja não enxerga o grupo de complementos', !(await viz.evaluate(async () => document.body.innerText)).includes(GRUPO))

  await at.context().close(); await gar.context().close(); await viz.context().close(); await g.context().close()
} catch (e) {
  ok('execução', false, e.message.split('\n')[0])
} finally {
  await browser.close(); await db.end()
}
console.log(`\nDados de teste criados (não apagados): ${criados.join('; ') || 'nenhum'}; pedidos e comandas "${P} …".`)
const f = res.filter((x) => !x).length
console.log(`\n${res.length - f}/${res.length} passaram`)
process.exit(f ? 1 : 0)
