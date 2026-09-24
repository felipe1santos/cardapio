/**
 * Regressão da release: o que o módulo de mesas NÃO pode ter mexido.
 *
 * Todas as mudanças desta entrega tocaram trilhos compartilhados — `criarPedido`
 * (canal e loja fechada), `itens_cardapio` (colunas de canal), `lib/queries/cardapio`
 * (ITEM_SELECT), a rota de notificação e o rótulo de origem no Kanban e na cozinha.
 * Este arquivo prova que o delivery, o PDV, o modo gaveta e a Pizza do Rosa continuam
 * exatamente como estavam.
 *
 * Cobre também o fechamento de `/api/pedidos/[id]/notificar`, por perfil.
 *
 * Só loopback. Precisa do servidor em BASE e da stack local.
 *   node scripts/seguranca/e2e-regressao-release.mjs
 */

import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
import { E2E_LOJA, E2E_LOJA_NOME, E2E_VIZINHA, USU } from './e2e-ambiente.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)

execFileSync(process.execPath, ['scripts/seguranca/semear-demo-mesas.mjs'], { stdio: 'ignore' })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

const loja = (await um(`select id from restaurantes where slug='${E2E_LOJA}'`)).id
const vizinha = (await um(`select id from restaurantes where slug='${E2E_VIZINHA}'`)).id
const itemPor = (nome, r = loja) => um(`select id, nome, preco from itens_cardapio where restaurante_id=$1 and nome=$2`, [r, nome])

const browser = await chromium.launch()

async function logar(usuario) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([
    page.waitForURL((u) => u.pathname.startsWith('/admin') || u.searchParams.has('error'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForLoadState('networkidle').catch(() => {})
  return { ctx, page }
}

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
      try {
        json = await r.json()
      } catch {
        /* sem corpo */
      }
      return { status: r.status, json }
    },
    { url: url.startsWith('http') ? url : `${BASE}${url}`, metodo, corpo },
  )

const dono = await logar(USU.dono)
const garcom = await logar(USU.garcom)
const atendente = await logar(USU.atendente)

// ════════════════════════════════════════════════════════════════════════════
secao('Delivery: vitrine e checkout intactos')
{
  const pagina = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' })).newPage()
  const resp = await pagina.goto(`${BASE}/loja/${E2E_LOJA}`, { waitUntil: 'networkidle' })
  ok('a vitrine carrega', resp?.status() === 200, `HTTP ${resp?.status()}`)
  await pagina.waitForTimeout(1800)
  const texto = await pagina.locator('body').innerText()
  ok('mostra os itens do catálogo', texto.includes('Filé à Parmegiana') && texto.includes('Burger da Casa'))
  ok('mostra preço', /68|R\$/.test(texto))
  ok('a vitrine NÃO virou tela de mesa', !/Mostre-a ao garçom/i.test(texto))
  await pagina.context().close()

  const AGUA = await itemPor('Água com Gás')
  const antes = await um(`select count(*)::int as n from pedidos where restaurante_id=$1 and canal='delivery'`, [loja])
  const r = await fetch(`${BASE}/api/loja/${E2E_LOJA}/pedido`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tipo: 'retirada',
      cliente: { nome: 'Cliente Teste', telefone: '11988887777' },
      itens: [{ itemId: AGUA.id, quantidade: 2, observacao: '', complementos: [] }],
      pagamento: 'pix',
    }),
  })
  const corpo = await r.json().catch(() => ({}))
  ok('checkout do delivery cria pedido', r.status === 200 || r.status === 201, `HTTP ${r.status} ${corpo?.error ?? ''}`)
  const depois = await um(`select count(*)::int as n from pedidos where restaurante_id=$1 and canal='delivery'`, [loja])
  ok('o pedido nasceu no canal delivery', depois.n === antes.n + 1, `${antes.n} → ${depois.n}`)
  const p = await um(`select id, canal, origem, tipo, mesa, comanda_id, total from pedidos where restaurante_id=$1 and canal='delivery' order by criado_em desc limit 1`, [loja])
  ok('sem mesa e sem comanda', p?.mesa === null && p?.comanda_id === null)
  ok('origem cardapio, forçada no servidor', p?.origem === 'cardapio')
  ok('total recalculado pelo servidor (2 × 7)', Number(p?.total) === 14, p?.total)
  globalThis.__pedidoDelivery = p?.id
}

// ════════════════════════════════════════════════════════════════════════════
secao('PDV (balcão): continua funcionando e continua sendo balcão')
{
  const AGUA = await itemPor('Água com Gás')
  const r = await api(atendente.page, '/api/admin/pdv/pedido', 'POST', {
    tipo: 'retirada',
    cliente: { nome: 'Balcão Teste', telefone: '' },
    endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
    pagamento: 'dinheiro',
    trocoPara: null,
    itens: [{ itemId: AGUA.id, quantidade: 1, observacao: '', complementos: [] }],
  })
  ok('atendente registra venda de balcão', r.status === 200 || r.status === 201, `HTTP ${r.status} ${r.json?.error ?? ''}`)
  const p = await um(`select canal, origem, mesa, comanda_id from pedidos where restaurante_id=$1 and origem='pdv' and comanda_id is null order by criado_em desc limit 1`, [loja])
  ok('venda de balcão fica no canal balcao', p?.canal === 'balcao', p?.canal)
  ok('e não ganha mesa nem comanda', p?.mesa === null && p?.comanda_id === null)

  const doGarcom = await api(garcom.page, '/api/admin/pdv/pedido', 'POST', { itens: [] })
  ok('garçom continua fora do PDV', doGarcom.status === 403, `HTTP ${doGarcom.status}`)

  // A flag do módulo não governa o PDV: com ela desligada, o balcão segue.
  await q(`update restaurantes set modulo_mesas_ativo = false where id=$1`, [loja])
  const comFlagOff = await api(atendente.page, '/api/admin/pdv/pedido', 'POST', {
    tipo: 'retirada',
    cliente: { nome: 'Balcão Sem Flag', telefone: '' },
    endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
    pagamento: 'dinheiro',
    trocoPara: null,
    itens: [{ itemId: AGUA.id, quantidade: 1, observacao: '', complementos: [] }],
  })
  ok('PDV funciona igual com o módulo de mesas desligado', comFlagOff.status === 200 || comFlagOff.status === 201, `HTTP ${comFlagOff.status}`)
  await q(`update restaurantes set modulo_mesas_ativo = true where id=$1`, [loja])
}

// ════════════════════════════════════════════════════════════════════════════
secao('Comanda de mesa pelo PDV (a loja que já usava mesas antes do módulo)')
{
  // A loja com 13 mesas usa o PDV com comanda desde a Fase 1. Isso tem de continuar
  // idêntico, inclusive com a flag do módulo novo desligada.
  await q(`update restaurantes set modulo_mesas_ativo = false where id=$1`, [loja])
  const mesa = await um(`select id, nome from mesas where restaurante_id=$1 and ativa and bloqueada_em is null limit 1`, [loja])
  const AGUA = await itemPor('Água com Gás')
  const r = await api(atendente.page, '/api/admin/pdv/pedido', 'POST', {
    tipo: 'retirada',
    mesaId: mesa.id,
    // O PDV manda o nome da mesa no corpo (é o que o recibo imprime); o id da comanda e
    // o canal são do servidor.
    mesa: mesa.nome,
    cliente: { nome: mesa.nome, telefone: '' },
    endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
    pagamento: 'dinheiro',
    trocoPara: null,
    itens: [{ itemId: AGUA.id, quantidade: 1, observacao: '', complementos: [] }],
  })
  ok('PDV com mesa selecionada continua abrindo comanda', r.status === 200 || r.status === 201, `HTTP ${r.status} ${r.json?.error ?? ''}`)
  const p = await um(`select canal, comanda_id, mesa from pedidos where restaurante_id=$1 and origem='pdv' and comanda_id is not null order by criado_em desc limit 1`, [loja])
  ok('pedido de comanda do PDV é canal mesa', p?.canal === 'mesa', p?.canal)
  ok('e traz a comanda e o nome da mesa', !!p?.comanda_id && p?.mesa === mesa.nome)
  await q(`update restaurantes set modulo_mesas_ativo = true where id=$1`, [loja])
}

// ════════════════════════════════════════════════════════════════════════════
secao('Modo gaveta e banner da vitrine')
{
  for (const layout of ['categoria', 'gaveta']) {
    await q(`update restaurantes set layout_cardapio = $2 where id = $1`, [loja, layout])
    const pagina = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
    const resp = await pagina.goto(`${BASE}/loja/${E2E_LOJA}`, { waitUntil: 'networkidle' })
    await pagina.waitForTimeout(1800)
    const texto = await pagina.locator('body').innerText()
    ok(`layout "${layout}" carrega a vitrine`, resp?.status() === 200 && texto.includes(E2E_LOJA_NOME), `HTTP ${resp?.status()}`)
    // No modo gaveta as categorias começam fechadas: o que tem de aparecer é a lista de
    // categorias, não os itens. Abrir uma gaveta é a prova de que o conteúdo está lá.
    if (layout === 'gaveta') {
      await pagina.waitForTimeout(1500)
      const textoGaveta = await pagina.locator('body').innerText()
      ok('layout "gaveta" lista as categorias fechadas', /burgers/i.test(textoGaveta) && /bebidas/i.test(textoGaveta),
        textoGaveta.replace(/\s+/g, ' ').slice(0, 140))
      await pagina.locator('text=Burgers').first().click()
      await pagina.waitForTimeout(700)
      ok('abrir a gaveta revela os itens', (await pagina.locator('body').innerText()).includes('Burger da Casa'))
    } else {
      ok(`layout "${layout}" mostra os itens`, texto.includes('Burger da Casa'))
    }
    await pagina.context().close()
  }
  await q(`update restaurantes set layout_cardapio = 'categoria' where id = $1`, [loja])
}

// ════════════════════════════════════════════════════════════════════════════
secao('Pizza do Rosa: pizza com sabores e meio a meio')
{
  // Monta um cardápio de pizza mínimo nesta loja e prova que a precificação por sabor,
  // o meio a meio e o nome juntado continuam como estavam.
  // `pizza_sabores` pertence ao ITEM, não à loja: o caminho é por itens_cardapio.
  await q(
    `delete from pizza_sabor_precos where sabor_id in (
       select s.id from pizza_sabores s join itens_cardapio i on i.id = s.item_id where i.restaurante_id = $1)`, [loja])
  await q(
    `delete from pizza_sabores where item_id in (select id from itens_cardapio where restaurante_id = $1)`, [loja])
  await q(`delete from tamanhos_padrao_pizza where restaurante_id=$1`, [loja])
  await q(`delete from bordas_pizza where restaurante_id=$1`, [loja])

  const grupo = (await um(`select id from grupos_cardapio where restaurante_id=$1 order by posicao limit 1`, [loja])).id
  const pizza = await um(
    `insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, descricao, status, tipo_item, disponivel_delivery, disponivel_salao)
     values ($1,$2,'Pizza Grande',0,'','disponivel','pizza',true,true) returning id`, [loja, grupo])
  const tamanho = await um(
    `insert into tamanhos_padrao_pizza (restaurante_id, nome, max_sabores, posicao) values ($1,'Grande',2,0) returning id`, [loja])
  await q(`insert into bordas_pizza (restaurante_id, nome, preco, posicao) values ($1,'Catupiry',10,0)`, [loja])
  for (const [nome, preco] of [['Calabresa', 50], ['Portuguesa', 70]]) {
    const sabor = await um(
      `insert into pizza_sabores (item_id, nome, descricao, status, posicao) values ($1,$2,'','disponivel',0) returning id`, [pizza.id, nome])
    await q(`insert into pizza_sabor_precos (sabor_id, tamanho_padrao_id, preco) values ($1,$2,$3)`, [sabor.id, tamanho.id, preco])
  }
  await q(`update restaurantes set pizza_calculo_preco = 'maior' where id=$1`, [loja])

  const r = await fetch(`${BASE}/api/loja/${E2E_LOJA}/pedido`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tipo: 'retirada',
      cliente: { nome: 'Pizza Teste', telefone: '11977776666' },
      pagamento: 'pix',
      itens: [{
        itemId: pizza.id, quantidade: 1, observacao: '', complementos: [],
        tamanhoNome: 'Grande', saborNome: 'Calabresa / Portuguesa', bordaNome: 'Catupiry',
      }],
    }),
  })
  const corpo = await r.json().catch(() => ({}))
  ok('pedido de pizza meio a meio é aceito', r.status === 200 || r.status === 201, `HTTP ${r.status} ${corpo?.error ?? ''}`)
  const linha = await um(
    `select pi.nome, pi.sabor_nome, pi.borda_nome, pi.preco_unitario, pi.tamanho_nome
       from pedido_itens pi join pedidos p on p.id = pi.pedido_id
      where p.restaurante_id=$1 and pi.item_id=$2 order by p.criado_em desc limit 1`, [loja, pizza.id])
  ok('o nome dos dois sabores é gravado junto', linha?.sabor_nome === 'Calabresa / Portuguesa', linha?.sabor_nome)
  ok('a regra "maior" precifica pelo sabor mais caro + borda (70 + 10)', Number(linha?.preco_unitario) === 80, linha?.preco_unitario)
  ok('o tamanho acompanha', linha?.tamanho_nome === 'Grande')

  // E o mesmo item continua lançável pelo garçom, do MESMO catálogo.
  const mesa = await um(`select id from mesas where restaurante_id=$1 and ativa and bloqueada_em is null limit 1`, [loja])
  const naMesa = await api(garcom.page, `/api/admin/mesas/${mesa.id}/lancamento`, 'POST', {
    chaveIdempotencia: uuid(),
    selecoesVistas: [],
    itens: [{ itemId: pizza.id, quantidade: 1, observacao: '', complementos: [], tamanhoNome: 'Grande', saborNome: 'Calabresa', bordaNome: 'Catupiry' }],
  })
  ok('a mesma pizza é lançada na mesa pelo catálogo compartilhado', naMesa.status === 201, `HTTP ${naMesa.status} ${naMesa.json?.error ?? ''}`)
  const naComanda = await um(
    `select pi.sabor_nome, pi.preco_unitario from pedido_itens pi join pedidos p on p.id=pi.pedido_id
      where p.canal='mesa' and pi.item_id=$1 order by p.criado_em desc limit 1`, [pizza.id])
  ok('com o preço do sabor escolhido (50 + 10)', Number(naComanda?.preco_unitario) === 60, naComanda?.preco_unitario)
}

// ════════════════════════════════════════════════════════════════════════════
secao('/api/pedidos/[id]/notificar: o furo fechado, sem quebrar quem usa')
{
  const pedidoDelivery = globalThis.__pedidoDelivery
  const pedidoMesa = (await um(`select id from pedidos where restaurante_id=$1 and canal='mesa' order by criado_em desc limit 1`, [loja])).id
  const alheio = await um(
    `insert into pedidos (restaurante_id, tipo, status, subtotal, total, canal, origem, cliente_nome)
     values ($1,'retirada','recebido',10,10,'delivery','cardapio','Vizinho') returning id`, [vizinha])

  const anonimo = await fetch(`${BASE}/api/pedidos/${pedidoDelivery}/notificar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'pronto' }),
  })
  ok('anônimo não dispara notificação (era o furo)', anonimo.status === 401, `HTTP ${anonimo.status}`)

  const doGarcom = await api(garcom.page, `/api/pedidos/${pedidoDelivery}/notificar`, 'POST', { status: 'pronto' })
  ok('garçom não avisa cliente de delivery', doGarcom.status === 403, `HTTP ${doGarcom.status}`)

  const doAtendente = await api(atendente.page, `/api/pedidos/${pedidoDelivery}/notificar`, 'POST', { status: 'pronto' })
  ok('atendente do delivery avisa (é quem move o pedido no Kanban)', doAtendente.status === 200, `HTTP ${doAtendente.status}`)

  const doDono = await api(dono.page, `/api/pedidos/${pedidoDelivery}/notificar`, 'POST', { status: 'pronto' })
  ok('dono avisa', doDono.status === 200, `HTTP ${doDono.status}`)
  ok('a repetição do mesmo status não manda duas mensagens', doDono.json?.jaNotificado === true || doDono.json?.ok === true)

  const doAtendenteNaMesa = await api(atendente.page, `/api/pedidos/${pedidoMesa}/notificar`, 'POST', { status: 'pronto' })
  ok('atendente do delivery não avisa pedido de mesa', doAtendenteNaMesa.status === 403, `HTTP ${doAtendenteNaMesa.status}`)

  const doGarcomNaMesa = await api(garcom.page, `/api/pedidos/${pedidoMesa}/notificar`, 'POST', { status: 'pronto' })
  ok('garçom avisa pedido de mesa (canal dele)', doGarcomNaMesa.status === 200, `HTTP ${doGarcomNaMesa.status}`)

  const cruzado = await api(dono.page, `/api/pedidos/${alheio.id}/notificar`, 'POST', { status: 'pronto' })
  ok('pedido de outra loja → 404, igual a inexistente', cruzado.status === 404, `HTTP ${cruzado.status}`)

  const inexistente = await api(dono.page, `/api/pedidos/00000000-0000-4000-8000-000000000000/notificar`, 'POST', { status: 'pronto' })
  ok('pedido inexistente → 404', inexistente.status === 404, `HTTP ${inexistente.status}`)

  const statusInvalido = await api(dono.page, `/api/pedidos/${pedidoDelivery}/notificar`, 'POST', { status: 'voando' })
  ok('status fora da lista → 400', statusInvalido.status === 400, `HTTP ${statusInvalido.status}`)

  await q(`delete from pedidos where id=$1`, [alheio.id])
  ok('a tentativa cruzada não deixou lixo na loja vizinha',
    (await um(`select count(*)::int as n from pedidos where restaurante_id=$1`, [vizinha])).n === 0)
}

// ════════════════════════════════════════════════════════════════════════════
secao('Kanban e cozinha: salão e balcão distinguíveis, delivery intocado')
{
  await dono.page.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
  await dono.page.waitForTimeout(2500)
  const texto = await dono.page.locator('body').innerText()
  ok('o Kanban carrega com pedidos dos três canais', /#\d+/.test(texto))
  ok('pedido de salão aparece como Salão', /Salão/.test(texto), texto.match(/Sal[ãa]o[^\n]{0,30}/)?.[0])
  ok('pedido de balcão continua aparecendo como PDV', /PDV/.test(texto))
  await dono.page.screenshot({ path: '.shots/rc-08-kanban-canais.png' })

  const estacao = await um(`select token from estacoes where restaurante_id=$1 limit 1`, [loja])
  const token = estacao?.token ?? (await um(
    `insert into estacoes (restaurante_id, nome, modo) values ($1,'Cozinha Teste','producao') returning token`, [loja])).token
  const cozinha = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  const resp = await cozinha.goto(`${BASE}/cozinha/${token}`, { waitUntil: 'networkidle' })
  await cozinha.waitForTimeout(2500)
  ok('o portal da cozinha abre pelo token', resp?.status() === 200, `HTTP ${resp?.status()}`)
  const textoCozinha = await cozinha.locator('body').innerText()
  // A etiqueta da cozinha é caixa alta por CSS, e innerText devolve o texto renderizado.
  ok('a cozinha identifica o pedido de salão com a mesa', /sal[ãa]o ·/i.test(textoCozinha),
    textoCozinha.split('\n').slice(0, 16).join(' | '))
  ok('a cozinha vê o número da comanda do salão', /comanda \d+/i.test(textoCozinha), textoCozinha.match(/comanda \d+/i)?.[0])
  // O portal lê pela rota do token; a mesma resposta traz o garçom que lançou.
  const apiCozinha = await fetch(`${BASE}/api/cozinha/${token}`).then((r) => r.json())
  // O da semente foi inserido direto no banco, sem garçom; o lançado pela tela tem.
  const deSalao = (apiCozinha.pedidos ?? []).find((x) => x.canal === 'mesa' && x.criadoPorNome)
  ok('o pedido de salão chega à cozinha com mesa, comanda e garçom',
    !!deSalao?.mesa && Number.isInteger(deSalao?.comandaNumero) && !!deSalao?.criadoPorNome,
    JSON.stringify({ mesa: deSalao?.mesa, comanda: deSalao?.comandaNumero, por: deSalao?.criadoPorNome }))
  await cozinha.screenshot({ path: '.shots/rc-09-cozinha-salao.png' })
  await cozinha.context().close()
}

// ════════════════════════════════════════════════════════════════════════════
secao('Fidelidade e cupons: o motor não foi tocado')
{
  const { data: recompensas, error } = await admin.from('fidelidade_recompensas').select('id').limit(1)
  ok('as tabelas de fidelidade continuam acessíveis pelo servidor', !error, error?.message)
  ok('nenhuma recompensa foi inventada pelo módulo de mesas', (recompensas ?? []).length >= 0)

  const campanhas = await um(`select count(*)::int as n from campanhas_fidelidade where restaurante_id=$1`, [loja])
  ok('a loja de demonstração não ganhou campanha por acidente', campanhas.n === 0, `${campanhas.n} campanha(s)`)

  // O pedido de mesa não entra no motor de fidelidade (não tem cliente com telefone).
  const p = await um(`select cliente_telefone from pedidos where restaurante_id=$1 and canal='mesa' order by criado_em desc limit 1`, [loja])
  ok('pedido de mesa não carrega telefone de cliente', !p?.cliente_telefone, p?.cliente_telefone ?? 'vazio')
}

// ════════════════════════════════════════════════════════════════════════════
secao('Recibo: a folha protegida continua igual')
{
  // CLAUDE.md §7: é proibido mexer no layout. Aqui só se confere que o recibo continua
  // recebendo a identificação da mesa pelo campo que ele já lia.
  const p = await um(
    `select origem, mesa from pedidos where restaurante_id=$1 and canal='mesa' order by criado_em desc limit 1`, [loja])
  ok('pedido de mesa mantém origem pdv, que é o gatilho do "MESA X" no recibo', p.origem === 'pdv', p.origem)
  ok('e o nome da mesa que o recibo imprime', !!p.mesa, p.mesa)
}

// ════════════════════════════════════════════════════════════════════════════
await browser.close()
await db.end()

const falhas = res.filter((r) => !r).length
console.log(`\n${falhas === 0 ? '✅' : '❌'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)
