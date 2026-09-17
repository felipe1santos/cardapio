/**
 * Checkpoint da etapa E — tudo que precisa estar provado antes da etapa F.
 *
 *  1. o QR gerado no painel decodifica para /mesa/<token> e abre sem login;
 *  2. cardápio público: categorias, configurador, quantidade, observação, vários itens,
 *     resumo, nada de entrega/pagamento, F5 e duas abas;
 *  3. garçom vê a seleção como referência, lança à mão, envia — e o ciclo encerra;
 *  4. idempotência: clique duplo, reenvio, dois garçons, cliente mexendo no meio;
 *  5. garçom barrado por URL e por API;
 *  6. equipe: dono cadastra, desativa (sessão aberta cai), redefine senha, reativa.
 *
 * Só loopback. Precisa do servidor em BASE e da stack local.
 *   node scripts/seguranca/e2e-checkpoint-e.mjs
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)

// Decodificador de QR instalado FORA do projeto (scratchpad), só para esta prova.
const QRDIR = process.env.QRDIR
const requireQr = QRDIR ? createRequire(`${QRDIR}/package.json`) : null

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const mesa01 = await um(`select id, token from mesas where restaurante_id=$1 and nome='Mesa 01'`, [loja])
const item = async (nome) => (await um(`select id from itens_cardapio where restaurante_id=$1 and nome=$2`, [loja, nome])).id
const contarPedidos = async () => (await um(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja])).n
const selecoesAbertas = async () => q(`select id, versao, dispositivo from selecoes_mesa where mesa_id=$1 and encerrada_em is null order by atualizado_em`, [mesa01.id])

const browser = await chromium.launch()

async function logar(usuario, senha = SENHA) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'pt-BR' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', senha)
  // Espera a server action TERMINAR: ou foi para o painel, ou voltou ao login com erro.
  // `waitForLoadState` retornava antes do redirecionamento, e o teste seguia sem cookie.
  await Promise.all([
    page
      .waitForURL((u) => u.pathname.startsWith('/admin') || u.searchParams.has('error'), { timeout: 30000 })
      .catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForLoadState('networkidle').catch(() => {})
  return { ctx, page }
}

/** fetch DENTRO da sessão do navegador — cookie de verdade. */
const api = (page, url, metodo = 'GET', corpo) =>
  page.evaluate(
    async ({ url, metodo, corpo }) => {
      const r = await fetch(url, {
        method: metodo,
        headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
        body: corpo ? JSON.stringify(corpo) : undefined,
        redirect: 'manual',
      })
      let json = null
      try { json = await r.json() } catch { /* sem corpo */ }
      return { status: r.status, json }
    },
    { url, metodo, corpo },
  )

const lancamento = (itemId, chave, selecoesVistas = [], qtd = 1) => ({
  chaveIdempotencia: chave,
  selecoesVistas,
  itens: [{ itemId, quantidade: qtd, observacao: '', complementos: [] }],
})

const RISOTO = await item('Risoto de Funghi')
const AGUA = await item('Água com Gás')

// ════════════════════════════════════════════════════════════════════════════
secao('1. o QR leva mesmo à rota pública')
{
  const dono = await logar('dono.local')
  await dono.page.goto(`${BASE}/admin/mesas`, { waitUntil: 'networkidle' })
  const cartao = dono.page.locator('div.flex-col.rounded-menuzia', { has: dono.page.locator('span', { hasText: /^Mesa 01$/ }) })
  await cartao.locator('button[title="Ver QR Code"]').click()
  const img = dono.page.locator('img[alt="QR Code da Mesa 01"]')
  await img.waitFor({ timeout: 15000 })
  const dataUrl = await img.getAttribute('src')
  await dono.page.screenshot({ path: '.shots/checkpoint-01-qr-no-painel.png' })

  if (requireQr) {
    const jsQR = requireQr('jsqr')
    const { PNG } = requireQr('pngjs')
    const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'))
    const lido = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
    const url = lido?.data ?? ''
    ok('a imagem do QR decodifica', !!lido, url)
    ok('o QR aponta para /mesa/<token da Mesa 01>', url.endsWith(`/mesa/${mesa01.token}`), url)
    ok('o QR não carrega slug da loja nem id da mesa', !url.includes('cantina-demo') && !url.includes(mesa01.id))

    // Abre o destino DECODIFICADO, num navegador sem login.
    const anon = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' })
    const p = await anon.newPage()
    const resp = await p.goto(url.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle' })
    ok('destino do QR abre sem login (HTTP 200)', resp?.status() === 200, `HTTP ${resp?.status()}`)
    ok('é o cardápio da mesa, não o delivery', /\/mesa\/[0-9a-f-]{36}$/.test(p.url()) && (await p.locator('text=Mesa 01').count()) > 0, p.url())
    await anon.close()
  } else {
    ok('decodificador de QR disponível', false, 'defina QRDIR')
  }
  await dono.ctx.close()
}

// ════════════════════════════════════════════════════════════════════════════
secao('2. cardápio público, sem login')
const cliente = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR' })
const abaA = await cliente.newPage()
{
  await abaA.goto(`${BASE}/mesa/${mesa01.token}`, { waitUntil: 'networkidle' })
  ok('categorias visíveis', (await abaA.locator('.mesa-categoria').count()) >= 3, `${await abaA.locator('.mesa-categoria').count()} categorias`)
  ok('produtos visíveis', (await abaA.locator('.mesa-card').count()) > 0)
  await abaA.screenshot({ path: '.shots/checkpoint-02-cliente-celular-cardapio.png' })

  // Burger: obrigatórios + adicional + quantidade + observação.
  await abaA.locator('.mesa-categoria', { hasText: 'Burgers' }).click()
  await abaA.locator('text=Selecionar item').first().click()
  const avancar = abaA.locator('.mesa-avancar')
  ok('configurador abre na etapa obrigatória com AVANÇAR travado', (await avancar.getAttribute('class')).includes('ativo') === false)
  await abaA.screenshot({ path: '.shots/checkpoint-03-cliente-configurador.png' })
  await abaA.locator('.mesa-opcao', { hasText: 'Ao ponto' }).click()
  ok('escolhido o ponto, AVANÇAR libera', (await avancar.getAttribute('class')).includes('ativo'))
  await avancar.click()
  await abaA.locator('.mesa-opcao', { hasText: 'Bacon crocante' }).click()
  await avancar.click()
  await abaA.locator('.mesa-opcao', { hasText: 'Suco de laranja' }).click()
  await avancar.click()
  await abaA.locator('.mesa-qtd button[aria-label="Aumentar"]').click()
  await abaA.fill('.mesa-observacao textarea', 'sem cebola')
  await abaA.screenshot({ path: '.shots/checkpoint-04-cliente-quantidade-observacao.png' })
  await abaA.locator('.mesa-avancar', { hasText: 'Adicionar à seleção' }).click()
  await esperar(600)

  // Segundo produto.
  await abaA.locator('.mesa-categoria', { hasText: 'Bebidas' }).click()
  await abaA.locator('.mesa-card', { hasText: 'Água com Gás' }).locator('text=Selecionar item').click()
  await abaA.locator('.mesa-avancar', { hasText: 'Adicionar à seleção' }).click()
  await esperar(1200)

  await abaA.locator('.mesa-barra-flutuante').click()
  const linhas = await abaA.locator('.mesa-linha').count()
  ok('resumo mostra os dois produtos', linhas === 2, `${linhas} linha(s)`)
  const textoResumo = await abaA.locator('.mesa-painel').innerText()
  ok('resumo traz opções, quantidade e observação', textoResumo.includes('Bacon crocante') && textoResumo.includes('sem cebola'))
  await abaA.screenshot({ path: '.shots/checkpoint-05-cliente-resumo.png' })

  const paginaInteira = (await abaA.locator('body').innerText()).toLowerCase()
  for (const proibida of ['entrega', 'retirada', 'endereço', 'pagamento', 'pix', 'cartão', 'enviar pedido', 'finalizar', 'frete']) {
    ok(`sem "${proibida}" na tela do cliente`, !paginaInteira.includes(proibida))
  }
  ok('aviso de que nada foi enviado à cozinha', paginaInteira.includes('nada foi enviado para a cozinha'))
  await abaA.locator('.mesa-painel-topo button').click()

  const doBanco = await selecoesAbertas()
  const itensNoBanco = await q(`select nome_snapshot, quantidade, observacao from selecao_itens where selecao_id=$1 order by criado_em`, [doBanco[0]?.id])
  ok('seleção gravada como rascunho no servidor', itensNoBanco.length === 2, JSON.stringify(itensNoBanco))
  ok('seleção NÃO criou pedido nem comanda', (await um(`select count(*)::int n from comandas where mesa_id=$1`, [mesa01.id])).n === 0)
}

secao('2b. F5 e duas abas')
const abaB = await cliente.newPage()
{
  await abaA.reload({ waitUntil: 'networkidle' })
  await esperar(1500)
  ok('depois do F5 a seleção volta do servidor', (await abaA.locator('.mesa-barra-flutuante').innerText()).includes('3'), await abaA.locator('.mesa-barra-flutuante').innerText())

  await abaB.goto(`${BASE}/mesa/${mesa01.token}`, { waitUntil: 'networkidle' })
  await esperar(1500)
  ok('segunda aba do mesmo aparelho abre com a mesma seleção', (await abaB.locator('.mesa-barra-flutuante').innerText()).includes('3'))

  // Mexe na aba A; a aba B converge sozinha.
  await abaA.locator('.mesa-categoria', { hasText: 'Pratos' }).click()
  await abaA.locator('.mesa-card', { hasText: 'Risoto de Funghi' }).locator('text=Selecionar item').click()
  await abaA.locator('.mesa-avancar', { hasText: 'Adicionar à seleção' }).click()
  let sincronizou = false
  for (let i = 0; i < 16 && !sincronizou; i++) {
    await esperar(800)
    const t = await abaB.locator('.mesa-barra-flutuante').innerText().catch(() => '')
    sincronizou = t.includes('4')
  }
  ok('item marcado na aba A aparece na aba B', sincronizou)
}

// ════════════════════════════════════════════════════════════════════════════
secao('3. garçom: referência, lançamento manual, fim do ciclo')
const garcom = await logar('garcom.local')
let pedidoCiclo
{
  await garcom.page.goto(`${BASE}/admin/mesas/${mesa01.id}`, { waitUntil: 'networkidle' })
  await garcom.page.waitForSelector('text=Lançamento', { timeout: 20000 })
  const bloco = await garcom.page.locator('div.border-warn').innerText()
  ok('seleção aparece no bloco amarelo "Não lançado"', bloco.includes('NÃO LANÇADO') || bloco.includes('Não lançado'))
  ok('bloco mostra o que o cliente marcou', bloco.includes('Burger da Casa') && bloco.includes('Água com Gás') && bloco.includes('Risoto de Funghi'))
  await garcom.page.screenshot({ path: '.shots/checkpoint-06-garcom-selecao-referencia.png' })

  const antes = await contarPedidos()
  const abertasAntes = await selecoesAbertas()

  // O garçom lança À MÃO só a água — diferente da seleção inteira, de propósito.
  await garcom.page.locator('button', { hasText: 'Bebidas' }).first().click()
  await garcom.page.locator('button', { hasText: 'Água com Gás' }).first().click()
  await garcom.page.locator('button', { hasText: 'Enviar para a cozinha' }).click()
  await garcom.page.waitForSelector('h2:has-text("Pedido #")', { timeout: 30000 })
  for (let i = 0; i < 30 && (await contarPedidos()) === antes; i++) await esperar(300)
  await garcom.page.screenshot({ path: '.shots/checkpoint-07-garcom-enviado.png' })

  ok('o envio criou EXATAMENTE um pedido', (await contarPedidos()) === antes + 1, `${antes} → ${await contarPedidos()}`)
  pedidoCiclo = await um(`select id, numero, canal, comanda_id, impresso, criado_por_nome from pedidos where restaurante_id=$1 order by criado_em desc limit 1`, [loja])
  const itensPedido = await q(`select nome, quantidade from pedido_itens where pedido_id=$1`, [pedidoCiclo.id])
  ok('o pedido tem SÓ o que o garçom lançou (não importou a seleção)', itensPedido.length === 1 && itensPedido[0].nome === 'Água com Gás', JSON.stringify(itensPedido))
  const comanda = await um(`select mesa_id, status from comandas where id=$1`, [pedidoCiclo.comanda_id])
  ok('pedido entrou na comanda aberta da Mesa 01', comanda?.mesa_id === mesa01.id && comanda.status === 'aberta')
  ok('pedido está na fila de impressão (impresso=false)', pedidoCiclo.impresso === false)
  ok('pedido registra quem lançou', pedidoCiclo.criado_por_nome === 'Garçom Demo', pedidoCiclo.criado_por_nome)

  const encerradas = await q(`select id, encerrada_em from selecoes_mesa where id = any($1::uuid[])`, [abertasAntes.map((s) => s.id)])
  ok('a seleção antiga foi ENCERRADA (não apagada)', encerradas.length === abertasAntes.length && encerradas.every((s) => s.encerrada_em), `${encerradas.length} encerrada(s)`)
  ok('encerrar não apagou o pedido oficial', !!(await um(`select id from pedidos where id=$1`, [pedidoCiclo.id])))

  await garcom.page.locator('button', { hasText: 'Fechar' }).click()
  await esperar(800)
  const blocoDepois = await garcom.page.locator('div.border-warn').innerText()
  ok('no painel do garçom a seleção antiga sumiu', blocoDepois.includes('ainda não marcou'), blocoDepois.split('\n').slice(0, 2).join(' / '))

  // No celular do cliente: aviso + lista vazia, pela releitura periódica.
  let avisou = false
  for (let i = 0; i < 16 && !avisou; i++) {
    await esperar(800)
    avisou = (await abaA.locator('text=O garçom já anotou seu pedido').count()) > 0
  }
  ok('cliente é avisado de que o ciclo encerrou', avisou)
  await abaA.screenshot({ path: '.shots/checkpoint-08-cliente-ciclo-encerrado.png' })
  await abaA.locator('button', { hasText: 'Começar nova seleção' }).click().catch(() => {})
  ok('no cardápio público a seleção antiga sumiu', (await abaA.locator('.mesa-barra-flutuante').count()) === 0)

  ok('não sobrou rascunho aberto na mesa', (await selecoesAbertas()).length === 0)

  // Novo ciclo: o cliente marca de novo e nasce um rascunho NOVO.
  await abaA.locator('.mesa-categoria', { hasText: 'Pratos' }).click()
  await abaA.locator('.mesa-card', { hasText: 'Filé à Parmegiana' }).locator('text=Selecionar item').click()
  await abaA.locator('.mesa-avancar', { hasText: 'Adicionar à seleção' }).click()
  await esperar(1200)
  const novas = await selecoesAbertas()
  ok('surgiu um rascunho NOVO e aberto', novas.length === 1 && !abertasAntes.some((a) => a.id === novas[0].id), novas[0]?.id)
  const itensNovo = await q(`select nome_snapshot from selecao_itens where selecao_id=$1`, [novas[0]?.id])
  ok('o rascunho novo começou vazio e só tem o item novo', itensNovo.length === 1 && itensNovo[0].nome_snapshot === 'Filé à Parmegiana', JSON.stringify(itensNovo))
}

// ════════════════════════════════════════════════════════════════════════════
secao('4. idempotência e concorrência')
{
  // 4a. clique duplo: duas requisições idênticas disparadas juntas.
  const chave = crypto.randomUUID()
  const antes = await contarPedidos()
  const [r1, r2] = await Promise.all([
    api(garcom.page, `/api/admin/mesas/${mesa01.id}/lancamento`, 'POST', lancamento(RISOTO, chave)),
    api(garcom.page, `/api/admin/mesas/${mesa01.id}/lancamento`, 'POST', lancamento(RISOTO, chave)),
  ])
  ok('clique duplo: as duas respostas deram certo', [r1.status, r2.status].every((s) => s === 200 || s === 201), `${r1.status} / ${r2.status}`)
  ok('clique duplo: criou UM pedido só', (await contarPedidos()) === antes + 1, `${antes} → ${await contarPedidos()}`)
  ok('clique duplo: as duas apontam para o mesmo pedido', r1.json?.numero === r2.json?.numero, `#${r1.json?.numero} / #${r2.json?.numero}`)

  // 4b. reenvio depois do sucesso (retry de rede).
  const r3 = await api(garcom.page, `/api/admin/mesas/${mesa01.id}/lancamento`, 'POST', lancamento(RISOTO, chave))
  ok('reenvio devolve o mesmo pedido, marcado idempotente', r3.status === 200 && r3.json?.idempotente === true && r3.json?.numero === r1.json?.numero)
  ok('reenvio não criou pedido', (await contarPedidos()) === antes + 1)
}
{
  // 4c. dois garçons, MESMA chave (o mesmo lançamento chegou por dois caminhos).
  const dono = await logar('dono.local')
  const chave = crypto.randomUUID()
  const antes = await contarPedidos()
  const [a, b] = await Promise.all([
    api(garcom.page, `/api/admin/mesas/${mesa01.id}/lancamento`, 'POST', lancamento(AGUA, chave)),
    api(dono.page, `/api/admin/mesas/${mesa01.id}/lancamento`, 'POST', lancamento(AGUA, chave)),
  ])
  ok('dois garçons, mesma chave: um pedido só', (await contarPedidos()) === antes + 1, `${a.status}/${b.status}`)

  // 4d. dois garçons, lançamentos DIFERENTES, vendo a MESMA seleção ao mesmo tempo.
  const vistas = (await selecoesAbertas()).map((s) => ({ id: s.id, versao: s.versao }))
  const antes2 = await contarPedidos()
  const [c, d] = await Promise.all([
    api(garcom.page, `/api/admin/mesas/${mesa01.id}/lancamento`, 'POST', lancamento(AGUA, crypto.randomUUID(), vistas)),
    api(dono.page, `/api/admin/mesas/${mesa01.id}/lancamento`, 'POST', lancamento(RISOTO, crypto.randomUUID(), vistas)),
  ])
  ok('lançamentos diferentes viram dois pedidos (são dois pedidos de verdade)', (await contarPedidos()) === antes2 + 2)
  const somaEncerradas = (c.json?.selecoesEncerradas ?? 0) + (d.json?.selecoesEncerradas ?? 0)
  ok('a seleção compartilhada foi encerrada UMA vez, não duas', somaEncerradas === vistas.length, `encerradas: ${c.json?.selecoesEncerradas} + ${d.json?.selecoesEncerradas}`)

  // 4e. o cliente mexe na lista DEPOIS que o garçom abriu a tela.
  await abaA.locator('.mesa-categoria', { hasText: 'Bebidas' }).click()
  await abaA.locator('.mesa-card', { hasText: 'Suco de Laranja' }).locator('text=Selecionar item').click()
  await abaA.locator('.mesa-avancar', { hasText: 'Adicionar à seleção' }).click()
  await esperar(1200)
  const vistaAntiga = (await selecoesAbertas()).map((s) => ({ id: s.id, versao: s.versao }))
  // cliente adiciona mais um: a versão sobe
  await abaA.locator('.mesa-card', { hasText: 'Água com Gás' }).locator('text=Selecionar item').click()
  await abaA.locator('.mesa-avancar', { hasText: 'Adicionar à seleção' }).click()
  await esperar(1200)
  const atual = await selecoesAbertas()
  ok('a versão da seleção subiu com a mudança do cliente', atual[0]?.versao > vistaAntiga[0]?.versao, `${vistaAntiga[0]?.versao} → ${atual[0]?.versao}`)

  const e = await api(garcom.page, `/api/admin/mesas/${mesa01.id}/lancamento`, 'POST', lancamento(AGUA, crypto.randomUUID(), vistaAntiga))
  ok('garçom enviando com a versão velha cria o pedido', e.status === 201)
  ok('...mas NÃO encerra a seleção que o cliente mudou', e.json?.selecoesEncerradas === 0 && (await selecoesAbertas()).length === 1)

  // 4f. erro na criação não pode encerrar a seleção.
  const vistaAgora = (await selecoesAbertas()).map((s) => ({ id: s.id, versao: s.versao }))
  const antes3 = await contarPedidos()
  const f = await api(garcom.page, `/api/admin/mesas/${mesa01.id}/lancamento`, 'POST', {
    chaveIdempotencia: crypto.randomUUID(),
    selecoesVistas: vistaAgora,
    itens: [{ itemId: '00000000-0000-4000-8000-000000000000', quantidade: 1, observacao: '', complementos: [] }],
  })
  ok('envio com erro é recusado', f.status === 400, `HTTP ${f.status}`)
  ok('envio com erro não cria pedido', (await contarPedidos()) === antes3)
  ok('envio com erro NÃO encerra a seleção', (await selecoesAbertas()).length === 1)

  await dono.ctx.close()
}

// ════════════════════════════════════════════════════════════════════════════
secao('5. garçom digitando URL proibida')
{
  const PAGINAS = ['/admin/dashboard', '/admin/clientes', '/admin/ajustes', '/admin/pedidos', '/admin/pdv',
    '/admin/equipe', '/admin/cardapio', '/admin/campanhas', '/admin/fidelidade', '/admin/integracoes', '/admin/logistica']
  for (const rota of PAGINAS) {
    await garcom.page.goto(`${BASE}${rota}`, { waitUntil: 'domcontentloaded' })
    const final = new URL(garcom.page.url()).pathname
    ok(`${rota} → redireciona para /admin/mesas`, final === '/admin/mesas', final)
  }
  await garcom.page.screenshot({ path: '.shots/checkpoint-09-garcom-redirecionado.png' })

  const APIS = [
    ['/api/admin/equipe', 'GET'],
    ['/api/admin/pdv/pedido', 'POST'],
    ['/api/admin/pedidos/00000000-0000-4000-8000-000000000000/cancelar', 'POST'],
    ['/api/admin/campanhas', 'GET'],
    ['/api/admin/whatsapp/status', 'GET'],
    ['/api/admin/nexta/config', 'GET'],
  ]
  for (const [rota, metodo] of APIS) {
    const r = await api(garcom.page, rota, metodo, metodo === 'POST' ? {} : undefined)
    ok(`${metodo} ${rota} → 403`, r.status === 403, `HTTP ${r.status}`)
  }

  const anon = await browser.newContext()
  const pa = await anon.newPage()
  await pa.goto(`${BASE}/admin/mesas`, { waitUntil: 'domcontentloaded' })
  ok('sem login, /admin/mesas vai para o login', new URL(pa.url()).pathname === '/login', new URL(pa.url()).pathname)
  const ra = await pa.request.post(`${BASE}/api/admin/mesas/${mesa01.id}/lancamento`, { data: {} })
  ok('sem login, API de lançamento → 401', ra.status() === 401, `HTTP ${ra.status()}`)
  await anon.close()
}

// ════════════════════════════════════════════════════════════════════════════
secao('6. equipe: cadastrar, desativar, redefinir senha, reativar')
{
  // Reexecução: o funcionário da execução anterior ocupa o login. Banco LOCAL descartável.
  const anterior = await um(`select id from usuarios where usuario='maria.garcom'`)
  if (anterior) {
    await q(`delete from usuarios where id=$1`, [anterior.id])
    await q(`delete from auth.users where id=$1`, [anterior.id])
  }

  const dono = await logar('dono.local')
  await dono.page.goto(`${BASE}/admin/equipe`, { waitUntil: 'networkidle' })
  await dono.page.waitForSelector('text=Novo funcionário', { timeout: 15000 })
  // O dono vê o aviso de pendências de configuração em tela de gestão — comportamento
  // que já existia. A loja de demonstração tem pendências (telefone, frete…): fecha.
  await dono.page.waitForTimeout(1500)
  const aviso = dono.page.locator('button', { hasText: 'OK, entendi' })
  if (await aviso.count()) await aviso.click()

  // Cadastro pela TELA.
  await dono.page.locator('button', { hasText: 'Novo funcionário' }).click()
  await dono.page.fill('input[placeholder="Ex.: João Silva"]', 'Maria Garçonete')
  await dono.page.fill('input[placeholder="joao.silva"]', 'maria.garcom')
  await dono.page.selectOption('select', 'garcom')
  await dono.page.fill('input[type="password"]', 'senha-inicial-1')
  await dono.page.screenshot({ path: '.shots/checkpoint-10-equipe-cadastro.png' })
  await dono.page.locator('button', { hasText: /^Cadastrar$/ }).click()
  await dono.page.waitForSelector('text=foi cadastrado', { timeout: 20000 })
  await dono.page.screenshot({ path: '.shots/checkpoint-11-equipe-lista.png' })

  const maria = await um(`select id, papel, restaurante_id, desativado_em from usuarios where usuario='maria.garcom'`)
  ok('funcionário criado pela tela, na loja do dono, papel garçom', maria?.papel === 'garcom' && maria.restaurante_id === loja)

  const ofertas = await api(dono.page, '/api/admin/equipe')
  ok('dono vê as opções gerente/garçom/atendente e nunca dono', JSON.stringify([...ofertas.json.papeisOferecidos].sort()) === JSON.stringify(['atendente', 'garcom', 'gerente']))

  // Login repetido é impossível.
  const dup = await api(dono.page, '/api/admin/equipe', 'POST', { nome: 'Outra', usuario: 'maria.garcom', papel: 'garcom', senha: 'qualquer123' })
  ok('login duplicado é recusado', dup.status === 409, dup.json?.error)

  // Maria entra e cai em Mesas.
  const m = await logar('maria.garcom', 'senha-inicial-1')
  ok('funcionária nova entra com login e senha', new URL(m.page.url()).pathname === '/admin/mesas', m.page.url())

  // Dono DESATIVA com a sessão dela aberta.
  const des = await api(dono.page, `/api/admin/equipe/${maria.id}`, 'PATCH', { ativo: false })
  ok('dono desativa', des.status === 200)
  await m.page.goto(`${BASE}/admin/mesas`, { waitUntil: 'domcontentloaded' })
  ok('sessão aberta dela cai na próxima navegação', new URL(m.page.url()).pathname === '/login', new URL(m.page.url()).pathname)
  const apiDesativada = await api(m.page, `/api/admin/mesas/${mesa01.id}/lancamento`, 'POST', lancamento(AGUA, crypto.randomUUID()))
  ok('e não consegue mais lançar pela API', apiDesativada.status === 401, `HTTP ${apiDesativada.status}`)
  await m.ctx.close()

  const tentativa = await logar('maria.garcom', 'senha-inicial-1')
  ok('desativada não consegue logar de novo', new URL(tentativa.page.url()).pathname === '/login')
  await tentativa.ctx.close()

  // Travas: dono não se desativa; ninguém mexe em quem está acima.
  const donoId = (await um(`select id from usuarios where usuario='dono.local'`)).id
  const auto = await api(dono.page, `/api/admin/equipe/${donoId}`, 'PATCH', { ativo: false })
  ok('dono não consegue desativar a própria conta', auto.status === 403, auto.json?.error)
  const garcomSession = await api(garcom.page, `/api/admin/equipe/${maria.id}`, 'PATCH', { ativo: true })
  ok('garçom não administra ninguém', garcomSession.status === 403)

  // Redefinir senha e reativar.
  const sen = await api(dono.page, `/api/admin/equipe/${maria.id}/senha`, 'POST', { senha: 'senha-nova-2' })
  ok('dono redefine a senha', sen.status === 200)
  const rea = await api(dono.page, `/api/admin/equipe/${maria.id}`, 'PATCH', { ativo: true })
  ok('dono reativa', rea.status === 200)

  const velha = await logar('maria.garcom', 'senha-inicial-1')
  ok('senha antiga não entra mais', new URL(velha.page.url()).pathname === '/login')
  await velha.ctx.close()
  const nova = await logar('maria.garcom', 'senha-nova-2')
  ok('senha nova entra', new URL(nova.page.url()).pathname === '/admin/mesas')
  await nova.ctx.close()

  const eventos = await q(`select acao, dados from eventos_auditoria where entidade_id=$1 order by criado_em`, [maria.id])
  const acoes = eventos.map((e) => e.acao)
  ok('auditoria registrou criar, desativar, redefinir senha e reativar',
    ['equipe.criou', 'equipe.desativou', 'equipe.redefiniu_senha', 'equipe.reativou'].every((a) => acoes.includes(a)), acoes.join(', '))
  const vazou = JSON.stringify(eventos.map((e) => e.dados))
  ok('nenhuma senha nem e-mail técnico na auditoria', !vazou.includes('senha-') && !vazou.includes('@equipe.menuzia.local'))

  await dono.ctx.close()
}

await garcom.ctx.close()
await cliente.close()
await browser.close()
await db.end()

const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram\n`)
process.exit(falhas ? 1 : 0)
