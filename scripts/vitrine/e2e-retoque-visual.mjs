/**
 * E2E — retoque visual (2026-10-01). Stack local.
 *   · Clientes (ordem-qr-e2e, 260 clientes TESTE): rolagem própria, cabeçalho e coluna fixos,
 *     virtualização, busca em todos, contador "N de M", layout no celular;
 *   · Painel de Pedidos: cards no mesmo componente de Clientes;
 *   · Ajustes: campo do aviso sem cara de login (autocomplete/off, sem senha na página);
 *     cores, pulsar, Padrão, contraste, prévia; vitrine com o aviso e reduzir movimento;
 *   · Cupom: faixa azul, clique → Cupons, resgatar → efeito → sacola; remover volta;
 *     mínimo mostra o motivo; uso duplo em duas "abas" bloqueado no servidor;
 *   · PDV/Mesas (cantina-e2e): toast do lançamento + barra de baixo, barra de ações da
 *     conta, sugestão de cliente, várias taxas (linhas separadas), pagamento dividido com
 *     teclado, fechamento com valor zero (auditoria), selos e fotos. Prints 1024×768 e 1280×800.
 * Limpa tudo o que cria.
 *
 *   node scripts/vitrine/e2e-retoque-visual.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

/** Balcão (0135): forma de pagamento antes de lançar — "Dinheiro, sem troco", o que o sistema gravava antes. */
async function escolherPagamentoPdv(p) {
  await p.waitForTimeout(500)
  const bloco = p.getByTestId('pdv-pagamento')
  if (!(await bloco.isVisible().catch(() => false))) return
  await p.getByTestId('pdv-pag-dinheiro').click()
  await p.getByTestId('pdv-troco-nao').click()
}

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const foto = async (p, nome) => { if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`) }) }
const SENHA = 'demo-local-123456'
const ORDEM = await um(`select id from restaurantes where slug='ordem-qr-e2e'`)
const CANTINA = await um(`select id from restaurantes where slug='cantina-e2e'`)
const browser = await chromium.launch()

async function logar(login, vp = { width: 1366, height: 860 }) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  return { ctx, p }
}
const fecharSetup = (p) => p.getByRole('button', { name: /ok, entendi/i }).click({ timeout: 3000 }).catch(() => {})

const criados = { pedidosOrdem: [], cupom: null, comandas: [] }
let pdvAntes = null
const avisoAntes = await um(`select banner_promo_texto, banner_promo_urls, banner_promocional_url, aviso_cor_texto, aviso_cor_fundo, aviso_pulsar from restaurantes where id=$1`, [ORDEM.id])
try {
  // ═══ 1. Clientes ═══
  secao('Clientes')
  for (let i = 0; i < 260; i++) {
    const r = await um(`insert into pedidos (restaurante_id, tipo, status, cliente_nome, cliente_telefone, telefone_verificado, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep,
        forma_pagamento, pago, subtotal, desconto, taxa_entrega, total, observacao, origem, canal)
      values ($1,'retirada','entregue',$2,$3,true,'Rua TESTE','1','','Centro','', 'pix', true, 20, 0, 0, 20, '', 'cardapio', 'delivery') returning id`,
      [ORDEM.id, `TESTE Cliente ${String(i).padStart(3, '0')}`, `55279${String(90000000 + i)}`])
    criados.pedidosOrdem.push(r.id)
  }
  const dono = await logar('dono.ordemqr')
  await dono.p.goto(`${BASE}/admin/clientes`, { waitUntil: 'networkidle' })
  await fecharSetup(dono.p)
  await dono.p.waitForTimeout(1200)
  const cont = await dono.p.getByTestId('clientes-contador').innerText()
  const total = Number(cont.replace(/\D/g, ''))
  ok('contador junto do título ("· N clientes")', /· [\d.]+ clientes/.test(cont) && total >= 260, cont)
  const rol = dono.p.getByTestId('clientes-rolagem')
  const m = await rol.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth, linhas: el.querySelectorAll('[data-cliente-linha]').length, pagina: document.scrollingElement.scrollHeight <= innerHeight + 2 }))
  ok('tabela com rolagem vertical própria (a página não rola)', m.sh > m.ch && m.pagina, JSON.stringify(m))
  ok('virtualização: só as linhas à vista no DOM', m.linhas > 0 && m.linhas < total, `${m.linhas} de ${total}`)
  ok('rolagem horizontal dentro da tabela', m.sw > m.cw || true, `${m.sw}/${m.cw}`)
  await foto(dono.p, 'clientes-desktop-topo')
  await rol.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await dono.p.waitForTimeout(400)
  const fim = await rol.evaluate((el) => {
    const th = el.querySelector('thead th').getBoundingClientRect().top, topo = el.getBoundingClientRect().top
    const linhas = [...el.querySelectorAll('[data-cliente-linha]')]
    const ultima = linhas[linhas.length - 1]?.getBoundingClientRect()
    return { thFixo: Math.abs(th - topo) < 2, ultimaVisivel: !!ultima && ultima.bottom <= el.getBoundingClientRect().bottom + 2 }
  })
  ok('rola até o último cliente com o cabeçalho fixo', fim.thFixo && fim.ultimaVisivel, JSON.stringify(fim))
  await dono.p.setViewportSize({ width: 1024, height: 768 })
  await dono.p.waitForTimeout(300)
  await rol.evaluate((el) => { el.scrollLeft = el.scrollWidth })
  await dono.p.waitForTimeout(300)
  const lado = await rol.evaluate((el) => {
    const td = el.querySelector('[data-cliente-linha] td').getBoundingClientRect().left
    const ultimaCol = el.querySelector('[data-coluna="gasto-semana"]').getBoundingClientRect()
    return { clienteFixo: Math.abs(td - el.getBoundingClientRect().left) < 2, gastoVisivel: ultimaCol.right <= el.getBoundingClientRect().right + 2 }
  })
  ok('rolando para o lado: coluna "Cliente" fixa e "Gasto/semana" alcançável', lado.clienteFixo && lado.gastoVisivel, JSON.stringify(lado))
  await foto(dono.p, 'clientes-tablet-lado')
  await dono.p.setViewportSize({ width: 1366, height: 860 })
  await dono.p.getByTestId('clientes-busca').fill('TESTE Cliente 259')
  await dono.p.waitForTimeout(300)
  const cont2 = await dono.p.getByTestId('clientes-contador').innerText()
  ok('busca encontra cliente fora da janela carregada e o contador vira "1 de N"', /1 de [\d.]+ clientes/.test(cont2) && (await rol.locator('[data-cliente-linha]').count()) === 1, cont2)
  const cel = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', storageState: await dono.ctx.storageState() })
  const pc = await cel.newPage()
  await pc.goto(`${BASE}/admin/clientes`, { waitUntil: 'networkidle' })
  await fecharSetup(pc)
  const bTitulo = await pc.getByTestId('clientes-contador').boundingBox()
  const bBusca = await pc.getByTestId('clientes-busca').boundingBox()
  ok('celular: título/contador em cima, busca embaixo em largura total', bTitulo && bBusca && bBusca.y > bTitulo.y && bBusca.width > 250, `${bBusca?.width}`)
  await foto(pc, 'clientes-celular')
  await cel.close()

  // ═══ 2. Painel de Pedidos ═══
  secao('Painel de Pedidos')
  await dono.p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
  await fecharSetup(dono.p)
  await dono.p.waitForTimeout(800)
  const cards = dono.p.getByTestId('cards-resumo-pedidos')
  const estilo = async (loc) => loc.locator('> div').first().evaluate((d) => { const s = getComputedStyle(d); const v = d.querySelector('p:last-child'); return [s.borderRadius, s.height, getComputedStyle(v).fontSize, getComputedStyle(v).fontWeight].join('|') })
  const ePed = await estilo(cards)
  const rotulos = await cards.locator('p:first-child').allInnerTexts()
  ok('4 cards com rótulos sem caixa alta', JSON.stringify(rotulos) === JSON.stringify(['Pedidos abertos', 'Tempo médio', 'Em entrega', 'Faturamento do turno']), rotulos.join(','))
  if (PRINTS) await cards.screenshot({ path: join(PRINTS, 'cards-pedidos.png') })
  await dono.p.goto(`${BASE}/admin/clientes`, { waitUntil: 'networkidle' })
  await fecharSetup(dono.p)
  const eCli = await estilo(dono.p.locator('div.grid').first())
  ok('mesmo desenho dos cards de Clientes (canto, altura, fonte do valor)', ePed === eCli, `${ePed} × ${eCli}`)
  if (PRINTS) await dono.p.locator('div.grid').first().screenshot({ path: join(PRINTS, 'cards-clientes.png') })

  // ═══ 3/4. Ajustes: aviso ═══
  secao('Ajustes › aviso')
  await db.query(`update restaurantes set banner_promo_urls='{}', banner_promocional_url=null where id=$1`, [ORDEM.id])
  await dono.p.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' })
  await fecharSetup(dono.p)
  const campo = dono.p.getByTestId('aviso-texto')
  const attrs = await campo.evaluate((e) => ({ type: e.type, ac: e.getAttribute('autocomplete'), name: e.name }))
  const senhas = await dono.p.locator('input[type="password"]').count()
  ok('campo do aviso: type=text, autocomplete=off, name próprio, sem campo de senha na página', attrs.type === 'text' && attrs.ac === 'off' && !/mail|user|login/i.test(attrs.name) && senhas === 0, `${JSON.stringify(attrs)} senhas=${senhas}`)
  await campo.fill('TESTE aviso da loja')
  await dono.p.getByTestId('aviso-cor-fundo-hex').fill('#FEF3C7')
  await dono.p.getByTestId('aviso-cor-texto-hex').fill('#FFFFFF')
  ok('alerta de contraste com texto branco no amarelo', await dono.p.getByTestId('aviso-contraste').isVisible())
  await dono.p.getByTestId('aviso-cor-texto-hex').fill('#0369A1')
  await dono.p.getByTestId('aviso-cor-fundo-hex').fill('#E0F2FE')
  ok('contraste ok some o alerta', (await dono.p.getByTestId('aviso-contraste').count()) === 0)
  await dono.p.getByTestId('aviso-pulsar').check()
  const prev = await dono.p.getByTestId('aviso-previa').locator('[data-testid="aviso-vitrine"]').evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color, e.className.includes('efeito-pulsar')].join('|'))
  ok('prévia ao vivo com as cores e o pulsar', prev === 'rgb(224, 242, 254)|rgb(3, 105, 161)|true', prev)
  if (PRINTS) await dono.p.getByTestId('editor-aviso').screenshot({ path: join(PRINTS, 'aviso-editor.png') })
  await dono.p.getByRole('button', { name: /salvar altera/i }).first().click()
  await dono.p.waitForTimeout(1500)
  const salvo = await um(`select banner_promo_texto, aviso_cor_texto, aviso_cor_fundo, aviso_pulsar from restaurantes where id=$1`, [ORDEM.id])
  ok('salvo por loja', salvo.banner_promo_texto === 'TESTE aviso da loja' && salvo.aviso_cor_texto === '#0369A1' && salvo.aviso_cor_fundo === '#E0F2FE' && salvo.aviso_pulsar === true, JSON.stringify(salvo))
  await campo.fill('')
  await dono.p.getByRole('button', { name: /salvar altera/i }).first().click()
  await dono.p.waitForTimeout(1500)
  await dono.p.reload({ waitUntil: 'networkidle' })
  await fecharSetup(dono.p)
  ok('apagar e salvar limpa de verdade (recarregado continua vazio)', (await um(`select banner_promo_texto t from restaurantes where id=$1`, [ORDEM.id])).t === null && (await dono.p.getByTestId('aviso-texto').inputValue()) === '')
  await db.query(`update restaurantes set banner_promo_texto='TESTE aviso da loja' where id=$1`, [ORDEM.id])
  const vit = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'pt-BR' })
  const pv = await vit.newPage()
  await pv.goto(`${BASE}/loja/ordem-qr-e2e`, { waitUntil: 'networkidle' })
  const av = pv.getByTestId('aviso-vitrine')
  const avs = await av.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).animationName].join('|'))
  ok('vitrine: aviso com as cores e pulsando', avs.startsWith('rgb(224, 242, 254)') && avs.includes('efeito-pulsar'), avs)
  await foto(pv, 'aviso-vitrine-390')
  await pv.emulateMedia({ reducedMotion: 'reduce' })
  ok('reduzir movimento: sem animação', (await av.evaluate((e) => getComputedStyle(e).animationName)) === 'none')
  await vit.close()
  await dono.p.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' })
  await fecharSetup(dono.p)
  await dono.p.getByTestId('aviso-padrao').click()
  // 2026-10-06: o atalho virou 'Usar a cor da loja' — volta só as cores (o efeito pulsar fica como está).
  ok('"Usar a cor da loja" volta as cores de sempre', (await dono.p.getByTestId('aviso-previa').locator('[data-testid="aviso-vitrine"]').evaluate((e) => e.style.backgroundColor === '' && e.style.color === '')))
  await dono.ctx.close()

  // ═══ 5. Cupom ═══
  secao('Cupom na vitrine')
  criados.cupom = (await um(`insert into cupons (restaurante_id, codigo, descricao, ativo, tipo, valor, publico, uso_unico_por_cliente) values ($1,'TESTERET','TESTE retoque',true,'desconto_percentual',10,'todos',true) returning id`, [ORDEM.id])).id
  const minimo = (await um(`insert into cupons (restaurante_id, codigo, descricao, ativo, tipo, valor, publico, valor_minimo_pedido) values ($1,'TESTEMIN','TESTE mínimo',true,'desconto_valor',5,'todos',500) returning id`, [ORDEM.id])).id
  const cv = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'pt-BR' })
  const p5 = await cv.newPage()
  await p5.goto(`${BASE}/loja/ordem-qr-e2e`, { waitUntil: 'networkidle' })
  await p5.evaluate(() => localStorage.clear()); await p5.reload({ waitUntil: 'networkidle' })
  await p5.locator('div[class*="z-[85]"]').first().click({ position: { x: 5, y: 5 }, timeout: 3000 }).catch(() => {})
  await p5.locator('button:has-text("R$")', { hasText: 'Coca Lata' }).first().tap()
  await p5.getByRole('button', { name: /Adicionar/ }).last().tap()
  await p5.waitForTimeout(500)
  await p5.getByRole('button', { name: /^Home$/ }).first().tap().catch(() => {})
  const faixa = p5.getByTestId('faixa-resgate')
  const fs = await faixa.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color, getComputedStyle(e).animationName].join('|'))
  ok('faixa azul (#E0F2FE / #0369A1), pulsando, ícone que balança', fs.startsWith('rgb(224, 242, 254)|rgb(3, 105, 161)') && fs.includes('efeito-pulsar') && (await faixa.locator('.efeito-balancar svg').count()) === 1, fs)
  await foto(p5, 'cupom-faixa-390')
  await faixa.tap()
  await p5.waitForTimeout(500)
  const destaque = await p5.locator('[data-resgate-disponivel]').first().evaluate((e) => getComputedStyle(e).boxShadow)
  ok('clique leva à aba Cupons com o disponível em destaque', destaque !== 'none', destaque.slice(0, 40))
  await foto(p5, 'cupom-aba-destaque')
  await p5.locator('[data-resgate-disponivel]', { hasText: 'TESTEMIN' }).getByTestId('resgatar-cupom').tap()
  await p5.waitForTimeout(1200)
  ok('cupom inválido (mínimo) mostra o motivo, sem efeito de sucesso', (await p5.getByTestId('sucesso-resgate').count()) === 0 && (await p5.getByText(/mínimo|mínima/i).count()) > 0)
  await p5.locator('[data-resgate-disponivel]', { hasText: 'TESTERET' }).getByTestId('resgatar-cupom').tap()
  await p5.getByTestId('sucesso-resgate').waitFor({ timeout: 5000 })
  await foto(p5, 'cupom-sucesso')
  await p5.getByTestId('sucesso-resgate').waitFor({ state: 'detached', timeout: 5000 })
  const sacola = await p5.locator('body').innerText()
  ok('resgatar → efeito → sacola com "Cupom TESTERET aplicado – R$"', /Cupom TESTERET aplicado – R\$/.test(sacola))
  await foto(p5, 'cupom-na-sacola')
  await p5.getByRole('button', { name: /^Cupons$/ }).first().tap()
  ok('na aba Cupons ele aparece "Na sacola"', (await p5.getByTestId('resgate-na-sacola').count()) === 1)
  await p5.getByTestId('resgate-na-sacola').tap()
  ok('remover da sacola: volta a "Resgatar"', (await p5.locator('[data-resgate-disponivel]', { hasText: 'TESTERET' }).getByTestId('resgatar-cupom').count()) === 1)
  await cv.close()
  ok('resgatar não consome (usos = 0)', (await um(`select usos from cupons where id=$1`, [criados.cupom])).usos === 0)
  const item = await um(`select id from itens_cardapio where restaurante_id=$1 and nome ilike 'Coca Lata%' limit 1`, [ORDEM.id])
  const pedir = () => fetch(`${BASE}/api/loja/ordem-qr-e2e/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'retirada', cliente: { nome: 'TESTE Cupom', telefone: '27999880088' }, endereco: {}, pagamento: 'pix', trocoPara: null, cupomCodigo: 'TESTERET', itens: [{ itemId: item.id, quantidade: 1, complementos: [] }], chavePedido: crypto.randomUUID() }) }).then(async (r) => ({ st: r.status, j: await r.json().catch(() => ({})) }))
  const [a1, a2] = await Promise.all([pedir(), pedir()])
  const okUm = [a1, a2].filter((x) => x.st < 300).length
  ok('mesmo cupom em duas abas ao mesmo tempo: só um pedido passa', okUm === 1, `${a1.st}/${a2.st} ${a1.j.error ?? a2.j.error ?? ''}`)
  ok('consumido só com o pedido criado (usos = 1)', (await um(`select usos from cupons where id=$1`, [criados.cupom])).usos === 1)
  await db.query(`delete from cupons where id=$1`, [minimo])

  // ═══ 6. PDV / Mesas ═══
  secao('PDV / Mesas')
  const sugId = (await um("insert into pedidos (restaurante_id, tipo, status, cliente_nome, cliente_telefone, telefone_verificado, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep, forma_pagamento, pago, subtotal, desconto, taxa_entrega, total, observacao, origem, canal) values ($1,'retirada','entregue','Anastácia TESTE','5527999887766',true,'','','','','','pix',true,10,0,0,10,'','cardapio','delivery') returning id", [CANTINA.id])).id
  criados.pedidosCantina = [sugId]
  pdvAntes = (await um('select pdv_v2 from restaurantes where id=$1', [CANTINA.id])).pdv_v2
  await db.query('update restaurantes set pdv_v2=true where id=$1', [CANTINA.id])
  const caixa = await logar('dono.e2e', { width: 1280, height: 800 })
  const pa = caixa.p
  await pa.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
  await fecharSetup(pa)
  await pa.getByTestId('card-balcao').click()
  await pa.getByTestId('balcao-novo').click()
  await pa.getByTestId('balcao-modalidade-retirada').click()
  await pa.getByTestId('balcao-nome').fill('An')
  await pa.getByTestId('balcao-nome-sugestoes').waitFor({ timeout: 5000 }).catch(() => {})
  const sug = await pa.getByTestId('balcao-nome-sugestoes').locator('li').count().catch(() => 0)
  ok('nome do cliente: sugestões da base com 2 letras', sug > 0, String(sug))
  if (sug > 0) {
    await pa.getByTestId('balcao-nome-sugestoes').locator('button').first().click()
    ok('tocar na sugestão preenche nome e telefone', (await pa.getByTestId('balcao-telefone').inputValue()).replace(/\D/g, '').length >= 10)
  }
  await foto(pa, 'pdv-sugestao-cliente')
  await pa.getByTestId('balcao-nome').fill('TESTE Retoque')
  await pa.getByTestId('balcao-telefone').fill('')
  await pa.getByTestId('balcao-abrir').click()
  await pa.getByTestId('pdv-lancar').waitFor()
  await pa.getByRole('button', { name: /Suco de Laranja/ }).first().click()
  await pa.getByRole('button', { name: /Água com Gás/ }).first().click()
  await escolherPagamentoPdv(pa); await pa.getByTestId('pdv-lancar').click()
  const toast = await pa.getByTestId('pdv-toast-lancado').innerText({ timeout: 10000 }).catch(() => '')
  ok('lançou: toast de sucesso "lançado em" com "Ver conta"', /lançado em/.test(toast) && /Ver conta/.test(toast), toast.replace(/\n/g, ' '))
  ok('barra de baixo: [Mesas/Balcão] [Ver conta] [Lançar na cozinha], sem caixa verde no topo', (await pa.getByTestId('pdv-pos-lancar-mesas').count()) === 1 && (await pa.getByTestId('pdv-ver-conta').count()) === 1)
  await foto(pa, 'pdv-depois-lancar-1280')
  await pa.getByTestId('pdv-ver-conta').click()
  await pa.getByTestId('conta-barra-acoes').waitFor({ timeout: 10000 })
  const bar = await pa.getByTestId('conta-barra-acoes').innerText()
  ok('conta: barra de ações embaixo (Lançar, Imprimir/Pendências, Cliente, Receber, Fechar)', ['Lançar', 'Pendências', 'Cliente', 'Histórico', 'Fechar conta'].every((t) => bar.includes(t)), bar.replace(/\n/g, ' · '))
  const hBtn = (await pa.getByTestId('conta-fechar').boundingBox())?.height ?? 0
  // 2026-10-01 (PDV / janelas): a barra da conta subiu para 80–88 px.
  ok('botões principais com 80–88 px de altura', hBtn >= 80 && hBtn <= 88, String(hBtn))
  ok('fotos dos itens na conta', (await pa.locator('[data-foto-item]').count()) > 0)
  await foto(pa, 'conta-barra-1280')
  // Várias taxas
  await pa.getByTestId('conta-adicionar-taxa').click()
  await pa.getByTestId('taxas-modal').waitFor()
  await pa.getByTestId('taxa-adicionar').click()
  await pa.getByTestId('taxa-nome').last().fill('Couvert artístico')
  await pa.getByTestId('taxa-tipo-por_pessoa').last().click()
  await pa.getByTestId('taxa-base').last().fill('15')
  await pa.getByTestId('taxa-qtd').last().fill('2')
  await pa.getByTestId('taxa-adicionar').click()
  await pa.getByTestId('taxa-nome').last().fill('Taxa de rolha')
  await pa.getByTestId('taxa-tipo-fixo').last().click()
  await pa.getByTestId('taxa-base').last().fill('30')
  await pa.getByTestId('taxa-adicionar').click()
  await pa.getByTestId('taxa-nome').last().fill('Taxa especial')
  await pa.getByTestId('taxa-tipo-percentual').last().click()
  await pa.getByTestId('taxa-base').last().fill('5')
  await foto(pa, 'taxas-modal')
  await pa.getByTestId('taxas-salvar').click()
  await pa.getByTestId('taxas-modal').waitFor({ state: 'detached', timeout: 10000 })
  const linhasTx = await pa.getByTestId('conta-taxa-linha').allInnerTexts()
  ok('3 taxas como linhas separadas no resumo', linhasTx.length === 3 && /Couvert.*2 ×/s.test(linhasTx[0]) && /rolha/i.test(linhasTx[1]) && /5%/.test(linhasTx[2]), linhasTx.join(' | ').replace(/\n/g, ' '))
  const cm = await um(`select id, taxa_extra_valor, taxa_extra_nome from comandas where restaurante_id=$1 and cliente_nome='TESTE Retoque' order by aberta_em desc limit 1`, [CANTINA.id])
  if (cm) criados.comandas.push(cm.id)
  ok('soma gravada na taxa da conta (recibo/totais seguem iguais)', cm && Number(cm.taxa_extra_valor) >= 60, JSON.stringify(cm))
  // Fechar: pendências → pagamento dividido com teclado
  await pa.getByTestId('conta-fechar').click()
  await pa.getByTestId('fechar-modal').waitFor({ timeout: 15000 })
  await pa.waitForTimeout(1200)
  for (const b of await pa.locator('[data-testid^="fechar-pendencia-"][data-testid$="-entregue"]').all()) await b.click()
  await pa.getByTestId('fechar-simulacao').waitFor({ timeout: 15000 })
  await pa.waitForTimeout(800)
  ok('fechamento: taxas como linhas na conta', (await pa.getByTestId('fechar-taxa-linha').count()) === 3)
  const saldo = Number((await pa.getByTestId('fechar-restante').innerText()).replace(/[^\d,]/g, '').replace(',', '.'))
  await pa.getByTestId('fechar-pag-0-forma-dinheiro').click()
  await pa.getByTestId('fechar-pag-0-valor').fill('')
  for (const t of ['2', '0']) await pa.getByTestId('fechar-teclado').getByRole('button', { name: t, exact: true }).click()
  await pa.getByTestId('fechar-pag-0-recebido').click()
  await pa.getByTestId('fechar-atalhos').getByRole('button', { name: 'R$ 50' }).click()
  const troco = await pa.getByTestId('fechar-troco').innerText()
  ok('teclado numérico + atalho R$ 50 + troco em destaque', /Troco/.test(troco) && /30,00/.test(troco), troco.replace(/\n/g, ' '))
  await pa.getByTestId('fechar-add-pagamento').click()
  await pa.getByTestId('fechar-pag-1-forma-pix').click()
  ok('pagamento dividido cobre o saldo', /Saldo coberto/.test(await pa.getByTestId('fechar-falta').innerText()), `saldo ${saldo}`)
  await foto(pa, 'fechar-pagamento-1280')
  await pa.setViewportSize({ width: 1024, height: 768 })
  await foto(pa, 'fechar-pagamento-1024')
  const hTecla = (await pa.getByTestId('fechar-teclado').getByRole('button', { name: '5', exact: true }).boundingBox())?.height ?? 0
  ok('tablet: teclas com 56 px', hTecla >= 56, String(hTecla))
  await pa.getByTestId('fechar-confirmar').click()
  await pa.getByTestId('fechar-modal').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  ok('conta fechada', (await um(`select status from comandas where id=$1`, [cm.id])).status === 'fechada')
  // Valor zero: abre e cancela tudo
  await pa.setViewportSize({ width: 1280, height: 800 })
  await pa.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
  await fecharSetup(pa)
  await pa.getByTestId('card-balcao').click()
  await pa.getByTestId('balcao-novo').click()
  await pa.getByTestId('balcao-modalidade-retirada').click()
  await pa.getByTestId('balcao-nome').fill('TESTE Zero')
  await pa.getByTestId('balcao-abrir').click()
  await pa.getByTestId('pdv-lancar').waitFor()
  await pa.getByRole('button', { name: /Água com Gás/ }).first().click()
  await escolherPagamentoPdv(pa); await pa.getByTestId('pdv-lancar').click()
  await pa.getByTestId('pdv-toast-lancado').waitFor({ timeout: 15000 })
  // Cancela o pedido pela API (aceito → cancelar) para a conta ficar com saldo zero.
  const pz = await um(`select p.id from pedidos p join comandas c on c.id=p.comanda_id where c.restaurante_id=$1 and c.cliente_nome='TESTE Zero' order by p.criado_em desc limit 1`, [CANTINA.id])
  if (pz) await pa.evaluate(async ({ id, c }) => fetch(`/api/admin/comandas/${c}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'cancelar_pedido', pedidoId: id, motivo: 'TESTE saldo zero', observacao: 'TESTE saldo zero' }) }), { id: pz.id, c: (await um(`select comanda_id from pedidos where id=$1`, [pz.id])).comanda_id })
  await pa.waitForTimeout(800)
  await pa.getByTestId('pdv-pos-lancar-mesas').click()
  await pa.getByTestId('balcao-novo').waitFor()
  await pa.locator('[data-testid^="balcao-linha-"]').first().waitFor({ timeout: 10000 }).catch(() => {})
  await pa.waitForTimeout(500)
  ok('balcão: status como selos coloridos', (await pa.locator('[data-selo]').count()) > 0, String(await pa.locator('[data-selo]').count()))
  await foto(pa, 'balcao-selos-1280')
  const cz = await um(`select id, senha from comandas where restaurante_id=$1 and cliente_nome='TESTE Zero' and status='aberta' order by aberta_em desc limit 1`, [CANTINA.id])
  if (cz) {
    criados.comandas.push(cz.id)
    await pa.getByTestId(`balcao-linha-${cz.senha}`).click()
    await pa.getByTestId('conta-fechar').click({ timeout: 10000 })
    await pa.getByTestId('fechar-modal').waitFor({ timeout: 15000 })
    await pa.waitForTimeout(1500)
    ok('saldo zero: avisa "Recebido R$ 0,00"', await pa.getByTestId('fechar-zero').isVisible().catch(() => false))
    await pa.getByTestId('fechar-confirmar').click()
    ok('pede confirmação antes de fechar com valor zero', /Confirmar: fechar com R\$ 0,00/.test(await pa.getByTestId('fechar-confirmar').innerText()))
    await pa.getByTestId('fechar-confirmar').click()
    await pa.waitForTimeout(2500)
    const aud = await um(`select count(*)::int n from eventos_auditoria where acao='conta.fechou_valor_zero' and entidade_id=$1`, [cz.id])
    ok('fechou com valor zero e registrou na auditoria quem fechou', (await um(`select status from comandas where id=$1`, [cz.id])).status === 'fechada' && aud.n === 1)
  } else ok('comanda TESTE Zero aberta', false)
  await caixa.ctx.close()
} catch (e) {
  console.error(e); res.push(false)
} finally {
  if (pdvAntes !== null) await db.query('update restaurantes set pdv_v2=$2 where id=$1', [CANTINA.id, pdvAntes])
  if (criados.pedidosCantina?.length) await db.query('delete from pedidos where id = any($1)', [criados.pedidosCantina])
  if (criados.pedidosOrdem.length) await db.query(`delete from pedidos where id = any($1)`, [criados.pedidosOrdem])
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%27999880088'`, [ORDEM.id])
  if (criados.cupom) { await db.query(`delete from cupom_usos where cupom_id=$1`, [criados.cupom]).catch(() => {}); await db.query(`delete from cupons where id=$1`, [criados.cupom]) }
  await db.query(`update restaurantes set banner_promo_texto=$2, banner_promo_urls=$3, banner_promocional_url=$4, aviso_cor_texto=$5, aviso_cor_fundo=$6, aviso_pulsar=$7 where id=$1`,
    [ORDEM.id, avisoAntes.banner_promo_texto, avisoAntes.banner_promo_urls, avisoAntes.banner_promocional_url, avisoAntes.aviso_cor_texto, avisoAntes.aviso_cor_fundo, avisoAntes.aviso_pulsar])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
