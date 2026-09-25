/**
 * DEMONSTRAÇÃO VIRTUAL da impressão por função — sem impressora física, sem produção.
 *
 * Dois "computadores" virtuais rodando o printer-agent/src/main.js real
 * (scripts/impressao/agente-virtual.cjs), cada um com UMA impressora virtual:
 *   · PC Cozinha (virtual) → "Cozinha Virtual 01"  (função Cozinha)
 *   · PC Caixa (virtual)   → "Caixa Virtual 02"    (função Caixa)
 * Servidor e banco LOCAIS (127.0.0.1), loja de demonstração cantina-demo.
 *
 * Cada impressão gera, na pasta da impressora: PNG (bitmap exato do print.ps1 -DebugPng),
 * PDF (o PNG na largura do papel), TXT (conteúdo legível) e uma linha no log de
 * roteamento (job_id, tipo, destino, horário, tentativa, resultado).
 *
 *   DEMO_SAIDA=<pasta artefatos> DEMO_DADOS=<pasta config dos agentes> node scripts/impressao/demo-virtual.mjs
 *   MANTER=1 → no fim, deixa os dois agentes rodando (para o painel mostrar "online").
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync, rmSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'
import { pngsParaPdf } from './renderizar-virtual.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const ART = process.env.DEMO_SAIDA ?? join(tmpdir(), 'menuzia-demo-virtual')
const DADOS = process.env.DEMO_DADOS ?? join(tmpdir(), 'menuzia-demo-virtual-dados')
const MANTER = process.env.MANTER === '1'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
rmSync(ART, { recursive: true, force: true })
rmSync(DADOS, { recursive: true, force: true })
mkdirSync(ART, { recursive: true })

const COZ = 'Cozinha Virtual 01'
const CAI = 'Caixa Virtual 02'

const res = []
const ok = (nome, passou, detalhe) => {
  res.push({ cenario: cenarioAtual, nome, passou })
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== null && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
let cenarioAtual = 'preparo'
const secao = (id, t) => { cenarioAtual = id; console.log(`\n── ${id}. ${t} ──`) }
const uuid = () => crypto.randomUUID()
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
async function aguardar(fn, ms = 30000, passo = 500) {
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    const v = await fn()
    if (v) return v
    await esperar(passo)
  }
  return null
}

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]

// ── loja de demonstração: estado limpo ──────────────────────────────────────
const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes', 'impressao_reservas']) {
  await db.query(`delete from ${t} where restaurante_id=$1`, [loja])
}
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza demo virtual', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
await db.query('update mesas set limpeza_desde=null, limpeza_comanda_id=null where restaurante_id=$1', [loja])
// 0100: loja liberada para o Beta, começando em "Somente Caixa".
await db.query(`update restaurantes set pdv_v2=true, modulo_mesas_ativo=true, impressao_automatica=true, impressao_cozinha_por_funcao=false,
  impressao_beta_liberado=true, impressao_beta_modo='caixa', impressao_cozinha_transferida_em=null,
  status_loja='aberto_manual', aceita_entrega=true, impressao_agente_visto_em=null, impressao_agente_token=null where id=$1`, [loja])
await db.query('update pedidos set impresso=true, reimprimir=false where restaurante_id=$1', [loja])
if ((await um(`select evolution_instance from restaurantes where id=$1`, [loja])).evolution_instance) throw new Error('loja demo com WhatsApp configurado: abortado')

// Cardápio de demonstração: item com tamanho e massa de pizza (só se faltarem).
const item = async (nome) => um('select id, nome, preco from itens_cardapio where restaurante_id=$1 and nome=$2', [loja, nome])
const SUCO = await item('Suco de Laranja')
if (!(await um('select 1 from tamanhos_item where item_id=$1', [SUCO.id]))) {
  await db.query(`insert into tamanhos_item (item_id, nome, preco, posicao) values ($1,'300 ml',12,0), ($1,'500 ml',16,1)`, [SUCO.id])
}
if (!(await um(`select 1 from massas_pizza where restaurante_id=$1 and nome='Fina'`, [loja]))) {
  await db.query(`insert into massas_pizza (restaurante_id, nome, preco, posicao) values ($1,'Tradicional',0,0), ($1,'Fina',3,1)`, [loja])
}
// Pizza de demonstração (o semeador das mesas recria o cardápio sem ela).
if (!(await item('Pizza Grande'))) {
  const tam = await um(`select id from tamanhos_padrao_pizza where restaurante_id=$1 and nome='Grande'`, [loja])
    ?? await um(`insert into tamanhos_padrao_pizza (restaurante_id, nome, fatias, posicao, max_sabores) values ($1,'Grande',8,0,2) returning id`, [loja])
  if (!(await um(`select 1 from bordas_pizza where restaurante_id=$1 and nome='Catupiry'`, [loja]))) {
    await db.query(`insert into bordas_pizza (restaurante_id, nome, preco, posicao) values ($1,'Catupiry',10,0)`, [loja])
  }
  const pz = await um(`insert into itens_cardapio (restaurante_id, nome, preco, tipo_item, status) values ($1,'Pizza Grande',0,'pizza','disponivel') returning id`, [loja])
  for (const [nome, preco] of [['Calabresa', 50], ['Portuguesa', 70]]) {
    const sab = await um(`insert into pizza_sabores (item_id, nome, status, posicao) values ($1,$2,'disponivel',0) returning id`, [pz.id, nome])
    await db.query(`insert into pizza_sabor_precos (sabor_id, tamanho_padrao_id, preco) values ($1,$2,$3)`, [sab.id, tam.id, preco])
  }
}
const AGUA = await item('Água com Gás')
const FILE = await item('Filé à Parmegiana')
const BURGER = await item('Burger da Casa')
const PIZZA = await item('Pizza Grande')
const RISOTO = await item('Risoto de Funghi')

// ── agentes virtuais ────────────────────────────────────────────────────────
function iniciarAgente(pasta, impressora) {
  const saida = join(ART, pasta)
  const proc = spawn(process.execPath, ['scripts/impressao/agente-virtual.cjs'], {
    env: { ...process.env, BASE, AGENTE_DIR: join(DADOS, pasta), AGENTE_SAIDA: saida, AGENTE_IMPRESSORAS: impressora, RENDER: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const esperando = []
  const logs = []
  let buf = ''
  proc.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (l.startsWith('<<RESP>> ')) esperando.shift()?.(JSON.parse(l.slice(9)))
      else if (l.startsWith('[agente]')) logs.push(l)
    }
  })
  proc.stderr.on('data', (d) => logs.push(`[stderr] ${d}`))
  const jsonl = (arq) => (existsSync(join(saida, arq)) ? readFileSync(join(saida, arq), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  return {
    logs,
    saida,
    cmd: (o) => new Promise((r) => { esperando.push(r); proc.stdin.write(JSON.stringify(o) + '\n') }),
    impressos: () => jsonl('impressos.jsonl'),
    roteamento: () => jsonl('roteamento.jsonl'),
    parar: () => proc.kill(),
  }
}

// ── navegador (usuários de demonstração) ────────────────────────────────────
const browser = await chromium.launch()
async function logar(usuario) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' })
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')])
  return page
}
const dispensarChecklist = (page) => page.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 4000 }).catch(() => {})
const api = (page, url, metodo = 'GET', corpo) =>
  page.evaluate(async ({ url, metodo, corpo }) => {
    const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
    let json = null
    try { json = await r.json() } catch { /* sem corpo */ }
    return { status: r.status, json }
  }, { url: `${BASE}${url}`, metodo, corpo })
const painel = async (page) => (await api(page, '/api/admin/impressao/painel')).json
const SHOTS = join(ART, 'telas')
mkdirSync(SHOTS, { recursive: true })
const foto = (page, nome) => page.screenshot({ path: join(SHOTS, `${nome}.png`) })

const pGer = await logar('gerente.local')
const pAt = await logar('atendente.local')

// ── rótulos por job: cada linha do log de roteamento ganha o cenário ────────
const vistos = { K: 0, C: 0 }
const tabela = []
function colher(K, C) {
  for (const [chave, ag] of [['K', K], ['C', C]]) {
    const linhas = ag.roteamento()
    for (const l of linhas.slice(vistos[chave])) tabela.push({ cenario: cenarioAtual, ...l })
    vistos[chave] = linhas.length
  }
}

// ════════════════════════════════════════════════════════════════════════════
secao('0', 'Parear os dois computadores virtuais e atribuir as funções (pela tela)')
await pGer.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
await dispensarChecklist(pGer)
const parear = async (pasta, impressora, nome) => {
  await pGer.getByTestId('gerar-codigo').click()
  const codigo = (await pGer.getByTestId('codigo-pareamento').innerText()).trim()
  await pGer.getByRole('button', { name: 'Esconder' }).click() // código fora de qualquer tela capturada
  const ag = iniciarAgente(pasta, impressora)
  const r = await ag.cmd({ cmd: 'parear', codigo, nome })
  ok(`${nome} pareado com código de uso único`, r?.ok === true, r?.erro)
  ag.codigo = codigo
  return ag
}
const K = await parear('PC_Cozinha_virtual', COZ, 'PC Cozinha (virtual)')
const C = await parear('PC_Caixa_virtual', CAI, 'PC Caixa (virtual)')
await aguardar(async () => (await painel(pGer)).dispositivos.length === 2)
let pn = await painel(pGer)
const d01 = pn.dispositivos.find((d) => d.nomeSistema === COZ)
const d02 = pn.dispositivos.find((d) => d.nomeSistema === CAI)
ok('duas impressoras virtuais descobertas, cada uma no seu computador', !!d01 && !!d02 && d01.agenteId !== d02.agenteId)
const larguras = async (mm01, mm02) => {
  await api(pGer, `/api/admin/impressao/dispositivos/${d01.id}`, 'PATCH', { apelido: COZ, larguraMm: mm01 })
  await api(pGer, `/api/admin/impressao/dispositivos/${d02.id}`, 'PATCH', { apelido: CAI, larguraMm: mm02 })
}
await larguras(80, 58)
await pGer.reload({ waitUntil: 'networkidle' })
await dispensarChecklist(pGer)
await pGer.getByTestId('funcao-cozinha').selectOption(d01.id)
await aguardar(async () => (await painel(pGer)).funcoes.cozinha === d01.id)
await pGer.getByTestId('funcao-caixa').selectOption(d02.id)
await aguardar(async () => (await painel(pGer)).funcoes.caixa === d02.id)
// 0100: a cozinha passa ao Beta pelo modo "Cozinha e Caixa", com confirmação explícita.
await pGer.getByTestId('modo-cozinha_caixa').click()
await pGer.getByTestId('confirmar-cozinha-beta').check()
await pGer.getByTestId('confirmar-modo-ok').click()
await aguardar(async () => (await painel(pGer)).cozinhaPorFuncao)
pn = await painel(pGer)
ok('Cozinha → Cozinha Virtual 01 · Caixa → Caixa Virtual 02 · cozinha por função ligada', pn.funcoes.cozinha === d01.id && pn.funcoes.caixa === d02.id && pn.cozinhaPorFuncao)
await foto(pGer, '00-painel-configurado')

// ── ajudantes de cenário ────────────────────────────────────────────────────
const conta = async (id) => (await api(pAt, `/api/admin/comandas/${id}`)).json.conta
const lancar = async (alvo, itens) => (await api(pAt, '/api/admin/pdv/lancamento', 'POST', { ...alvo, chave: uuid(), itens })).json
const esperarFicha = async (antes) => aguardar(() => K.impressos().filter((x) => x.tipo === 'ficha_cozinha').length > antes && K.impressos().filter((x) => x.tipo === 'ficha_cozinha'), 40000)
const nK = (tipo) => K.impressos().filter((x) => !tipo || x.tipo === tipo).length
const nC = (tipo) => C.impressos().filter((x) => !tipo || x.tipo === tipo).length
const texto = (r) => (r?.texto ?? '').replace(/[\x01\x02]/g, ' ')
const mesaLivre = () => um(`select m.id, m.nome from mesas m where restaurante_id=$1 and ativa and bloqueada_em is null and nome like 'Mesa%'
  and m.limpeza_desde is null and not exists (select 1 from comandas c where c.mesa_id=m.id and c.status='aberta') order by ordem limit 1`, [loja])
const preConta = (comandaId, reimpressao = false, chave = uuid(), pagina = pAt) => api(pagina, `/api/admin/comandas/${comandaId}/pre-conta`, 'POST', { chave, reimpressao })
const trabalho = (id) => um('select estado, tentativas, erro, via from impressao_trabalhos where id=$1', [id])

/** Mesa completa: todos os tipos de linha exigidos na pré-conta. */
async function mesaCompleta() {
  const mesa = await mesaLivre()
  // 0094: mesa abre com o nome do cliente antes do primeiro lançamento.
  await api(pAt, `/api/admin/mesas/${mesa.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'Cliente Demonstração', chave: uuid() })
  const l = await lancar({ mesaId: mesa.id }, [
    { itemId: AGUA.id, quantidade: 1, complementos: [] },
    { itemId: SUCO.id, quantidade: 1, complementos: [], tamanhoNome: '500 ml' },
    { itemId: PIZZA.id, quantidade: 1, complementos: [], tamanhoNome: 'Grande', saborNome: 'Calabresa / Portuguesa', bordaNome: 'Catupiry', massaNome: 'Fina' },
    { itemId: BURGER.id, quantidade: 2, complementos: ['Ao ponto', 'Bacon crocante', 'Queijo cheddar', 'Coca-Cola lata'], observacao: 'Sem cebola, pão bem tostado' },
    { itemId: FILE.id, quantidade: 1, complementos: [] },
  ])
  return { mesa, comandaId: l.comandaId, pedidoId: l.id, erro: l.error }
}
async function ajustarMesa(comandaId) {
  const c = await conta(comandaId)
  const itemFile = c.pedidos.flatMap((p) => p.itens).find((i) => i.nome === FILE.nome)
  const cancel = await api(pGer, `/api/admin/comandas/${comandaId}`, 'POST', { acao: 'cancelar_item', itemId: itemFile?.id, motivo: 'Cliente desistiu (demonstração)' })
  const desc = await api(pGer, `/api/admin/comandas/${comandaId}`, 'POST', { acao: 'ajustar_valores', descontoTipo: 'valor', descontoValor: 5, motivo: 'Cortesia interna (não sai no papel)' })
  const pix = await api(pAt, `/api/admin/comandas/${comandaId}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: 50, chave: uuid() })
  const din = await api(pAt, `/api/admin/comandas/${comandaId}`, 'POST', { acao: 'pagamento', forma: 'dinheiro', valor: 30, chave: uuid() })
  return { cancel: cancel.status, desc: desc.status, pix: pix.status, din: din.status }
}
async function delivery(nomeCliente) {
  const r = await fetch(`${BASE}/api/loja/cantina-demo/pedido`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tipo: 'entrega',
      cliente: { nome: nomeCliente, telefone: '27900000000' },
      endereco: { rua: 'Rua de Demonstração', numero: '100', complemento: '', bairro: 'Centro', cep: '29000-000', cidade: 'Cidade Demo', referencia: '' },
      pagamento: 'pix',
      trocoPara: null,
      itens: [
        { itemId: BURGER.id, quantidade: 1, complementos: ['Ao ponto', 'Coca-Cola lata'], observacao: 'Entregar na portaria' },
        { itemId: RISOTO.id, quantidade: 1, complementos: [] },
      ],
    }),
  })
  return { status: r.status, json: await r.json().catch(() => null) }
}
async function testePagina(d) {
  return api(pGer, `/api/admin/impressao/dispositivos/${d.id}`, 'POST', { acao: 'teste', chave: uuid() })
}

/** Documentos de produção nas duas impressoras (rodada por largura). */
async function rodadaDocumentos(rot, mm01, mm02) {
  secao(`${rot}1`, `Delivery → só ${COZ} (${mm01} mm); ${CAI} não recebe nada`)
  let k0 = nK('ficha_cozinha')
  let c0 = nC()
  const dv = await delivery(`Cliente Delivery Demo ${rot}`)
  ok('pedido de delivery aceito pela vitrine local', dv.status === 201, dv.json?.error)
  const f1 = await esperarFicha(k0)
  ok(`ficha do delivery em ${COZ}, ${mm01} mm`, f1?.at(-1)?.impressora === COZ && f1?.at(-1)?.paperMm === mm01 && texto(f1?.at(-1)).includes('Cliente Delivery Demo'))
  await esperar(4000)
  ok(`${CAI} não recebeu nada`, nC() === c0)
  colher(K, C)

  secao(`${rot}2`, `PDV/balcão → só ${COZ}`)
  k0 = nK('ficha_cozinha')
  const bal = await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: `Conceição Demonstração ${rot}`, chave: uuid() })
  const lb = await lancar({ comandaId: bal.json.id }, [{ itemId: FILE.id, quantidade: 1, complementos: [] }, { itemId: AGUA.id, quantidade: 2, complementos: [] }])
  const f2 = await esperarFicha(k0)
  ok(`ficha do balcão em ${COZ}`, !!lb.id && f2?.at(-1)?.impressora === COZ)
  await esperar(4000)
  ok(`${CAI} não recebeu nada`, nC() === c0)
  colher(K, C)

  secao(`${rot}3`, `Mesa → só ${COZ}`)
  k0 = nK('ficha_cozinha')
  const m = await mesaCompleta()
  ok(`lançamento na ${m.mesa.nome} (tamanho, sabores, borda, massa, adicionais, qtd 2, observação)`, !!m.pedidoId, m.erro)
  const f3 = await esperarFicha(k0)
  ok(`ficha da mesa em ${COZ}`, f3?.at(-1)?.impressora === COZ && texto(f3?.at(-1)).toUpperCase().includes(m.mesa.nome.toUpperCase()))
  const aj = await ajustarMesa(m.comandaId)
  ok('ajustes da conta: item cancelado, desconto, Pix R$ 50 e dinheiro R$ 30', Object.values(aj).every((s) => s === 200), JSON.stringify(aj))
  await esperar(4000)
  ok(`${CAI} não recebeu nada (lançamento e ajustes não imprimem no caixa)`, nC() === c0)
  colher(K, C)

  secao(`${rot}4`, `Pré-conta da mesa → só ${CAI} (${mm02} mm)`)
  const kAntes = nK()
  const c4 = nC('pre_conta')
  if (rot === 'A') {
    await pAt.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
    await dispensarChecklist(pAt)
    await pAt.getByRole('button', { name: new RegExp(m.mesa.nome) }).first().click()
    await pAt.getByTestId('pre-conta-imprimir').click()
    await pAt.getByTestId('pre-conta-estado').getByText('Aceito pela fila do Windows').waitFor({ timeout: 30000 })
    await foto(pAt, 'A4-pdv-pre-conta-aceita')
    await pAt.keyboard.press('Escape').catch(() => {})
  } else {
    await preConta(m.comandaId)
  }
  const p4 = await aguardar(() => nC('pre_conta') > c4 && C.impressos().filter((x) => x.tipo === 'pre_conta').at(-1), 30000)
  const t4 = texto(p4)
  ok(`pré-conta da mesa em ${CAI}, ${mm02} mm`, p4?.impressora === CAI && p4?.paperMm === mm02)
  const exigidos = ['RECIBO/EXTRATO', 'NÃO É DOCUMENTO FISCAL', m.mesa.nome.toUpperCase(), '1x Água com Gás', '1x Suco de Laranja (500 ml)', 'Pizza Grande (Grande - Calabresa / Portuguesa)', '+ Borda: Catupiry', '+ Massa: Fina',
    '2x Burger da Casa', 'Bacon crocante', 'Queijo cheddar', 'Obs: Sem cebola, pão bem tostado', 'Subtotal', 'Taxa de serviço (10%)', 'Desconto', 'Pix: R$ 50,00', 'Dinheiro: R$ 30,00', 'RESTANTE A PAGAR', 'CANCELADOS — NÃO COBRADOS', '1ª via']
  const faltam = exigidos.filter((e) => !t4.includes(e))
  ok('conteúdo completo da pré-conta', faltam.length === 0, faltam.length ? `faltam: ${faltam.join(' | ')}` : '')
  const cancelados = t4.slice(t4.indexOf('CANCELADOS'))
  ok('cancelado sem preço, na seção própria', cancelados.includes(FILE.nome) && !cancelados.includes('R$'))
  ok('motivo interno do desconto não sai no papel', !t4.includes('Cortesia interna'))
  await esperar(3000)
  ok(`${COZ} não recebeu a pré-conta`, nK() === kAntes)
  colher(K, C)

  secao(`${rot}5`, `Pré-conta do balcão → só ${CAI}`)
  const c5 = nC('pre_conta')
  await api(pAt, `/api/admin/comandas/${bal.json.id}`, 'POST', { acao: 'pagamento', forma: 'credito', valor: 20, chave: uuid() })
  await preConta(bal.json.id)
  const p5 = await aguardar(() => nC('pre_conta') > c5 && C.impressos().filter((x) => x.tipo === 'pre_conta').at(-1), 30000)
  ok(`pré-conta do balcão em ${CAI}`, p5?.impressora === CAI && /BALCÃO · SENHA \d+/.test(texto(p5)) && texto(p5).includes('Crédito: R$ 20,00'))
  await esperar(3000)
  ok(`${COZ} não recebeu a pré-conta do balcão`, nK() === kAntes)
  colher(K, C)

  secao(`${rot}6`, 'Reimpressão da pré-conta da mesa → 2ª via, sem duplicar nada')
  const contar = async () => (await um(`select (select count(*) from pagamentos_comanda where comanda_id=$1) pag, (select count(*) from pedidos where comanda_id=$1) ped,
    (select count(*) from comandas where restaurante_id=$2) com, (select coalesce(sum(valor),0) from pagamentos_comanda where comanda_id=$1) soma`, [m.comandaId, loja]))
  const antes6 = await contar()
  const c6 = nC('pre_conta')
  const r6 = await preConta(m.comandaId, true)
  const p6 = await aguardar(() => nC('pre_conta') > c6 && C.impressos().filter((x) => x.tipo === 'pre_conta').at(-1), 30000)
  ok('nova cópia marcada 2ª via', r6.json?.via === 2 && texto(p6).includes('2ª VIA (reimpressão)'))
  const depois6 = await contar()
  ok('não duplicou pagamento, pedido nem conta', JSON.stringify(antes6) === JSON.stringify(depois6), JSON.stringify(depois6))
  ok('reimpressão não voltou para a cozinha', nK() === kAntes)
  colher(K, C)

  secao(`${rot}T`, 'Página de teste nas duas impressoras')
  const k7 = nK('teste')
  const c7 = nC('teste')
  await testePagina(d01)
  await testePagina(d02)
  const tt = await aguardar(() => nK('teste') > k7 && nC('teste') > c7, 30000)
  ok(`teste em ${COZ} (${mm01} mm) e em ${CAI} (${mm02} mm)`, !!tt && K.impressos().at(-1).paperMm === mm01 && C.impressos().at(-1).paperMm === mm02)
  colher(K, C)
  return { m, bal: bal.json }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n════ RODADA A: Cozinha 80 mm · Caixa 58 mm ════')
const A = await rodadaDocumentos('A', 80, 58)

// ════════════════════════════════════════════════════════════════════════════
secao('7', 'Clique duplo e duas abas → um trabalho original só')
const k7 = nK('ficha_cozinha')
const m7 = await mesaCompleta()
await esperarFicha(k7)
await pAt.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
await dispensarChecklist(pAt)
await pAt.getByRole('button', { name: new RegExp(m7.mesa.nome) }).first().click()
await pAt.getByTestId('pre-conta-imprimir').dblclick()
await pAt.getByTestId('pre-conta-estado').getByText('Aceito pela fila do Windows').waitFor({ timeout: 30000 })
await esperar(3000)
const j7 = await q(`select id from impressao_trabalhos where comanda_id=$1 and tipo='pre_conta'`, [m7.comandaId])
ok('clique duplo no botão: 1 trabalho, 1 impressão', j7.length === 1 && C.impressos().filter((x) => texto(x).includes(m7.mesa.nome.toUpperCase())).length === 1, `${j7.length} trabalho(s)`)
await pAt.keyboard.press('Escape').catch(() => {})
const aba2 = await pAt.context().newPage()
await aba2.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
const bal7 = (await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Duas Abas Demonstração', chave: uuid() })).json
await lancar({ comandaId: bal7.id }, [{ itemId: AGUA.id, quantidade: 1, complementos: [] }])
const chaveRepetida = uuid()
const [x1, x2, x3] = await Promise.all([preConta(bal7.id, false, uuid(), pAt), preConta(bal7.id, false, uuid(), aba2), preConta(bal7.id, false, chaveRepetida, pAt)])
const x4 = await preConta(bal7.id, false, chaveRepetida, pAt)
const ids7 = new Set([x1, x2, x3, x4].map((x) => x.json?.id))
await esperar(5000)
ok('duas abas + reenvio da mesma chave: 1 trabalho', ids7.size === 1 && (await q(`select id from impressao_trabalhos where comanda_id=$1`, [bal7.id])).length === 1, [x1, x2, x3, x4].map((x) => x.status).join(','))
ok('e 1 impressão', C.impressos().filter((x) => texto(x).includes('Duas Abas Demonstração')).length === 1)
await aba2.close()
colher(K, C)

// ════════════════════════════════════════════════════════════════════════════
secao('8', `${CAI} indisponível → pré-conta pendente, cozinha segue em ${COZ}`)
await C.cmd({ cmd: 'remover', lista: [CAI] })
const pc8 = await preConta(A.bal.id, true)
const e8 = await aguardar(async () => (await trabalho(pc8.json.id))?.erro, 20000)
const t8 = await trabalho(pc8.json.id)
ok('pré-conta com erro registrado e ainda pendente', /nao encontrada/.test(e8 ?? '') && t8.estado === 'pendente', `${t8.estado}, tentativa ${t8.tentativas}`)
const k8 = nK('ficha_cozinha')
await lancar({ comandaId: A.bal.id }, [{ itemId: RISOTO.id, quantidade: 1, complementos: [] }])
const f8 = await esperarFicha(k8)
ok(`com o caixa fora, a ficha da cozinha sai em ${COZ}`, f8?.at(-1)?.impressora === COZ)
colher(K, C)

secao('9', `${CAI} volta → a pendente sai uma vez`)
const c9 = C.impressos().length
await C.cmd({ cmd: 'recolocar', lista: [CAI] })
const v9 = await aguardar(async () => (await trabalho(pc8.json.id)).estado === 'enviado_spooler', 60000, 1000)
await esperar(6000)
ok('pendente impressa ao voltar', !!v9 && C.impressos().length === c9 + 1)
colher(K, C)
ok('sem duplicata: 1 "aceito" para esse job no log', tabela.filter((l) => l.job_id === pc8.json.id && l.resultado === 'aceito_pelo_spooler').length === 1)
ok('mesma via (retomada, não nova)', (await trabalho(pc8.json.id)).via === pc8.json.via)

// ════════════════════════════════════════════════════════════════════════════
secao('10', 'Trabalho vencido (> 10 min) não é impresso')
await C.cmd({ cmd: 'remover', lista: [CAI] })
const pc10 = await preConta(A.bal.id, true)
await aguardar(async () => (await trabalho(pc10.json.id))?.erro, 20000)
// Envelhece o trabalho no BANCO LOCAL (o gatilho de imutabilidade é desligado só nesta sessão).
await db.query(`set session_replication_role = replica`)
await db.query(`update impressao_trabalhos set criado_em = now() - interval '11 minutes', expira_em = now() - interval '1 minute', reservado_ate = null where id=$1`, [pc10.json.id])
await db.query(`set session_replication_role = origin`)
const c10 = C.impressos().length
await C.cmd({ cmd: 'recolocar', lista: [CAI] })
const v10 = await aguardar(async () => (await trabalho(pc10.json.id)).estado === 'expirado', 30000, 1000)
await esperar(6000)
ok('vira "expirado" e nada sai na impressora', !!v10 && C.impressos().length === c10)
colher(K, C)

// ════════════════════════════════════════════════════════════════════════════
secao('11', 'Falha persistente → 5 tentativas com espera crescente, depois "falhou"')
await C.cmd({ cmd: 'remover', lista: [CAI] })
const pc11 = await preConta(A.bal.id, true)
const v11 = await aguardar(async () => (await trabalho(pc11.json.id)).estado === 'falhou', 240000, 2000)
const t11 = await trabalho(pc11.json.id)
colher(K, C)
const tent = tabela.filter((l) => l.job_id === pc11.json.id)
ok('5 tentativas registradas e estado final "falhou"', !!v11 && t11.tentativas === 5 && tent.length === 5, `${t11.estado}, ${t11.tentativas} tentativas`)
const intervalos = tent.slice(1).map((l, i) => Math.round((Date.parse(l.horario) - Date.parse(tent[i].horario)) / 1000))
ok('espera crescente entre tentativas (≈10/20/30/40 s)', intervalos.every((s, i) => s >= 10 * (i + 1) - 1), `${intervalos.join(' s, ')} s`)
const c11 = C.impressos().length
await C.cmd({ cmd: 'recolocar', lista: [CAI] })
await esperar(8000)
ok('depois de "falhou" nada é impresso, mesmo com a impressora de volta', C.impressos().length === c11 && (await trabalho(pc11.json.id)).estado === 'falhou')
colher(K, C)

// ════════════════════════════════════════════════════════════════════════════
secao('12', 'Mesma impressora nas duas funções → confirmação explícita; documento identificado')
const sem = await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: d01.id })
ok('sem confirmar: recusado (409)', sem.status === 409 && sem.json?.codigo === 'confirmar_compartilhada')
await pGer.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
await dispensarChecklist(pGer)
await pGer.getByTestId('funcao-caixa').selectOption(d01.id)
await pGer.getByTestId('confirmar-compartilhada').waitFor({ timeout: 10000 })
await foto(pGer, '12-confirmacao-mesma-impressora')
await pGer.getByTestId('confirmar-compartilhada').click()
ok('confirmado na tela: Caixa também em Cozinha Virtual 01', !!(await aguardar(async () => (await painel(pGer)).funcoes.caixa === d01.id)))
await foto(pGer, '12-mesma-impressora-duas-funcoes')
const k12 = nK()
const c12 = nC()
await preConta(A.bal.id, true)
await lancar({ comandaId: A.bal.id }, [{ itemId: AGUA.id, quantidade: 1, complementos: [] }])
const d12 = await aguardar(() => { const n = K.impressos().slice(k12); return n.length >= 2 && n }, 40000)
ok(`ficha e pré-conta na ${COZ}, cada uma identificada pelo tipo`, (d12 ?? []).map((x) => x.tipo).sort().join(',') === 'ficha_cozinha,pre_conta' && d12.every((x) => x.impressora === COZ))
ok('pré-conta traz o cabeçalho RECIBO/EXTRATO; ficha não', texto(d12?.find((x) => x.tipo === 'pre_conta')).includes('RECIBO/EXTRATO') && !texto(d12?.find((x) => x.tipo === 'ficha_cozinha')).includes('RECIBO/EXTRATO'))
ok(`${CAI} não recebeu nada`, nC() === c12)
await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: d02.id })
ok('Caixa devolvida à Caixa Virtual 02', (await painel(pGer)).funcoes.caixa === d02.id)
colher(K, C)

// ════════════════════════════════════════════════════════════════════════════
console.log('\n════ RODADA B: Cozinha 58 mm · Caixa 80 mm ════')
await larguras(58, 80)
const B = await rodadaDocumentos('B', 58, 80)
// Volta ao arranjo da rodada A para o painel final.
await larguras(80, 58)

// ════════════════════════════════════════════════════════════════════════════
secao('P', 'Proteção: nenhum pedido fora da demonstração foi tocado; nada fora do loopback')
const outrasLojas = await um(`select count(*)::int n from impressao_trabalhos where restaurante_id <> $1`, [loja])
ok('nenhum trabalho de impressão em outra loja', outrasLojas.n === 0)
const todosLogs = [...K.logs, ...C.logs].join('\n')
ok('agentes só falaram com 127.0.0.1 (nenhuma URL de produção nos logs)', !/app\.menuzia\.com\.br/.test(todosLogs))

// ── PDFs e varredura de credenciais ─────────────────────────────────────────
const pngs = [...K.impressos(), ...C.impressos()].map((x) => ({ png: x.png, pdf: x.png.replace(/\.png$/, '.pdf'), paperMm: x.paperMm }))
await pngsParaPdf(pngs)
ok('um PDF para cada PNG', pngs.every((p) => existsSync(p.pdf)), `${pngs.length} documentos`)
const arquivos = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? arquivos(join(dir, n)) : [join(dir, n)]))
const suspeitos = []
for (const arq of arquivos(ART)) {
  if (/\.(png|pdf)$/.test(arq)) continue
  const t = readFileSync(arq, 'utf8')
  if (/mza_ag_|credencial|token|Bearer /i.test(t) || t.includes(K.codigo) || t.includes(C.codigo)) suspeitos.push(relative(ART, arq))
}
ok('nenhuma credencial, token ou código de pareamento nos artefatos (txt/jsonl)', suspeitos.length === 0, suspeitos.join(', '))
const binarios = arquivos(ART).filter((a) => /\.(png|pdf)$/.test(a)).filter((a) => /mza_ag_/.test(readFileSync(a).toString('latin1')))
ok('nem dentro dos PNG/PDF', binarios.length === 0)

// ── tabela de jobs + galeria HTML ───────────────────────────────────────────
colher(K, C)
const linhas = tabela.map((l) => ({ ...l, artefato: l.artefato ? relative(ART, l.artefato).replace(/\\/g, '/') : null }))
writeFileSync(join(ART, 'jobs.json'), JSON.stringify(linhas, null, 2))
writeFileSync(join(ART, 'verificacoes.json'), JSON.stringify(res, null, 2))
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const linhaHtml = (l) => {
  const base = l.artefato?.replace(/\.png$/, '')
  const links = base ? `<a href="${base}.png">PNG</a> · <a href="${base}.pdf">PDF</a> · <a href="${base}.txt">TXT</a>` : '—'
  return `<tr><td>${esc(l.cenario)}</td><td><code>${esc(l.job_id)}</code></td><td>${esc(l.tipo)}</td><td>${esc(l.destino)}</td><td>${esc(l.horario)}</td><td>${esc(l.tentativa)}</td><td class="${/^falha/.test(l.resultado) ? 'f' : 'ok'}">${esc(l.resultado)}</td><td>${links}</td></tr>`
}
const miniaturas = linhas.filter((l) => l.artefato).map((l) => `<figure><a href="${l.artefato}"><img src="${l.artefato}" loading="lazy"></a><figcaption>${esc(l.cenario)} · ${esc(l.tipo)} · ${esc(l.destino)}</figcaption></figure>`).join('')
writeFileSync(join(ART, 'index.html'), `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Demo virtual de impressão</title>
<style>body{font:14px Inter,system-ui,sans-serif;background:#EDEEF1;color:#1F2937;margin:16px}table{border-collapse:collapse;background:#fff;width:100%}td,th{border:1px solid #E5E7EB;padding:4px 6px;text-align:left;font-size:12px}
.f{color:#EF4444}.ok{color:#16A34A}.g{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}figure{margin:0;background:#fff;border:1px solid #E5E7EB;padding:6px;border-radius:3px}figure img{width:260px;display:block}figcaption{font-size:11px;color:#6B7280;max-width:260px}</style></head>
<body><h1>Demonstração virtual — Cozinha Virtual 01 × Caixa Virtual 02</h1>
<p>${res.filter((r) => r.passou).length}/${res.length} verificações aprovadas · servidor local ${esc(BASE)} · loja de demonstração</p>
<table><tr><th>Cenário</th><th>job_id</th><th>tipo</th><th>destino</th><th>horário</th><th>tentativa</th><th>resultado</th><th>artefatos</th></tr>${linhas.map(linhaHtml).join('')}</table>
<h2>Impressões</h2><div class="g">${miniaturas}</div></body></html>`)

console.log(`\nArtefatos: ${ART}`)
await browser.close()
const falhas = res.filter((r) => !r.passou).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
if (MANTER) {
  // Contas abertas ficam para o painel; agentes seguem online até o processo ser encerrado.
  console.log('<<DEMO PRONTA>> agentes virtuais seguem rodando (encerre este processo para parar)')
  await db.end()
} else {
  K.parar()
  C.parar()
  await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza demo virtual', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
  await db.end()
  process.exit(falhas ? 1 : 0)
}
