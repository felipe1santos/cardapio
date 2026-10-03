/**
 * E2E — PDV/Mesas: janelas sobre a tela, Lançar itens, Configurar item, sabores da pizza e
 * botões maiores (2026-10-01). Servidor e banco LOCAIS, loja isolada; semeia pizzas e um açaí
 * "TESTE" e apaga tudo no fim.
 *
 *   E2E_LOJA=cantina-e2e E2E_VIZINHA=vizinha-e2e E2E_SUFIXO=e2e node scripts/seguranca/e2e-pdv-janelas.mjs [pasta-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
import { E2E_LOJA, USU, exigirLojaIsolada } from './e2e-ambiente.mjs'

/** Balcão (0135): forma de pagamento antes de lançar — "Dinheiro, sem troco", o que o sistema gravava antes. */
async function escolherPagamentoPdv(p) {
  await p.waitForTimeout(500)
  const bloco = p.getByTestId('pdv-pagamento')
  if (!(await bloco.isVisible().catch(() => false))) return
  await p.getByTestId('pdv-pag-dinheiro').click()
  await p.getByTestId('pdv-troco-nao').click()
}

exigirLojaIsolada()
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
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
const foto = async (p, nome) => { if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`) }) }

const loja = await um(`select id, pdv_v2, pizza_calculo_preco from restaurantes where slug=$1`, [E2E_LOJA])
// Meio a meio pela regra da loja: média (72,50) ou maior (75,00) de Calabresa 70 + Portuguesa 75.
const MEIO = loja.pizza_calculo_preco === 'maior' ? 75 : 72.5
const MEIO_TXT = MEIO.toFixed(2).replace('.', ',')
const L = loja.id

// ── semente ─────────────────────────────────────────────────────────────────
async function limpar() {
  await db.query(`update comandas set status='cancelada', cancelada_motivo='TESTE janelas', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [L])
  await db.query(`update mesas set limpeza_desde=null, limpeza_comanda_id=null, bloqueada_em=null where restaurante_id=$1`, [L])
  await db.query(`delete from itens_cardapio where restaurante_id=$1 and nome like 'TESTE %'`, [L])
  await db.query(`delete from grupos_cardapio where restaurante_id=$1 and nome = 'TESTE Janelas'`, [L])
  await db.query(`delete from tamanhos_padrao_pizza where restaurante_id=$1 and nome like 'TESTE %'`, [L])
}
await limpar()
await db.query(`update restaurantes set pdv_v2=true, modulo_mesas_ativo=true, status_loja='aberto_manual' where id=$1`, [L])
const grupoCard = (await um(`insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1,'TESTE Janelas',0) returning id`, [L])).id
const tamG = (await um(`insert into tamanhos_padrao_pizza (restaurante_id, nome, posicao, max_sabores) values ($1,'TESTE G',10,1) returning id`, [L])).id
const tamGG = (await um(`insert into tamanhos_padrao_pizza (restaurante_id, nome, posicao, max_sabores) values ($1,'TESTE GG',11,2) returning id`, [L])).id
const item = async (nome, preco, tipo = 'pizza') => (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, status, tipo_item) values ($1,$2,$3,$4,'disponivel',$5) returning id`, [L, grupoCard, nome, preco, tipo])).id
const sabor = async (itemId, nome, precos, status = 'disponivel') => {
  const s = (await um(`insert into pizza_sabores (item_id, nome, status) values ($1,$2,$3) returning id`, [itemId, nome, status])).id
  for (const [t, p] of precos) await db.query(`insert into pizza_sabor_precos (sabor_id, tamanho_padrao_id, preco) values ($1,$2,$3)`, [s, t, p])
}
const pzCal = await item('TESTE Pizza Calabresa', 0)
await sabor(pzCal, 'Calabresa', [[tamG, 50], [tamGG, 70]])
await sabor(pzCal, 'Portuguesa', [[tamG, 55], [tamGG, 75]])
await sabor(pzCal, 'Atum', [[tamG, 52], [tamGG, 72]], 'pausado')
const pzSem = await item('TESTE Pizza Sem Sabor', 39)
const pzBrot = await item('TESTE Pizza Brotinho', 49)
await sabor(pzBrot, 'Brot Frango', [])
await sabor(pzBrot, 'Brot Milho', [])
const acai = await item('TESTE Açaí 500 mL', 20, 'simples')
const gFrutas = (await um(`insert into grupos_item_complementos (item_id, nome, obrigatorio, min_escolhas, max_escolhas, permite_quantidade, posicao) values ($1,'Frutas',true,1,0,true,0) returning id`, [acai])).id
const gCalda = (await um(`insert into grupos_item_complementos (item_id, nome, obrigatorio, min_escolhas, max_escolhas, permite_quantidade, posicao) values ($1,'Calda',false,0,1,false,1) returning id`, [acai])).id
await db.query(`insert into grupos_item_complementos (item_id, nome, obrigatorio, min_escolhas, max_escolhas, permite_quantidade, posicao) values ($1,'Vazio obrigatório',true,1,1,false,2)`, [acai])
for (const [g, n, p] of [[gFrutas, 'Banana', 2], [gFrutas, 'Morango', 3], [gCalda, 'Chocolate', 1.5], [gCalda, 'Leite condensado', 2]]) {
  await db.query(`insert into item_complementos (item_id, grupo_id, nome, preco) values ($1,$2,$3,$4)`, [acai, g, n, p])
}
await db.query(`insert into item_complementos (item_id, grupo_id, nome, preco, pausado) values ($1,$2,'Kiwi (pausado)',4,true)`, [acai, gFrutas])

const browser = await chromium.launch()
async function logar(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', USU.dono)
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: /ok, entendi/i }).click({ timeout: 2000 }).catch(() => {})
  return p
}
const telas = (p) => p.evaluate(() => [...document.querySelectorAll('[data-tela-pdv]')].map((t) => ({
  testid: t.getAttribute('data-testid'), tamanho: t.getAttribute('data-tamanho'), coberta: t.hasAttribute('data-coberta'),
  fundo: getComputedStyle(t).backgroundColor, visivel: getComputedStyle(t).visibility,
})))
const caixa = (loc) => loc.boundingBox()
const cruza = (a, b) => a && b && !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)

try {
  const p = await logar({ width: 1366, height: 768 })
  // ════════════════════════════════════════════════════════════════════════
  secao('1. Grade → mesa livre (janela por cima) → Lançar itens')
  ok('botão flutuante do atendimento não aparece no PDV', (await p.getByTestId('atendimento-lancador').count()) === 0)
  const mesa = await um(`select m.nome from mesas m where m.restaurante_id=$1 and m.ativa and m.bloqueada_em is null and not exists (select 1 from comandas c where c.mesa_id=m.id and c.status='aberta') order by m.ordem limit 1`, [L])
  await p.getByRole('button', { name: new RegExp(mesa.nome) }).first().click()
  await p.getByTestId('mesa-nome').waitFor()
  let t = await telas(p)
  ok('abrir mesa: janela GRANDE com o fundo escurecido e à vista (não opaco)', t.length === 1 && t[0].tamanho === 'grande' && /rgba\(0, 0, 0, 0\.5\)/.test(t[0].fundo), JSON.stringify(t[0]))
  await foto(p, '01-abrir-mesa-sobre-grade')
  await p.getByTestId('mesa-nome').fill('TESTE Janelas')
  await p.getByTestId('mesa-abrir').click()
  await p.getByTestId('pdv-lancar').waitFor()

  // ════════════════════════════════════════════════════════════════════════
  secao('2. Lançar itens: categorias + busca numa linha, barra de baixo')
  const linha = p.getByTestId('pdv-linha-filtros')
  const cat = await caixa(p.getByTestId('pdv-categorias'))
  const busca = await caixa(p.getByTestId('pdv-busca'))
  ok('categorias à esquerda e busca à direita na MESMA linha', cat && busca && Math.abs((cat.y + cat.height / 2) - (busca.y + busca.height / 2)) < 6 && busca.x > cat.x, `cat y=${cat?.y} busca y=${busca?.y}`)
  ok('busca com 280–340 px', busca.width >= 280 && busca.width <= 340, Math.round(busca.width))
  const chip = await caixa(p.getByTestId('pdv-categorias').getByRole('button').first())
  ok('botões de categoria e busca com ~52 px', Math.round(chip.height) === 52 && Math.round(busca.height) === 52, `${chip.height} / ${busca.height}`)
  await p.getByTestId('pdv-categorias').getByRole('button', { name: 'Bebidas' }).click()
  await p.getByTestId('pdv-busca').fill('TESTE Pizza')
  await esperar(300)
  const achados = await p.getByRole('button', { name: /Adicionar TESTE Pizza/ }).count()
  ok('busca procura em todas as categorias (com "Bebidas" escolhida)', achados === 3, achados)
  await p.getByTestId('pdv-busca-limpar').click()
  const yAntes = (await caixa(linha)).y
  await p.locator('.overflow-y-auto').filter({ has: p.getByRole('button', { name: /^Adicionar / }) }).first().evaluate((el) => el.scrollBy(0, 400))
  ok('linha de filtros fica fixa ao rolar os produtos', Math.abs((await caixa(linha)).y - yAntes) < 1)
  const lancarBtn = await caixa(p.getByTestId('pdv-lancar'))
  ok('barra de baixo com 80–88 px', lancarBtn.height >= 80 && lancarBtn.height <= 88, Math.round(lancarBtn.height))
  await foto(p, '02-lancar-itens')

  // ════════════════════════════════════════════════════════════════════════
  secao('3. Configurar item (açaí): fotos, obrigatórios, contador, total ao vivo')
  await p.getByTestId('pdv-busca').fill('TESTE Açaí')
  await p.getByRole('button', { name: /Adicionar TESTE Açaí/ }).click()
  await p.getByTestId('configurar-item').waitFor()
  t = await telas(p)
  ok('Configurar item abre por cima do Lançar itens (fundo à vista)', t.length === 1 && t[0].testid === 'configurar-item' && /0\.5/.test(t[0].fundo))
  ok('opções com miniatura (foto ou ícone neutro)', (await p.getByTestId('configurar-item').locator('[data-config-opcao] [data-foto-item]').count()) >= 4)
  ok('opção pausada não aparece', (await p.getByText('Kiwi (pausado)').count()) === 0)
  ok('grupo obrigatório sem opções não aparece nem trava', (await p.locator('[data-config-grupo="Vazio obrigatório"]').count()) === 0)
  const btn = p.getByTestId('config-adicionar')
  ok('falta obrigatório: botão diz o que falta', /Escolha: Frutas/.test(await btn.innerText()))
  await btn.click()
  await esperar(500)
  ok('tocar com pendência destaca o grupo pendente', (await p.locator('[data-config-grupo="Frutas"].ring-2').count()) === 1)
  await foto(p, '03-configurar-acai-pendente')
  const banana = p.locator('[data-config-opcao="Banana"]')
  await banana.getByRole('button', { name: 'Mais Banana' }).click()
  await banana.getByRole('button', { name: 'Mais Banana' }).click()
  ok('contador da opção (Banana × 2)', (await banana.locator('[data-config-opcao-qtd]').innerText()) === '2')
  await p.locator('[data-config-opcao="Chocolate"]').click()
  await p.getByRole('button', { name: 'Aumentar quantidade' }).click()
  const txt = await btn.innerText()
  // (20 + 2×2 + 1,50) × 2 = 51,00
  ok('total ao vivo: "Adicionar · R$ 51,00" (quantidade 2)', /Adicionar · R\$\s?51,00/.test(txt), txt)
  await foto(p, '04-configurar-acai-pronto')
  await btn.click()
  await p.getByTestId('configurar-item').waitFor({ state: 'detached' })
  ok('volta ao Lançar itens com toast', /adicionado ao pedido/.test(await p.getByTestId('pdv-toast-lancado').innerText().catch(() => '')))

  // ════════════════════════════════════════════════════════════════════════
  secao('4. Pizza: sabores por tamanho, sabor do produto, sem sabores, preço do item')
  await p.getByTestId('pdv-busca').fill('TESTE Pizza')
  await p.getByRole('button', { name: /Adicionar TESTE Pizza Calabresa/ }).click()
  await p.locator('[data-config-tamanho="TESTE G"]').click()
  const sabores = await p.locator('[data-config-sabor]').evaluateAll((els) => els.map((e) => e.getAttribute('data-config-sabor')))
  ok('tamanho G: sabores ativos com preço (Atum pausado fora)', JSON.stringify(sabores) === '["Calabresa","Portuguesa"]', JSON.stringify(sabores))
  ok('sabor do produto ("Pizza Calabresa") já vem marcado', (await p.locator('[data-config-sabor="Calabresa"].border-primary').count()) === 1)
  ok('preço R$ 50,00 no G', /R\$\s?50,00/.test(await p.getByTestId('config-adicionar').innerText()))
  await p.locator('[data-config-tamanho="TESTE GG"]').click()
  await p.locator('[data-config-sabor="Portuguesa"]').click()
  ok('GG meio a meio (até 2): Calabresa + Portuguesa, preço pela regra da loja', new RegExp(`Adicionar · R\\$\\s?${MEIO_TXT}`).test(await p.getByTestId('config-adicionar').innerText()), await p.getByTestId('config-adicionar').innerText())
  await foto(p, '05-pizza-meio-a-meio')
  await p.getByTestId('config-adicionar').click()
  await p.getByRole('button', { name: /Adicionar TESTE Pizza Sem Sabor/ }).click()
  await p.locator('[data-config-tamanho="TESTE G"]').click()
  ok('pizza sem sabores: aviso e sem travar ("Este tamanho não tem sabores cadastrados")', await p.locator('[data-config-sem-sabores]').isVisible() && !(await p.getByTestId('config-adicionar').getAttribute('data-pendente')))
  ok('sai pelo preço do item (R$ 39,00)', /R\$\s?39,00/.test(await p.getByTestId('config-adicionar').innerText()))
  await foto(p, '06-pizza-sem-sabores')
  await p.getByTestId('config-adicionar').click()
  await p.getByRole('button', { name: /Adicionar TESTE Pizza Brotinho/ }).click()
  await p.locator('[data-config-tamanho="TESTE G"]').click()
  ok('pizza sem preço por sabor (Brotinho): sabores com o preço do item', (await p.locator('[data-config-sabor]').count()) === 2 && /R\$\s?49,00/.test(await p.locator('[data-config-sabor="Brot Frango"]').innerText()))
  await p.locator('[data-config-sabor="Brot Milho"]').click()
  await p.getByTestId('config-adicionar').click()
  await p.getByTestId('configurar-item').waitFor({ state: 'detached' })

  await escolherPagamentoPdv(p); await p.getByTestId('pdv-lancar').click()
  await p.getByText(/lançado em/).first().waitFor({ timeout: 15000 })
  await esperar(800)
  const itens = await q(`select pi.nome, pi.sabor_nome, pi.tamanho_nome, pi.preco_unitario, pi.quantidade, pi.complementos from pedido_itens pi join pedidos pe on pe.id=pi.pedido_id join comandas c on c.id=pe.comanda_id where c.restaurante_id=$1 and c.cliente_nome='TESTE Janelas' and c.status='aberta' order by pi.nome`, [L])
  const por = Object.fromEntries(itens.map((i) => [i.nome, i]))
  ok('cozinha recebeu o açaí ×2 com Banana ×2 e Chocolate (R$ 25,50 cada)', por['TESTE Açaí 500 mL']?.quantidade === 2 && Number(por['TESTE Açaí 500 mL']?.preco_unitario) === 25.5, JSON.stringify(por['TESTE Açaí 500 mL']))
  ok(`pizza meio a meio gravada "Calabresa / Portuguesa" (R$ ${MEIO_TXT}, regra ${loja.pizza_calculo_preco})`, por['TESTE Pizza Calabresa']?.sabor_nome === 'Calabresa / Portuguesa' && Number(por['TESTE Pizza Calabresa']?.preco_unitario) === MEIO)
  ok('pizza sem sabores gravada sem sabor, R$ 39,00', por['TESTE Pizza Sem Sabor']?.sabor_nome === '' && Number(por['TESTE Pizza Sem Sabor']?.preco_unitario) === 39)
  ok('brotinho gravada com o sabor e R$ 49,00', por['TESTE Pizza Brotinho']?.sabor_nome === 'Brot Milho' && Number(por['TESTE Pizza Brotinho']?.preco_unitario) === 49)

  // ════════════════════════════════════════════════════════════════════════
  secao('5. Ver conta por cima; Desconto e Taxas como janela pequena; pílulas')
  const verConta = p.getByTestId('pdv-ver-conta')
  const selo = await caixa(p.getByTestId('pdv-ver-conta-total'))
  const icone = await caixa(verConta.locator('svg'))
  const texto = await verConta.evaluate((b) => { const r = document.createRange(); const n = [...b.childNodes].find((x) => x.nodeType === 3 && x.textContent.trim()); r.selectNode(n); const c = r.getBoundingClientRect(); return { x: c.x, y: c.y, width: c.width, height: c.height } })
  ok('selo do "Ver conta" não cobre ícone nem texto', !cruza(selo, icone) && !cruza(selo, texto), JSON.stringify({ selo, icone }))
  await verConta.click()
  await p.getByTestId('conta-tela').waitFor()
  t = await telas(p)
  ok('Conta abre por cima do Lançar itens (fundo à vista)', t.length === 1 && /0\.5/.test(t[0].fundo))
  const barraBtn = await caixa(p.getByTestId('conta-lancar'))
  const receberBtn = await caixa(p.getByTestId('conta-receber'))
  ok('barra da conta com 80–88 px (ações, Receber)', barraBtn.height >= 80 && barraBtn.height <= 88 && receberBtn.height >= 80 && receberBtn.height <= 88, `${Math.round(barraBtn.height)} / ${Math.round(receberBtn.height)}`)
  ok('"Lançar itens" grande na coluna da direita', (await caixa(p.getByTestId('conta-lancar-grande'))).height >= 64)
  ok('taxa de serviço em pílula azul', /rgb\(3, 105, 161\)/.test(await p.getByTestId('conta-taxa-servico').evaluate((e) => getComputedStyle(e).color)))
  await p.getByTestId('conta-ajustar').click()
  await p.getByText('Desconto e taxa de serviço').last().waitFor()
  t = await telas(p)
  const conta = t.find((x) => x.testid === 'conta-tela')
  ok('Desconto: janela pequena SOBRE a conta (a conta continua à vista)', t.at(-1).tamanho === 'pequena' && conta && !conta.coberta && conta.visivel === 'visible', JSON.stringify(t))
  await esperar(400)
  await foto(p, '07-desconto-sobre-conta')
  const pequena = p.locator('[data-tamanho="pequena"]').last()
  await pequena.getByRole('button', { name: /Desconto em %/ }).click()
  await pequena.locator('input').nth(1).fill('10')
  await pequena.locator('input').nth(2).fill('TESTE cortesia')
  await pequena.getByRole('button', { name: /Salvar/ }).click()
  await p.getByTestId('conta-desconto').waitFor({ timeout: 10000 })
  ok('desconto em pílula verde "Desconto (10%) − R$"', /Desconto \(10%\)[\s\S]*−\s?R\$/.test(await p.getByTestId('conta-desconto').innerText()) && /rgb\(26, 167, 100\)/.test(await p.getByTestId('conta-desconto').evaluate((e) => getComputedStyle(e).color)))
  await p.getByTestId('conta-adicionar-taxa').click()
  await p.getByTestId('taxas-modal').waitFor()
  t = await telas(p)
  ok('Taxas: janela pequena sobre a conta', t.at(-1).testid === 'taxas-modal' && t.at(-1).tamanho === 'pequena' && !t.find((x) => x.testid === 'conta-tela').coberta)
  await p.getByTestId('taxa-atalho').first().click()
  await p.getByTestId('taxas-salvar').click()
  await p.getByTestId('taxas-modal').waitFor({ state: 'detached', timeout: 10000 })
  await p.getByTestId('conta-taxa-linha').first().waitFor()
  ok('taxa (couvert) em pílula azul com o detalhe', /Couvert/.test(await p.getByTestId('conta-taxa-linha').first().innerText()))
  await foto(p, '08-conta-pilulas')
  await p.getByTestId('conta-taxa-linha-remover').first().click()
  await p.getByTestId('conta-remover-ajuste').waitFor()
  ok('remover pede confirmação (janela pequena)', (await telas(p)).at(-1).tamanho === 'pequena')
  await p.getByTestId('conta-remover-confirmar').click()
  await p.getByTestId('conta-taxa-linha').waitFor({ state: 'detached', timeout: 10000 })
  ok('taxa removida da conta', (await p.getByTestId('conta-taxa-linha').count()) === 0)

  // ════════════════════════════════════════════════════════════════════════
  secao('6. Receber (substitui a conta) → Voltar → Fechar conta')
  await p.getByTestId('conta-cupom-codigo').fill('PRESERVA')
  await p.getByTestId('conta-receber').click()
  await p.getByTestId('receber-tela').waitFor()
  t = await telas(p)
  ok('Receber: a conta some na hora (uma janela grande por vez)', t.find((x) => x.testid === 'conta-tela')?.coberta === true && t.at(-1).testid === 'receber-tela')
  ok('Receber mostra desconto/taxas nas mesmas cores', (await p.getByTestId('receber-ajustes').locator('[data-ajuste="desconto"]').count()) === 1)
  await p.keyboard.press('Escape')
  await p.getByTestId('receber-tela').waitFor({ state: 'detached' })
  ok('Voltar (Esc): a conta volta igual (cupom digitado)', (await p.getByTestId('conta-cupom-codigo').inputValue()) === 'PRESERVA')
  await p.getByTestId('conta-fechar').click()
  await p.getByTestId('fechar-modal').waitFor()
  const ent = p.locator('[data-testid^="fechar-pendencia-"][data-testid$="-entregue"]')
  await ent.first().waitFor({ timeout: 8000 }).catch(() => {})
  for (let i = 0, n = await ent.count(); i < n; i++) await ent.nth(i).click()
  await p.getByTestId('fechar-restante-topo').waitFor({ timeout: 15000 })
  ok('Fechar conta mostra o desconto em verde', (await p.getByTestId('fechar-desconto').count()) === 1)
  await p.getByTestId('fechar-pag-0-forma-pix').click()
  await p.getByTestId('fechar-atalhos').getByRole('button', { name: 'Exato' }).click()
  await p.getByTestId('fechar-confirmar').click()
  await p.getByTestId('resumo-encerramento').waitFor({ timeout: 20000 })
  ok('conta fechada (resumo como janela pequena)', (await telas(p)).at(-1).tamanho === 'pequena')
  await p.getByTestId('resumo-encerramento').getByRole('button', { name: /Ok/ }).click()
  await esperar(600)
  ok('volta para a grade de mesas, sem janelas', (await telas(p)).length === 0)

  // ════════════════════════════════════════════════════════════════════════
  secao('7. Mesa ocupada → Conta por cima da grade; Conta › Lançar → Lançar itens')
  const outra = await um(`select m.nome from mesas m where m.restaurante_id=$1 and m.ativa and m.bloqueada_em is null and m.limpeza_desde is null and not exists (select 1 from comandas c where c.mesa_id=m.id and c.status='aberta') order by m.ordem limit 1`, [L])
  await p.getByRole('button', { name: new RegExp(outra.nome) }).first().click()
  await p.getByTestId('mesa-nome').fill('TESTE Janelas 2')
  await p.getByTestId('mesa-abrir').click()
  await p.getByTestId('pdv-lancar').waitFor()
  await p.getByTestId('pdv-pos-lancar-mesas').click()
  await p.getByRole('button', { name: new RegExp(outra.nome) }).first().click()
  await p.getByTestId('conta-tela').waitFor()
  ok('mesa ocupada: Conta abre por cima da grade', (await telas(p)).length === 1 && (await p.getByTestId('card-balcao').count()) === 1)
  await foto(p, '09-conta-sobre-grade')
  await p.getByTestId('conta-lancar-grande').click()
  await p.getByTestId('pdv-lancar').waitFor()
  ok('Conta › Lançar itens: fundo vira Lançar itens daquela mesa e a conta fecha', (await telas(p)).length === 0 && /TESTE Janelas 2/.test(await p.getByTestId('pdv-alvo').innerText()))
  await p.context().close()

  // ════════════════════════════════════════════════════════════════════════
  secao('8. Tamanhos de tela')
  for (const [w, h] of [[1024, 768], [1280, 800], [1920, 1080], [390, 844]]) {
    const r = await logar({ width: w, height: h })
    await r.getByRole('button', { name: new RegExp(outra.nome) }).first().click()
    await r.getByTestId('conta-tela').waitFor()
    await esperar(300)
    const m = await r.evaluate(() => {
      const barra = document.querySelector('[data-testid="conta-barra-acoes"]')?.getBoundingClientRect()
      const lanc = document.querySelector('[data-testid="atendimento-lancador"]')
      return { barraDentro: barra ? barra.bottom <= innerHeight + 1 : false, semRolagemLateral: document.documentElement.scrollWidth <= innerWidth, flutuante: !!lanc }
    })
    ok(`${w}×${h}: barra da conta à vista, sem rolagem lateral, sem botão flutuante`, m.barraDentro && m.semRolagemLateral && !m.flutuante, JSON.stringify(m))
    if (w === 390) await foto(r, '10-conta-celular')
    await r.context().close()
  }

  // ════════════════════════════════════════════════════════════════════════
  secao('9. Vitrine: a mesma regra dos sabores')
  const v = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR' })).newPage()
  await v.goto(`${BASE}/loja/${E2E_LOJA}`, { waitUntil: 'networkidle' })
  // Pop-up de cupom/convite da loja, se houver, sai da frente.
  const fecharPopup = () => v.getByRole('button', { name: 'Continuar no cardápio' }).click({ timeout: 3000 }).catch(() => {})
  await fecharPopup()
  // Loja no modo gaveta: abre a categoria antes.
  await v.getByText('TESTE Janelas').first().click().catch(() => {})
  const cartao = v.locator(`button[data-item-id="${pzBrot}"]`).first()
  await cartao.scrollIntoViewIfNeeded()
  await cartao.click()
  await v.getByRole('button', { name: /TESTE G(?!G)/ }).first().click()
  await esperar(500)
  ok('vitrine: Brotinho mostra os sabores com o preço do item', (await v.getByText('Brot Frango').count()) > 0 && (await v.getByText('R$ 49,00').count()) > 0 && (await v.getByText('Nenhum sabor disponível').count()) === 0)
  await foto(v, '11-vitrine-brotinho')
  await v.goto(`${BASE}/loja/${E2E_LOJA}`, { waitUntil: 'networkidle' })
  await fecharPopup()
  await v.getByText('TESTE Janelas').first().click().catch(() => {})
  const cartao2 = v.locator(`button[data-item-id="${pzSem}"]`).first()
  await cartao2.scrollIntoViewIfNeeded()
  await cartao2.click()
  await v.getByRole('button', { name: /TESTE G(?!G)/ }).first().click()
  await esperar(500)
  ok('vitrine: pizza sem sabores não trava (aviso, sem "Nenhum sabor disponível")', (await v.locator('[data-sem-sabores]').count()) === 1)
  await v.goBack().catch(() => {})
} catch (e) {
  console.error(e)
  res.push(false)
} finally {
  await limpar()
  await db.query(`update restaurantes set pdv_v2=$2 where id=$1`, [L, loja.pdv_v2])
  await browser.close()
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
