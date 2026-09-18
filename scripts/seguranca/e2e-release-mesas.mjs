/**
 * Release candidate do módulo Mesas e Comandas — o caminho completo, de ponta a ponta.
 *
 * O que os outros E2E cobrem e este NÃO repete: idempotência do envio e ciclo do
 * rascunho (`e2e-checkpoint-e.mjs`), conta/pagamentos/transferências em detalhe
 * (`e2e-etapa-f.mjs`), menu e permissões do garçom (`e2e-garcom.mjs`).
 *
 * O que ESTE arquivo prova:
 *
 *   1. o cenário do dono ligando o módulo até a mesa voltar a livre, em 30 passos;
 *   2. chamar garçom: criar, limite de frequência, corrida entre dois garçons, concluir;
 *   3. catálogo ÚNICO: mexer no item aparece nos dois canais, e o canal esconde sem
 *      cadastro paralelo — com o servidor recusando o que a tela já esconde;
 *   4. fila de impressão: exatamente uma vez, agente offline e reimpressão;
 *   5. QR revogável: link antigo morre, garçom não roda;
 *   6. mesa em operação não é bloqueada nem desativada por baixo da conta;
 *   7. cancelar a conta inteira, com motivo e sem apagar;
 *   8. divisão por itens e pagamento parcial em formas diferentes;
 *   9. concorrência: dois pagamentos, duas transferências, fechamento simultâneo;
 *  10. isolamento entre lojas em toda superfície nova.
 *
 * Refaz a semente no começo (estado conhecido). Só loopback.
 *   node scripts/seguranca/servidor-local.mjs build
 *   node scripts/seguranca/servidor-local.mjs start &
 *   node scripts/seguranca/e2e-release-mesas.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import pg from 'pg'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL, ANON_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)

execFileSync(process.execPath, ['scripts/seguranca/semear-demo-mesas.mjs'], { stdio: 'ignore' })
mkdirSync('.shots', { recursive: true })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)
const passo = (n, t) => console.log(`\n   [${n}] ${t}`)
const uuid = () => crypto.randomUUID()

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const vizinha = (await um(`select id from restaurantes where slug='vizinha-demo'`)).id
const mesaPor = (nome, r = loja) => um(`select id, token, nome from mesas where restaurante_id=$1 and nome=$2`, [r, nome])
const itemPor = (nome) => um(`select id, nome, preco from itens_cardapio where restaurante_id=$1 and nome=$2`, [loja, nome])

const browser = await chromium.launch()

async function logar(usuario, viewport = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' })
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

/** Requisição feita de DENTRO da página: carrega o cookie de sessão, como o painel faz. */
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
        /* resposta sem corpo */
      }
      return { status: r.status, json }
    },
    { url: url.startsWith('http') ? url : `${BASE}${url}`, metodo, corpo },
  )

/**
 * Rascunhos abertos da mesa, no formato que a tela do garçom manda no envio. O servidor
 * só encerra o que ESTA versão viu — mandar lista vazia não encerra nada, de propósito.
 */
const selecoesVistas = (mesaId) =>
  q(`select id, versao from selecoes_mesa where mesa_id=$1 and encerrada_em is null`, [mesaId])

const lancar = async (page, mesaId, itens, chave = uuid(), vistas) =>
  api(page, `/api/admin/mesas/${mesaId}/lancamento`, 'POST', {
    chaveIdempotencia: chave,
    selecoesVistas: vistas ?? (await selecoesVistas(mesaId)),
    itens,
  })

const conta = (page, mesaId) => api(page, `/api/admin/mesas/${mesaId}/conta`)
const agir = (page, mesaId, corpo) => api(page, `/api/admin/mesas/${mesaId}/conta`, 'POST', corpo)

/** Marca um item pelo caminho real do cliente: categoria → card → configurador. */
async function marcar(page, categoria, item) {
  await page.locator('.mesa-categoria', { hasText: categoria }).click()
  await page.locator('.mesa-card', { hasText: item }).locator('text=Selecionar item').click()
  await page.locator('.mesa-avancar', { hasText: 'Adicionar à seleção' }).click()
  await page.waitForTimeout(900)
}

const dono = await logar('dono.local')
const garcom = await logar('garcom.local')

// ════════════════════════════════════════════════════════════════════════════
secao('Cenário completo: do módulo desligado até a mesa voltar a livre')

passo(1, 'dono ativa o módulo')
{
  // A flag nasce false por loja. A semente já a liga; aqui se prova que ela GOVERNA:
  // desligada, a rota pública não existe.
  await q(`update restaurantes set modulo_mesas_ativo = false where id = $1`, [loja])
  const m = await mesaPor('Mesa 01')
  const r = await (await browser.newContext()).newPage().then(async (p) => {
    const resp = await p.goto(`${BASE}/mesa/${m.token}`, { waitUntil: 'domcontentloaded' })
    const status = resp?.status() ?? 0
    await p.context().close()
    return status
  })
  ok('com o módulo desligado, o QR da mesa é 404', r === 404, `HTTP ${r}`)
  await q(`update restaurantes set modulo_mesas_ativo = true where id = $1`, [loja])
}

passo(2, 'dono cadastra um garçom')
{
  // Reexecução: o e-mail técnico da execução anterior ocupa o login no Auth. Limpar só
  // a linha de `usuarios` não basta — sem a conta do Auth, a criação volta a falhar com
  // 409 para sempre. Banco LOCAL e descartável.
  await q(`delete from usuarios where usuario = 'joana.garcom'`)
  await q(`delete from auth.users where email like 'joana.garcom.%@equipe.menuzia.local'`)
  const r = await api(dono.page, '/api/admin/equipe', 'POST', {
    nome: 'Joana Garçom', usuario: 'joana.garcom', papel: 'garcom', senha: SENHA,
  })
  ok('funcionária criada com papel garçom', r.status === 201 && r.json?.funcionario?.papel === 'garcom', `HTTP ${r.status}`)
  const noBanco = await um(`select papel, restaurante_id from usuarios where usuario='joana.garcom'`)
  ok('nasceu na loja de quem cadastrou', noBanco?.restaurante_id === loja)
  ok('a resposta não devolve hash nem e-mail técnico', !JSON.stringify(r.json ?? {}).match(/senha|hash|@equipe\.menuzia/i))
}

passo(3, 'dono cadastra uma mesa')
let MESA
{
  await dono.page.goto(`${BASE}/admin/mesas`, { waitUntil: 'networkidle' })
  await dono.page.locator('button', { hasText: 'Nova mesa' }).first().click()
  await dono.page.locator('aside input').first().fill('Mesa 99')
  await dono.page.locator('button', { hasText: 'Cadastrar mesa' }).click()
  await dono.page.waitForTimeout(1500)
  MESA = await mesaPor('Mesa 99')
  ok('Mesa 99 cadastrada pela tela', !!MESA, MESA?.nome)
}

passo(4, 'dono gera o QR')
let tokenInicial
{
  tokenInicial = MESA.token
  ok('a mesa nasce com token opaco', /^[0-9a-f-]{36}$/i.test(tokenInicial))
  ok('o token não é o id da mesa', tokenInicial !== MESA.id)
  const r = await api(dono.page, `/api/admin/mesas/${MESA.id}/conta`)
  ok('mesa nova não tem conta aberta', r.status === 200 && r.json?.conta === null)
}

passo(5, 'cliente abre o QR')
const cliente = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', isMobile: true, hasTouch: true })
const pc = await cliente.newPage()
{
  await pc.goto(`${BASE}/mesa/${tokenInicial}`, { waitUntil: 'networkidle' })
  const texto = await pc.locator('body').innerText()
  ok('cardápio abre sem login', texto.includes('Cantina Demo'))
  ok('a mesa é identificada na tela', texto.includes('Mesa 99'))
  ok('o aviso de que nada foi enviado está visível', /Nada foi enviado para a cozinha/i.test(texto))
  await pc.screenshot({ path: '.shots/rc-01-cliente-cardapio.png' })
}

passo(6, 'cliente marca um produto simples')
{
  // Item sem grupo obrigatório cai direto na etapa de quantidade.
  await marcar(pc, 'Bebidas', 'Água com Gás')
  const linhas = await q(
    `select si.nome_snapshot from selecao_itens si
       join selecoes_mesa s on s.id = si.selecao_id
      where s.mesa_id = $1 and s.encerrada_em is null`, [MESA.id])
  ok('a seleção foi gravada como rascunho', linhas.length === 1, linhas.map((l) => l.nome_snapshot).join(', '))
  const pedidos = await um(`select count(*)::int as n from pedidos where restaurante_id=$1 and mesa='Mesa 99'`, [loja])
  ok('marcar item NÃO cria pedido', pedidos.n === 0)
  const comandas = await um(`select count(*)::int as n from comandas where mesa_id=$1`, [MESA.id])
  ok('marcar item NÃO cria comanda', comandas.n === 0)
}

passo(7, 'cliente configura um produto com obrigatórios')
{
  await pc.locator('.mesa-categoria', { hasText: 'Burgers' }).click()
  await pc.locator('.mesa-card', { hasText: 'Burger da Casa' }).locator('text=Selecionar item').click()
  await pc.waitForTimeout(400)
  const avancarTravado = await pc.locator('.mesa-avancar').first().isDisabled()
  ok('o botão de avançar nasce travado na etapa obrigatória', avancarTravado)
  const progresso = await pc.locator('.mesa-progresso').first().isVisible()
  ok('o celular mostra o progresso das etapas', progresso)
  const totalEtapas = await pc.locator('.mesa-progresso-passos li').count()
  ok('o progresso lista todas as etapas + quantidade', totalEtapas === 4, `${totalEtapas} passos`)
  await pc.locator('.mesa-opcao', { hasText: 'Ao ponto' }).click()
  ok('escolhida a obrigatória, avançar libera', !(await pc.locator('.mesa-avancar').first().isDisabled()))
  await pc.screenshot({ path: '.shots/rc-02-cliente-configurador.png' })
  await pc.locator('.mesa-avancar').click()
  await pc.waitForTimeout(250)
  await pc.locator('.mesa-avancar').click() // adicionais (opcional)
  await pc.waitForTimeout(250)
  await pc.locator('.mesa-opcao', { hasText: 'Coca-Cola lata' }).first().click()
  await pc.locator('.mesa-avancar').click()
  await pc.waitForTimeout(250)
  await pc.locator('.mesa-avancar', { hasText: 'Adicionar à seleção' }).click()
  await pc.waitForTimeout(1000)
  const linhas = await q(
    `select si.nome_snapshot, si.opcoes from selecao_itens si
       join selecoes_mesa s on s.id = si.selecao_id
      where s.mesa_id = $1 and s.encerrada_em is null order by si.nome_snapshot`, [MESA.id])
  ok('a seleção tem os dois itens', linhas.length === 2, linhas.map((l) => l.nome_snapshot).join(', '))
  const burger = linhas.find((l) => l.nome_snapshot === 'Burger da Casa')
  ok('as opções escolhidas foram gravadas', JSON.stringify(burger?.opcoes ?? []).includes('Ao ponto'))
}

passo(8, 'segundo dispositivo visualiza a seleção')
const cliente2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', isMobile: true, hasTouch: true })
const pc2 = await cliente2.newPage()
{
  // Aparelho DIFERENTE: a sessão da mesa é compartilhada, o rascunho é por aparelho.
  // Quem vê tudo junto é o garçom. Aqui se prova que os dois convivem na mesma sessão.
  await pc2.goto(`${BASE}/mesa/${tokenInicial}`, { waitUntil: 'networkidle' })
  await marcar(pc2, 'Bebidas', 'Suco de Laranja')
  const sessoes = await um(`select count(*)::int as n from sessoes_mesa where mesa_id=$1 and status='aberta'`, [MESA.id])
  ok('os dois celulares estão na MESMA sessão da mesa', sessoes.n === 1, `${sessoes.n} sessão(ões)`)
  const rascunhos = await um(
    `select count(*)::int as n from selecoes_mesa s where s.mesa_id=$1 and s.encerrada_em is null`, [MESA.id])
  ok('cada aparelho tem o seu rascunho aberto', rascunhos.n === 2, `${rascunhos.n} rascunho(s)`)
}

passo(9, 'cliente chama o garçom')
{
  await pc.locator('.mesa-botao-chamar').click()
  await pc.waitForTimeout(400)
  await pc.locator('.mesa-chamar-opcao').first().click()
  await pc.waitForTimeout(1000)
  const c = await um(`select status, motivo, sessao_id from chamados_mesa where mesa_id=$1`, [MESA.id])
  ok('o chamado nasce pendente e ligado à mesa', c?.status === 'pendente' && c?.motivo === 'garcom')
  ok('o chamado guarda a sessão em que foi feito', !!c?.sessao_id)
  const pedidos = await um(`select count(*)::int as n from pedidos where restaurante_id=$1 and mesa='Mesa 99'`, [loja])
  ok('chamar garçom NÃO cria pedido', pedidos.n === 0)
  await pc.screenshot({ path: '.shots/rc-03-cliente-chamado.png' })
  await pc.locator('.mesa-secundario', { hasText: 'Fechar' }).click()
}

passo(10, 'garçom assume o chamado')
let chamadoId
{
  await garcom.page.goto(`${BASE}/admin/mesas`, { waitUntil: 'networkidle' })
  const painel = await garcom.page.locator('text=mesa chamando').first().isVisible().catch(() => false)
  ok('o salão mostra o aviso de mesa chamando', painel)
  await garcom.page.screenshot({ path: '.shots/rc-04-salao-chamado.png' })

  const lista = await api(garcom.page, '/api/admin/mesas/chamados')
  chamadoId = lista.json?.chamados?.[0]?.id
  ok('a API lista o chamado com o nome da mesa', lista.json?.chamados?.[0]?.mesaNome === 'Mesa 99')

  const r = await api(garcom.page, '/api/admin/mesas/chamados', 'POST', { acao: 'assumir', chamadoId })
  ok('garçom assume o chamado', r.status === 200 && r.json?.status === 'assumido', `HTTP ${r.status}`)

  // Corrida: o dono tenta assumir o MESMO chamado. Um só ganha.
  const r2 = await api(dono.page, '/api/admin/mesas/chamados', 'POST', { acao: 'assumir', chamadoId })
  ok('o segundo a assumir recebe 409 com quem pegou', r2.status === 409 && /Garçom Demo/.test(r2.json?.error ?? ''), r2.json?.error)

  const c = await um(`select status, assumido_por_nome, assumido_em from chamados_mesa where id=$1`, [chamadoId])
  ok('fica registrado quem assumiu e quando', c.status === 'assumido' && c.assumido_por_nome === 'Garçom Demo' && !!c.assumido_em)
}

passo(11, 'garçom abre a mesa e vê a seleção')
{
  await garcom.page.goto(`${BASE}/admin/mesas/${MESA.id}`, { waitUntil: 'networkidle' })
  const texto = await garcom.page.locator('body').innerText()
  ok('o bloco da seleção do cliente aparece marcado como NÃO lançado', /NÃO LANÇADO/i.test(texto))
  ok('a seleção dos DOIS aparelhos aparece junta', texto.includes('Água com Gás') && texto.includes('Suco de Laranja'))
  ok('o chamado pendente aparece na tela da mesa', /Atendido/i.test(texto))
  await garcom.page.screenshot({ path: '.shots/rc-05-garcom-mesa.png' })
}

passo(12, 'garçom conclui o chamado')
{
  const r = await api(garcom.page, '/api/admin/mesas/chamados', 'POST', { acao: 'concluir', chamadoId })
  ok('chamado marcado como atendido', r.status === 200)
  const c = await um(`select status, concluido_por_nome, concluido_em from chamados_mesa where id=$1`, [chamadoId])
  ok('fica registrado quem concluiu e quando', c.status === 'concluido' && c.concluido_por_nome === 'Garçom Demo' && !!c.concluido_em)
  const abertos = await api(garcom.page, '/api/admin/mesas/chamados')
  ok('chamado concluído sai da fila do salão', (abertos.json?.chamados ?? []).every((x) => x.id !== chamadoId))
}

passo(13, 'garçom lança manualmente produtos DIFERENTES da seleção')
const FILE = await itemPor('Filé à Parmegiana')
const RISOTO = await itemPor('Risoto de Funghi')
let pedido1
{
  const r = await lancar(garcom.page, MESA.id, [
    { itemId: FILE.id, quantidade: 2, observacao: 'sem alho', complementos: [] },
    { itemId: RISOTO.id, quantidade: 1, observacao: '', complementos: [] },
  ])
  ok('o lançamento foi aceito', r.status === 201, `HTTP ${r.status}`)
  pedido1 = r.json?.pedidoId
}

passo(14, 'envio à cozinha cria EXATAMENTE um pedido')
{
  const pedidos = await q(`select id, numero, canal, mesa, impresso, criado_por_nome from pedidos where restaurante_id=$1 and mesa='Mesa 99'`, [loja])
  ok('exatamente um pedido', pedidos.length === 1, `${pedidos.length} pedido(s)`)
  ok('canal mesa e nome da mesa gravados', pedidos[0].canal === 'mesa' && pedidos[0].mesa === 'Mesa 99')
  ok('quem lançou está gravado', pedidos[0].criado_por_nome === 'Garçom Demo')
  const comanda = await um(`select id, responsavel_nome, aberta_em from comandas where mesa_id=$1 and status='aberta'`, [MESA.id])
  ok('a conta nasceu agora, no primeiro lançamento', !!comanda && !!comanda.aberta_em)
  ok('o responsável operacional da mesa foi registrado', comanda.responsavel_nome === 'Garçom Demo')
  const ev = await um(`select acao, dados from eventos_auditoria where restaurante_id=$1 and acao='mesa.abriu' order by criado_em desc limit 1`, [loja])
  ok('auditoria registrou a abertura da mesa', ev?.dados?.mesa === 'Mesa 99', JSON.stringify(ev?.dados ?? {}))
}

passo(15, 'somente os produtos lançados viraram pedido')
{
  const itens = await q(`select nome, quantidade, observacao from pedido_itens where pedido_id=$1 order by nome`, [pedido1])
  ok('o pedido tem só o que o garçom lançou', itens.length === 2 && itens.every((i) => ['Filé à Parmegiana', 'Risoto de Funghi'].includes(i.nome)),
    itens.map((i) => `${i.quantidade}× ${i.nome}`).join(', '))
  ok('nada da seleção do cliente entrou', !itens.some((i) => ['Água com Gás', 'Suco de Laranja', 'Burger da Casa'].includes(i.nome)))
  ok('a observação do garçom acompanha', itens.find((i) => i.nome === 'Filé à Parmegiana')?.observacao === 'sem alho')
}

passo(16, 'a cozinha recebe o pedido identificado como salão')
{
  const p = await um(`select status, tipo, canal from pedidos where id=$1`, [pedido1])
  ok('entra no fluxo da cozinha em "recebido"', p.status === 'recebido')
  ok('pedido de salão não é entrega', p.tipo === 'retirada')
  const { rows: tokenRows } = await db.query(
    `update restaurantes set impressao_agente_token = $2 where id = $1 returning impressao_agente_token`,
    [loja, uuid()])
  const tokenAgente = tokenRows[0].impressao_agente_token
  const fila = await fetch(`${BASE}/api/agente/pedidos`, { headers: { authorization: `Bearer ${tokenAgente}` } }).then((r) => r.json())
  const naFila = (fila.pedidos ?? []).find((x) => x.id === pedido1)
  ok('o pedido está na fila de impressão', !!naFila)
  ok('a fila identifica a mesa (é o que o recibo imprime)', naFila?.mesa === 'Mesa 99', naFila?.mesa)
  ok('a fila traz os itens com quantidade', (naFila?.itens ?? []).length === 2)
  globalThis.__tokenAgente = tokenAgente
}

passo(17, 'a fila de impressão recebe o pedido exatamente uma vez')
{
  const token = globalThis.__tokenAgente
  const marcar = () => fetch(`${BASE}/api/agente/pedidos/${pedido1}/imprimir`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
  })
  await marcar()
  const depois = await fetch(`${BASE}/api/agente/pedidos`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json())
  ok('depois de impresso, sai da fila', !(depois.pedidos ?? []).some((x) => x.id === pedido1))

  // Agente offline e voltando: varre de novo e NÃO reimprime o que já saiu.
  const reVarredura = await fetch(`${BASE}/api/agente/pedidos`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json())
  ok('reconexão do agente não reimprime pedido já impresso', !(reVarredura.pedidos ?? []).some((x) => x.id === pedido1))
  await marcar()
  const p = await um(`select impresso, reimprimir from pedidos where id=$1`, [pedido1])
  ok('marcar impresso duas vezes é inofensivo', p.impresso === true && p.reimprimir === false)

  // Reimpressão pedida na tela: o mecanismo é a flag que o agente já lê.
  const r = await agir(garcom.page, MESA.id, { acao: 'reimprimir', pedidoId: pedido1 })
  ok('garçom pede reimpressão', r.status === 200)
  const comFlag = await fetch(`${BASE}/api/agente/pedidos`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json())
  ok('o pedido volta à fila por reimpressão', (comFlag.pedidos ?? []).some((x) => x.id === pedido1))
  await marcar()

  const semToken = await fetch(`${BASE}/api/agente/pedidos`).then((r) => r.status)
  ok('a fila não abre sem token', semToken === 400, `HTTP ${semToken}`)
  const tokenErrado = await fetch(`${BASE}/api/agente/pedidos`, { headers: { authorization: `Bearer ${uuid()}` } }).then((r) => r.status)
  ok('token inválido é recusado', tokenErrado === 401, `HTTP ${tokenErrado}`)
}

passo(18, 'o rascunho usado foi encerrado e um novo nasceu vazio')
{
  // O rascunho encerra porque o CICLO de escolha terminou — não porque foi importado.
  const abertos = await q(`select id from selecoes_mesa where mesa_id=$1 and encerrada_em is null`, [MESA.id])
  ok('as seleções vistas pelo garçom foram encerradas', abertos.length === 0, `${abertos.length} aberta(s)`)
  const encerradas = await q(`select id from selecoes_mesa where mesa_id=$1 and encerrada_em is not null`, [MESA.id])
  ok('encerrado, não apagado: o histórico do rascunho continua', encerradas.length === 2)
  // SEM recarregar: a tela do cliente descobre pelo próprio ciclo de leitura (5 s) que o
  // rascunho dela não existe mais, e avisa em vez de deixar os itens sumirem sozinhos.
  await pc.waitForTimeout(7000)
  const texto = await pc.locator('body').innerText()
  ok('o cliente é avisado de que o garçom já anotou', /já anotou seu pedido/i.test(texto), texto.slice(0, 80).split('\n').join(' '))
}

passo(19, 'cliente faz uma nova seleção')
{
  await pc.locator('button', { hasText: 'Começar nova seleção' }).click()
  await pc.waitForTimeout(400)
  await marcar(pc, 'Bebidas', 'Água com Gás')
  const nova = await q(
    `select si.nome_snapshot from selecao_itens si join selecoes_mesa s on s.id = si.selecao_id
      where s.mesa_id=$1 and s.encerrada_em is null`, [MESA.id])
  ok('o rascunho novo começou vazio e tem só o item novo', nova.length === 1 && nova[0].nome_snapshot === 'Água com Gás')
}

passo(20, 'garçom envia o segundo lançamento')
let pedido2
{
  const AGUA = await itemPor('Água com Gás')
  const r = await lancar(garcom.page, MESA.id, [{ itemId: AGUA.id, quantidade: 3, observacao: '', complementos: [] }])
  ok('segundo lançamento aceito', r.status === 201, `HTTP ${r.status}`)
  pedido2 = r.json?.pedidoId
  const c = await conta(garcom.page, MESA.id)
  ok('a conta tem dois lançamentos', (c.json?.conta?.lancamentos ?? []).length === 2)
  ok('os dois lançamentos estão na MESMA comanda', new Set((await q(`select comanda_id from pedidos where id = any($1::uuid[])`, [[pedido1, pedido2]])).map((x) => x.comanda_id)).size === 1)
}

passo(21, 'um item é transferido e outro é cancelado, com motivo')
{
  const c = await conta(garcom.page, MESA.id)
  const linhaAgua = c.json.conta.lancamentos.flatMap((l) => l.itens).find((i) => i.nome === 'Água com Gás')
  const destino = await mesaPor('Mesa 03')

  // Transferência PARCIAL: 1 das 3 águas vai para a Mesa 03.
  const t = await agir(garcom.page, MESA.id, {
    acao: 'transferir_itens', destinoMesaId: destino.id, itemIds: [linhaAgua.id], quantidades: [1],
  })
  ok('garçom transfere 1 das 3 águas', t.status === 200 && t.json?.itens === 1, `HTTP ${t.status}`)
  const naOrigem = await um(`select quantidade from pedido_itens where id=$1`, [linhaAgua.id])
  ok('a linha de origem cai de 3 para 2', naOrigem.quantidade === 2, naOrigem.quantidade)
  const noDestino = await q(
    `select pi.quantidade, pi.preco_unitario, p.impresso from pedido_itens pi
       join pedidos p on p.id = pi.pedido_id where p.mesa='Mesa 03' and pi.nome='Água com Gás'`)
  ok('nasce 1 água na Mesa 03 com o mesmo preço', noDestino.length === 1 && noDestino[0].quantidade === 1 && Number(noDestino[0].preco_unitario) === 7)
  ok('o item transferido NÃO vai para a fila de impressão (já foi produzido)', noDestino[0].impresso === true)

  // Cancelamento exige motivo e é da gestão.
  const linhaRisoto = c.json.conta.lancamentos.flatMap((l) => l.itens).find((i) => i.nome === 'Risoto de Funghi')
  const semMotivo = await agir(dono.page, MESA.id, { acao: 'cancelar_item', itemId: linhaRisoto.id, motivo: '' })
  ok('cancelar sem motivo é recusado', semMotivo.status === 400, semMotivo.json?.error)
  const doGarcom = await agir(garcom.page, MESA.id, { acao: 'cancelar_item', itemId: linhaRisoto.id, motivo: 'queimou' })
  ok('garçom não cancela item lançado', doGarcom.status === 403, `HTTP ${doGarcom.status}`)
  const r = await agir(dono.page, MESA.id, { acao: 'cancelar_item', itemId: linhaRisoto.id, motivo: 'queimou na cozinha' })
  ok('dono cancela com motivo', r.status === 200)
  const item = await um(`select cancelado_em, cancelado_motivo, cancelado_por_nome from pedido_itens where id=$1`, [linhaRisoto.id])
  ok('o item continua no banco, marcado', !!item.cancelado_em && item.cancelado_motivo === 'queimou na cozinha' && item.cancelado_por_nome === 'Dono Demo')
}

passo(22, 'a comanda recebe a taxa de serviço')
{
  const c = await conta(dono.page, MESA.id)
  const t = c.json.conta.totais
  // 2× Filé (68) + 2× Água (7) = 150; taxa herdada da loja.
  ok('subtotal sem o cancelado e sem o transferido', t.subtotal === 150, t.subtotal)
  ok('taxa de serviço de 10% aplicada', t.taxaServico === 15, t.taxaServico)
  ok('total = subtotal + taxa', t.total === 165, t.total)

  const doGarcom = await agir(garcom.page, MESA.id, { acao: 'ajustar_valores', taxaServico: 0 })
  ok('garçom não altera a taxa', doGarcom.status === 403, `HTTP ${doGarcom.status}`)
  const acima = await agir(dono.page, MESA.id, { acao: 'ajustar_valores', taxaServico: 40 })
  ok('taxa acima de 30% é recusada', acima.status === 400, acima.json?.error)

  const semMotivo = await agir(dono.page, MESA.id, { acao: 'ajustar_valores', desconto: 10 })
  ok('desconto sem motivo é recusado', semMotivo.status === 400, semMotivo.json?.error)
  const d = await agir(dono.page, MESA.id, { acao: 'ajustar_valores', desconto: 15, descontoMotivo: 'cortesia pela demora' })
  ok('dono aplica desconto com motivo', d.status === 200)
  const comDesconto = (await conta(dono.page, MESA.id)).json.conta.totais
  ok('total com desconto: 150 + 15 − 15 = 150', comDesconto.total === 150, comDesconto.total)

  const absurdo = await agir(dono.page, MESA.id, { acao: 'ajustar_valores', desconto: 9999, descontoMotivo: 'teste' })
  ok('desconto maior que a conta não gera total negativo', absurdo.status === 200 && (await conta(dono.page, MESA.id)).json.conta.totais.total === 0)
  await agir(dono.page, MESA.id, { acao: 'ajustar_valores', desconto: 15, descontoMotivo: 'cortesia pela demora' })
}

passo(23, 'a conta é dividida')
{
  await agir(dono.page, MESA.id, { acao: 'ajustar_mesa', pessoas: 3 })
  const c = await conta(dono.page, MESA.id)
  ok('a quantidade de pessoas fica na comanda', c.json.conta.pessoas === 3)
  await dono.page.goto(`${BASE}/admin/mesas/${MESA.id}`, { waitUntil: 'networkidle' })
  await dono.page.locator('[role="tab"]', { hasText: 'Conta' }).click()
  await dono.page.waitForTimeout(1500)
  const texto = await dono.page.locator('body').innerText()
  ok('a tela mostra a divisão por pessoa', /Dividir o que falta por 3/i.test(texto), texto.match(/Dividir o que falta por 3:[^\n]*/)?.[0])
  await dono.page.screenshot({ path: '.shots/rc-06-conta-divisao.png' })
}

passo(24, 'pagamento parcial em uma forma')
{
  const r = await agir(dono.page, MESA.id, { acao: 'pagamento', forma: 'pix', valor: 50, chave: uuid() })
  ok('Pix de 50 registrado', r.status === 200, `HTTP ${r.status}`)
  const t = (await conta(dono.page, MESA.id)).json.conta.totais
  ok('pago 50, falta 100', t.pago === 50 && t.restante === 100, `pago ${t.pago} / falta ${t.restante}`)

  const negativo = await agir(dono.page, MESA.id, { acao: 'pagamento', forma: 'pix', valor: -10, chave: uuid() })
  ok('pagamento negativo é recusado', negativo.status === 400, negativo.json?.error)
  const acima = await agir(dono.page, MESA.id, { acao: 'pagamento', forma: 'pix', valor: 500, chave: uuid() })
  ok('pagamento acima do que falta é recusado', acima.status === 400, acima.json?.error)
  const inventada = await agir(dono.page, MESA.id, { acao: 'pagamento', forma: 'bitcoin', valor: 10, chave: uuid() })
  ok('forma inventada pelo navegador é recusada', inventada.status === 400, inventada.json?.error)
}

passo(25, 'restante em outra forma, com troco')
{
  const chave = uuid()
  const r = await agir(dono.page, MESA.id, { acao: 'pagamento', forma: 'dinheiro', valor: 100, recebido: 150, chave })
  ok('dinheiro de 100 com 150 recebido devolve 50 de troco', r.status === 200 && r.json?.troco === 50, `troco ${r.json?.troco}`)
  const repetido = await agir(dono.page, MESA.id, { acao: 'pagamento', forma: 'dinheiro', valor: 100, recebido: 150, chave })
  ok('a mesma chave não cobra duas vezes', repetido.status === 200 && repetido.json?.idempotente === true)
  const pags = await q(`select forma, valor, troco from pagamentos_comanda where comanda_id = (select id from comandas where mesa_id=$1 and status='aberta') order by criado_em`, [MESA.id])
  ok('dois pagamentos, de formas diferentes', pags.length === 2 && pags[0].forma === 'pix' && pags[1].forma === 'dinheiro')
  ok('o troco ficou registrado', Number(pags[1].troco) === 50, pags[1].troco)
}

passo(26, 'o saldo chega a zero')
{
  const t = (await conta(dono.page, MESA.id)).json.conta.totais
  ok('falta pagar zero', t.restante === 0, t.restante)
}

passo(27, 'a comanda é finalizada')
{
  const doGarcomAntes = await agir(garcom.page, MESA.id, { acao: 'fechar' })
  ok('garçom pode fechar (tem comanda.fechar)', doGarcomAntes.status === 200, `HTTP ${doGarcomAntes.status}`)
  const comanda = await um(`select status, total_final, fechada_por_nome, fechada_em from comandas where mesa_id=$1 order by aberta_em desc limit 1`, [MESA.id])
  ok('comanda fechada com total final e autor', comanda.status === 'fechada' && Number(comanda.total_final) === 150 && !!comanda.fechada_por_nome)
  const pedidos = await q(`select pago from pedidos where comanda_id = (select id from comandas where mesa_id=$1 order by aberta_em desc limit 1)`, [MESA.id])
  ok('os lançamentos ficam pagos', pedidos.every((p) => p.pago === true))
  const novo = await lancar(garcom.page, MESA.id, [{ itemId: FILE.id, quantidade: 1, observacao: '', complementos: [] }])
  ok('depois de fechada, um lançamento novo abre OUTRA conta (não reabre a fechada)', novo.status === 201)
  const contas = await q(`select status from comandas where mesa_id=$1 order by aberta_em`, [MESA.id])
  ok('a conta fechada continua fechada', contas.filter((c) => c.status === 'fechada').length === 1, contas.map((c) => c.status).join(', '))
  // A conta nova existe só para provar o ponto acima; cancelada para a mesa voltar a livre.
  await agir(dono.page, MESA.id, { acao: 'cancelar_comanda', motivo: 'aberta por engano no teste' })
}

passo(28, 'a mesa volta a livre')
{
  const abertas = await q(`select id from comandas where mesa_id=$1 and status='aberta'`, [MESA.id])
  ok('nenhuma conta aberta na mesa', abertas.length === 0)
  const sessoes = await q(`select id from sessoes_mesa where mesa_id=$1 and status='aberta'`, [MESA.id])
  ok('a sessão da mesa foi encerrada', sessoes.length === 0)
  const rascunhos = await q(`select id from selecoes_mesa where mesa_id=$1 and encerrada_em is null`, [MESA.id])
  ok('nenhum rascunho público sobrou aberto', rascunhos.length === 0)
  await garcom.page.goto(`${BASE}/admin/mesas`, { waitUntil: 'networkidle' })
  const card = garcom.page.locator('div').filter({ hasText: /^Mesa 99/ }).first()
  ok('o salão mostra a Mesa 99 como livre', /Livre/i.test(await card.innerText().catch(() => '')))
}

passo(29, 'o QR continua apontando para a mesma mesa')
{
  const agora = await mesaPor('Mesa 99')
  ok('o token não mudou no fechamento', agora.token === tokenInicial)
  const r = await pc.goto(`${BASE}/mesa/${tokenInicial}`, { waitUntil: 'networkidle' })
  ok('o QR antigo abre o cardápio para o próximo atendimento', (r?.status() ?? 0) === 200)
  const texto = await pc.locator('body').innerText()
  ok('e a seleção começa vazia', !/Ver minha seleção/i.test(texto))
}

passo(30, 'histórico e auditoria continuam completos')
{
  const eventos = await q(
    `select acao from eventos_auditoria where restaurante_id=$1 order by criado_em`, [loja])
  const acoes = new Set(eventos.map((e) => e.acao))
  for (const esperada of [
    'equipe.criou', 'mesa.abriu', 'mesa.enviou_cozinha', 'chamado.criou', 'chamado.assumiu', 'chamado.concluiu',
    'mesa.transferiu_itens', 'conta.cancelou_item', 'conta.ajustou', 'conta.pagamento', 'conta.fechou',
    'conta.reimprimiu', 'conta.cancelou_comanda',
  ]) {
    ok(`auditoria tem ${esperada}`, acoes.has(esperada))
  }
  const comSenha = await q(
    `select id from eventos_auditoria where restaurante_id=$1 and dados::text ~* '(senha|password|token|@equipe\\.menuzia)'`, [loja])
  ok('nenhum evento guarda senha, token ou e-mail técnico', comSenha.length === 0, `${comSenha.length} suspeito(s)`)

  await dono.page.goto(`${BASE}/admin/auditoria`, { waitUntil: 'networkidle' })
  await dono.page.waitForTimeout(1200)
  const texto = await dono.page.locator('body').innerText()
  ok('a tela de auditoria lista os eventos em português', /Abriu a mesa/i.test(texto) && /Registrou pagamento/i.test(texto))
  await dono.page.screenshot({ path: '.shots/rc-07-auditoria.png' })
  const doGarcom = await garcom.page.goto(`${BASE}/admin/auditoria`, { waitUntil: 'domcontentloaded' })
  ok('garçom não entra na auditoria', new URL(garcom.page.url()).pathname === '/admin/mesas', new URL(garcom.page.url()).pathname + ` HTTP ${doGarcom?.status()}`)
}

// ════════════════════════════════════════════════════════════════════════════
secao('Chamar garçom: limite de frequência e chamado abandonado')
{
  const M = await mesaPor('Mesa 01')
  await q(`delete from chamados_mesa where mesa_id=$1`, [M.id])

  const chamar = (motivo = 'garcom') =>
    fetch(`${BASE}/api/mesa/${M.token}/chamado`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo }),
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))

  const a = await chamar()
  ok('primeiro chamado criado', a.status === 200 && a.json?.jaExistia === false)
  const b = await chamar()
  ok('tocar de novo devolve o mesmo chamado, não cria outro', b.status === 200 && b.json?.jaExistia === true && b.json?.id === a.json.id)
  const quantos = await um(`select count(*)::int as n from chamados_mesa where mesa_id=$1`, [M.id])
  ok('só existe um chamado no banco', quantos.n === 1)

  const outro = await chamar('conta')
  ok('motivo diferente é outro chamado', outro.status === 200 && outro.json?.id !== a.json.id)
  const invalido = await chamar('pagar_agora')
  ok('motivo fora da lista cai no padrão, não cria valor inválido', invalido.json?.motivo === 'garcom')

  // Concluído e chamado de novo na mesma hora: o limite de frequência entra.
  await q(`update chamados_mesa set status='concluido', concluido_em=now() where mesa_id=$1 and motivo='garcom'`, [M.id])
  const rapido = await chamar()
  ok('chamar de novo logo depois recebe 429 com o tempo de espera', rapido.status === 429 && /Aguarde/i.test(rapido.json?.error ?? ''), rapido.json?.error)

  await q(`update chamados_mesa set concluido_em = now() - interval '2 minutes' where mesa_id=$1 and motivo='garcom'`, [M.id])
  const depois = await chamar()
  ok('passada a carência, pode chamar de novo', depois.status === 200 && depois.json?.jaExistia === false)

  // Chamado abandonado (ninguém concluiu) expira e libera a mesa.
  await q(`update chamados_mesa set criado_em = now() - interval '2 hours' where id=$1`, [depois.json.id])
  const aposExpirar = await chamar()
  ok('chamado abandonado expira e a mesa pode chamar de novo', aposExpirar.status === 200 && aposExpirar.json?.id !== depois.json.id)
  const expirado = await um(`select status from chamados_mesa where id=$1`, [depois.json.id])
  ok('o abandonado fica marcado como expirado, não apagado', expirado?.status === 'expirado')

  // Mesa bloqueada não recebe chamado, e mesa de outra loja é inalcançável pelo token.
  const bloqueada = await mesaPor('Varanda 02')
  const rb = await fetch(`${BASE}/api/mesa/${bloqueada.token}/chamado`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo: 'garcom' }),
  })
  ok('mesa bloqueada devolve 404 (o token não resolve)', rb.status === 404, `HTTP ${rb.status}`)

  const anon = await fetch(`${BASE}/api/admin/mesas/chamados`).then((r) => r.status)
  ok('a fila de chamados do salão exige login', anon === 401, `HTTP ${anon}`)
  const atendente = await logar('atendente.local')
  const ra = await api(atendente.page, '/api/admin/mesas/chamados')
  ok('atendente do delivery não vê a fila do salão', ra.status === 403, `HTTP ${ra.status}`)
  await atendente.ctx.close()
}

// ════════════════════════════════════════════════════════════════════════════
secao('Catálogo único: uma fonte de verdade para os dois canais')
{
  const item = await itemPor('Filé à Parmegiana')
  const M = await mesaPor('Mesa 01')

  // O dono muda o item UMA vez, pelo cadastro de sempre.
  await q(
    `update itens_cardapio set nome = 'Filé à Parmegiana Especial', preco = 79.90,
            descricao = 'Agora com fritas rústicas', imagem_url = 'https://exemplo/file.webp'
      where id = $1`, [item.id])

  const vitrine = await (await browser.newContext()).newPage()
  await vitrine.goto(`${BASE}/loja/cantina-demo`, { waitUntil: 'networkidle' })
  await vitrine.waitForTimeout(1500)
  const textoVitrine = await vitrine.locator('body').innerText()
  ok('delivery mostra o nome novo', textoVitrine.includes('Filé à Parmegiana Especial'))
  ok('delivery mostra o preço novo', /79[.,]90/.test(textoVitrine))

  const mesaPage = await (await browser.newContext()).newPage()
  await mesaPage.goto(`${BASE}/mesa/${M.token}`, { waitUntil: 'networkidle' })
  const textoMesa = await mesaPage.locator('body').innerText()
  ok('mesa mostra o MESMO nome novo, sem recadastro', textoMesa.includes('Filé à Parmegiana Especial'))
  ok('mesa mostra o MESMO preço novo', /79[.,]90/.test(textoMesa))

  const linhas = await um(`select count(*)::int as n from itens_cardapio where restaurante_id=$1 and nome ilike 'Filé à Parmegiana%'`, [loja])
  ok('existe UMA linha do item — nada foi duplicado para o salão', linhas.n === 1, `${linhas.n} linha(s)`)

  // Canal: fora do salão, o item sai da mesa e continua no delivery.
  await q(`update itens_cardapio set disponivel_salao = false where id=$1`, [item.id])
  await mesaPage.reload({ waitUntil: 'networkidle' })
  ok('item fora do salão desaparece da mesa', !(await mesaPage.locator('body').innerText()).includes('Filé à Parmegiana Especial'))
  await vitrine.reload({ waitUntil: 'networkidle' })
  await vitrine.waitForTimeout(1500)
  ok('e continua no delivery', (await vitrine.locator('body').innerText()).includes('Filé à Parmegiana Especial'))

  const r = await lancar(garcom.page, M.id, [{ itemId: item.id, quantidade: 1, observacao: '', complementos: [] }])
  ok('o servidor recusa lançar no salão o item fora do canal', r.status === 409, `HTTP ${r.status}`)
  ok('a resposta diz QUAL item travou e por quê', r.json?.itensIndisponiveis?.[0]?.itemId === item.id && /não é vendido no salão/i.test(r.json?.itensIndisponiveis?.[0]?.motivo ?? ''), r.json?.itensIndisponiveis?.[0]?.motivo)

  // Fora do delivery, o inverso.
  await q(`update itens_cardapio set disponivel_salao = true, disponivel_delivery = false where id=$1`, [item.id])
  await vitrine.reload({ waitUntil: 'networkidle' })
  await vitrine.waitForTimeout(1500)
  ok('item fora do delivery desaparece da vitrine', !(await vitrine.locator('body').innerText()).includes('Filé à Parmegiana Especial'))
  await mesaPage.reload({ waitUntil: 'networkidle' })
  ok('e volta a aparecer na mesa', (await mesaPage.locator('body').innerText()).includes('Filé à Parmegiana Especial'))

  const foraDosDois = await db.query(`update itens_cardapio set disponivel_salao = false where id=$1`, [item.id]).then(() => null).catch((e) => e.message)
  ok('o banco recusa item fora dos dois canais', /itens_cardapio_canal_check/.test(foraDosDois ?? ''), foraDosDois?.slice(0, 60))

  // Item pausado e item que não é servido hoje também travam, com o motivo certo.
  await q(`update itens_cardapio set disponivel_delivery = true, status='pausado' where id=$1`, [item.id])
  const pausado = await lancar(garcom.page, M.id, [{ itemId: item.id, quantidade: 1, observacao: '', complementos: [] }])
  ok('item pausado é recusado com o motivo certo', pausado.status === 409 && /pausado ou esgotado/i.test(pausado.json?.itensIndisponiveis?.[0]?.motivo ?? ''))
  await q(`update itens_cardapio set status='disponivel', dias_disponiveis = array[]::int[] where id=$1`, [item.id])
  const foraDoDia = await lancar(garcom.page, M.id, [{ itemId: item.id, quantidade: 1, observacao: '', complementos: [] }])
  ok('item fora do dia é recusado com o motivo certo', foraDoDia.status === 409 && /não é servido hoje/i.test(foraDoDia.json?.itensIndisponiveis?.[0]?.motivo ?? ''))

  // Só o item travado é recusado; o resto do lançamento continua válido.
  const AGUA = await itemPor('Água com Gás')
  const misto = await lancar(garcom.page, M.id, [
    { itemId: item.id, quantidade: 1, observacao: '', complementos: [] },
    { itemId: AGUA.id, quantidade: 1, observacao: '', complementos: [] },
  ])
  ok('lançamento com um item travado não cria pedido nenhum', misto.status === 409)
  ok('e a resposta aponta só a linha travada', (misto.json?.itensIndisponiveis ?? []).length === 1 && misto.json.itensIndisponiveis[0].itemId === item.id)
  const soOValido = await lancar(garcom.page, M.id, [{ itemId: AGUA.id, quantidade: 1, observacao: '', complementos: [] }])
  ok('removido o item travado, o resto do lançamento passa', soOValido.status === 201, `HTTP ${soOValido.status}`)

  await q(`update itens_cardapio set nome='Filé à Parmegiana', preco=68, descricao='', dias_disponiveis=array[0,1,2,3,4,5,6] where id=$1`, [item.id])
  await vitrine.context().close()
  await mesaPage.context().close()
}

// ════════════════════════════════════════════════════════════════════════════
secao('Loja fechada para delivery não fecha o salão')
{
  const M = await mesaPor('Mesa 03')
  const AGUA = await itemPor('Água com Gás')
  await q(`update restaurantes set status_loja='fechado_manual' where id=$1`, [loja])
  const r = await lancar(garcom.page, M.id, [{ itemId: AGUA.id, quantidade: 1, observacao: '', complementos: [] }])
  ok('garçom lança na mesa com o delivery pausado', r.status === 201, `HTTP ${r.status} ${r.json?.error ?? ''}`)
  const publico = await fetch(`${BASE}/api/loja/cantina-demo/pedido`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'retirada', cliente: { nome: 'X', telefone: '11999999999' }, itens: [{ itemId: AGUA.id, quantidade: 1 }], pagamento: 'pix' }),
  })
  ok('e o delivery continua recusando pedido de fora', publico.status >= 400, `HTTP ${publico.status}`)
  await q(`update restaurantes set status_loja='aberto_manual' where id=$1`, [loja])
}

// ════════════════════════════════════════════════════════════════════════════
secao('QR revogável')
{
  const M = await mesaPor('Mesa 01')
  const antigo = M.token
  // Abre o cardápio no token atual para EXISTIR uma sessão que a rotação tenha de encerrar.
  const antesDaRotacao = await (await browser.newContext()).newPage()
  await antesDaRotacao.goto(`${BASE}/mesa/${antigo}`, { waitUntil: 'networkidle' })
  const sessaoAntes = await um(`select id from sessoes_mesa where mesa_id=$1 and status='aberta'`, [M.id])
  ok('havia uma sessão aberta antes de rodar o QR', !!sessaoAntes)
  await antesDaRotacao.context().close()

  const doGarcom = await api(garcom.page, `/api/admin/mesas/${M.id}/estado`, 'POST', { acao: 'rodar_qr' })
  ok('garçom não roda o QR', doGarcom.status === 403, `HTTP ${doGarcom.status}`)

  const r = await api(dono.page, `/api/admin/mesas/${M.id}/estado`, 'POST', { acao: 'rodar_qr' })
  ok('dono roda o QR e recebe o token novo', r.status === 200 && /^[0-9a-f-]{36}$/i.test(r.json?.token ?? ''), `HTTP ${r.status}`)
  ok('o token mudou', r.json.token !== antigo)

  const p = await (await browser.newContext()).newPage()
  const velho = await p.goto(`${BASE}/mesa/${antigo}`, { waitUntil: 'domcontentloaded' })
  ok('o QR antigo morre na hora', (velho?.status() ?? 0) === 404, `HTTP ${velho?.status()}`)
  const novo = await p.goto(`${BASE}/mesa/${r.json.token}`, { waitUntil: 'domcontentloaded' })
  ok('o QR novo funciona', (novo?.status() ?? 0) === 200, `HTTP ${novo?.status()}`)
  await p.context().close()

  const ev = await um(`select dados from eventos_auditoria where restaurante_id=$1 and acao='mesa.rodou_qr' order by criado_em desc limit 1`, [loja])
  ok('a rotação é auditada', !!ev)
  ok('o token NÃO aparece na auditoria', !JSON.stringify(ev.dados).includes(r.json.token))

  const depoisDaRotacao = await um(`select status, encerrada_em from sessoes_mesa where id=$1`, [sessaoAntes.id])
  ok('a sessão que usava o token antigo foi encerrada', depoisDaRotacao.status === 'encerrada' && !!depoisDaRotacao.encerrada_em,
    depoisDaRotacao.status)

  const deOutraLoja = await mesaPor('Mesa V1', vizinha)
  const cruzado = await api(dono.page, `/api/admin/mesas/${deOutraLoja.id}/estado`, 'POST', { acao: 'rodar_qr' })
  ok('não se roda o QR de mesa de outra loja', cruzado.status === 404, `HTTP ${cruzado.status}`)
}

// ════════════════════════════════════════════════════════════════════════════
secao('Mesa em operação não sai de operação por baixo da conta')
{
  const M = await mesaPor('Mesa 03') // tem conta aberta (lançada no teste da loja fechada)
  const bloquear = await api(dono.page, `/api/admin/mesas/${M.id}/estado`, 'POST', { acao: 'bloquear' })
  ok('bloquear mesa com conta aberta é recusado', bloquear.status === 409 && bloquear.json?.codigo === 'comanda_aberta', bloquear.json?.error)
  const desativar = await api(dono.page, `/api/admin/mesas/${M.id}/estado`, 'POST', { acao: 'desativar' })
  ok('desativar mesa com conta aberta é recusado', desativar.status === 409, desativar.json?.error)

  const livre = await mesaPor('Varanda 01')
  const b = await api(dono.page, `/api/admin/mesas/${livre.id}/estado`, 'POST', { acao: 'bloquear' })
  ok('mesa livre é bloqueada', b.status === 200)
  const naoLanca = await lancar(garcom.page, livre.id, [{ itemId: (await itemPor('Água com Gás')).id, quantidade: 1, observacao: '', complementos: [] }])
  ok('mesa bloqueada não recebe lançamento', naoLanca.status === 409, `HTTP ${naoLanca.status}`)
  const d = await api(dono.page, `/api/admin/mesas/${livre.id}/estado`, 'POST', { acao: 'desativar' })
  ok('mesa bloqueada pode ser desativada (não tem conta)', d.status === 200)
  const mesaDb = await um(`select ativa, bloqueada_em from mesas where id=$1`, [livre.id])
  ok('desativar não apaga o cadastro nem o histórico', mesaDb.ativa === false && mesaDb.bloqueada_em !== null)
  await api(dono.page, `/api/admin/mesas/${livre.id}/estado`, 'POST', { acao: 'reativar' })
  await api(dono.page, `/api/admin/mesas/${livre.id}/estado`, 'POST', { acao: 'desbloquear' })
  const eventos = await q(`select acao from eventos_auditoria where restaurante_id=$1 and acao like 'mesa.%' and entidade='mesa'`, [loja])
  const acoes = new Set(eventos.map((e) => e.acao))
  ok('as quatro mudanças de estado ficam auditadas', ['mesa.bloquear', 'mesa.desativar', 'mesa.reativar', 'mesa.desbloquear'].every((a) => acoes.has(a)), [...acoes].join(', '))
}

// ════════════════════════════════════════════════════════════════════════════
secao('Cancelar a conta inteira')
{
  const M = await mesaPor('Mesa 03')
  const antes = await conta(dono.page, M.id)
  const comandaId = antes.json.conta.comandaId

  const doGarcom = await agir(garcom.page, M.id, { acao: 'cancelar_comanda', motivo: 'teste' })
  ok('garçom não cancela a conta', doGarcom.status === 403, `HTTP ${doGarcom.status}`)
  const semMotivo = await agir(dono.page, M.id, { acao: 'cancelar_comanda', motivo: '  ' })
  ok('cancelar sem motivo é recusado', semMotivo.status === 400, semMotivo.json?.error)

  // Com dinheiro recebido, cancelar é bloqueado: primeiro estorna.
  await agir(dono.page, M.id, { acao: 'pagamento', forma: 'pix', valor: 1, chave: uuid() })
  const comPagamento = await agir(dono.page, M.id, { acao: 'cancelar_comanda', motivo: 'cliente desistiu' })
  ok('conta com pagamento não é cancelada', comPagamento.status === 400 && /Estorne/i.test(comPagamento.json?.error ?? ''), comPagamento.json?.error)
  const pag = (await conta(dono.page, M.id)).json.conta.pagamentos[0]
  await agir(dono.page, M.id, { acao: 'estorno', pagamentoId: pag.id, motivo: 'cobrado por engano' })

  const r = await agir(dono.page, M.id, { acao: 'cancelar_comanda', motivo: 'cliente desistiu antes de consumir' })
  ok('dono cancela a conta com motivo', r.status === 200, `HTTP ${r.status} ${r.json?.error ?? ''}`)
  const c = await um(`select status, cancelada_motivo, cancelada_por_nome, total_final from comandas where id=$1`, [comandaId])
  ok('a comanda fica cancelada, com motivo e autor', c.status === 'cancelada' && /desistiu/.test(c.cancelada_motivo) && c.cancelada_por_nome === 'Dono Demo')
  ok('a conta cancelada não vale como venda (total 0)', Number(c.total_final) === 0)
  const pedidos = await q(`select status, reimprimir from pedidos where comanda_id=$1`, [comandaId])
  ok('os lançamentos foram cancelados, não apagados', pedidos.length > 0 && pedidos.every((p) => p.status === 'cancelado'))
  ok('e não ficam com reimpressão pendente', pedidos.every((p) => p.reimprimir === false))
  const itens = await um(`select count(*)::int as n from pedido_itens pi join pedidos p on p.id=pi.pedido_id where p.comanda_id=$1`, [comandaId])
  ok('os itens continuam consultáveis no histórico', itens.n > 0, `${itens.n} item(ns)`)
  const livre = await q(`select id from comandas where mesa_id=$1 and status='aberta'`, [M.id])
  ok('a mesa volta a livre', livre.length === 0)
  const depois = await agir(dono.page, M.id, { acao: 'pagamento', forma: 'pix', valor: 10, chave: uuid() })
  ok('conta cancelada não recebe pagamento', depois.status === 409, `HTTP ${depois.status}`)
}

// ════════════════════════════════════════════════════════════════════════════
secao('Concorrência de verdade')
{
  const M = await mesaPor('Mesa 02') // tem conta aberta desde a semente
  const AGUA = await itemPor('Água com Gás')
  const c0 = await conta(garcom.page, M.id)
  const restante = c0.json.conta.totais.restante

  // Dois pagamentos simultâneos do MESMO restante: só um pode passar.
  const [p1, p2] = await Promise.all([
    agir(dono.page, M.id, { acao: 'pagamento', forma: 'pix', valor: restante, chave: uuid() }),
    agir(garcom.page, M.id, { acao: 'pagamento', forma: 'credito', valor: restante, chave: uuid() }),
  ])
  const aceitos = [p1, p2].filter((r) => r.status === 200).length
  ok('dois pagamentos do restante em paralelo: só um passa', aceitos === 1, `${aceitos} aceito(s)`)
  const t = (await conta(dono.page, M.id)).json.conta.totais
  ok('a conta não recebeu mais do que devia', t.pago === restante && t.restante === 0, `pago ${t.pago}`)

  // Dois fechamentos simultâneos: um fecha, o outro vê a conta já fechada.
  const [f1, f2] = await Promise.all([
    agir(dono.page, M.id, { acao: 'fechar' }),
    agir(garcom.page, M.id, { acao: 'fechar' }),
  ])
  ok('dois fechamentos em paralelo: um só fecha', [f1, f2].filter((r) => r.status === 200).length === 1)
  const fechadas = await q(`select id from comandas where mesa_id=$1 and status='fechada'`, [M.id])
  ok('uma comanda fechada, não duas', fechadas.length === 1)

  // Dois lançamentos simultâneos na mesma mesa livre: uma comanda só.
  const MesaNova = await mesaPor('Mesa 01')
  const [l1, l2] = await Promise.all([
    lancar(dono.page, MesaNova.id, [{ itemId: AGUA.id, quantidade: 1, observacao: '', complementos: [] }]),
    lancar(garcom.page, MesaNova.id, [{ itemId: AGUA.id, quantidade: 2, observacao: '', complementos: [] }]),
  ])
  ok('dois garçons lançando junto: os dois pedidos entram', l1.status === 201 && l2.status === 201)
  const abertas = await q(`select id from comandas where mesa_id=$1 and status='aberta'`, [MesaNova.id])
  ok('mas numa comanda só (índice único parcial)', abertas.length === 1, `${abertas.length} comanda(s)`)

  // Duas transferências simultâneas do mesmo item: uma move, a outra não acha mais.
  const cc = await conta(dono.page, MesaNova.id)
  const linha = cc.json.conta.lancamentos.flatMap((l) => l.itens)[0]
  const d1 = await mesaPor('Varanda 01')
  const [t1, t2] = await Promise.all([
    agir(dono.page, MesaNova.id, { acao: 'transferir_itens', destinoMesaId: d1.id, itemIds: [linha.id] }),
    agir(garcom.page, MesaNova.id, { acao: 'transferir_itens', destinoMesaId: d1.id, itemIds: [linha.id] }),
  ])
  const aceitas = [t1, t2].filter((r) => r.status === 200).length
  ok('transferência simultânea do mesmo item: uma passa, a outra não acha mais', aceitas === 1, `${t1.status}/${t2.status}`)
  // A linha é UMA: ela mudou de comanda, não foi copiada.
  const copias = await um(`select count(*)::int as n from pedido_itens where id = $1`, [linha.id])
  ok('a linha original continua única (mudou de conta, não foi copiada)', copias.n === 1)
  const noDestino = await um(
    `select count(*)::int as n from pedido_itens pi
       join pedidos p on p.id = pi.pedido_id
       join comandas c on c.id = p.comanda_id
      where c.mesa_id = $1 and c.status = 'aberta' and pi.cancelado_em is null`, [d1.id])
  ok('o destino recebeu exatamente uma linha', noDestino.n === 1, `${noDestino.n} linha(s)`)
}

// ════════════════════════════════════════════════════════════════════════════
secao('Isolamento entre lojas em toda superfície nova')
{
  const alheia = await mesaPor('Mesa V1', vizinha)
  // Corpo VÁLIDO de propósito: com itens vazios a rota pararia na validação de formato e
  // o teste não provaria nada sobre o inquilino.
  const AGUA = await itemPor('Água com Gás')
  const alvos = [
    ['GET', `/api/admin/mesas/${alheia.id}/conta`, undefined],
    ['POST', `/api/admin/mesas/${alheia.id}/lancamento`, {
      chaveIdempotencia: uuid(), selecoesVistas: [],
      itens: [{ itemId: AGUA.id, quantidade: 1, observacao: '', complementos: [] }],
    }],
    ['POST', `/api/admin/mesas/${alheia.id}/estado`, { acao: 'bloquear' }],
    ['POST', `/api/admin/mesas/${alheia.id}/conta`, { acao: 'pagamento', forma: 'pix', valor: 1, chave: uuid() }],
  ]
  for (const [metodo, url, corpo] of alvos) {
    const r = await api(dono.page, url, metodo, corpo)
    ok(`${metodo} ${url.replace(alheia.id, '<mesa-da-vizinha>')} → 404`, r.status === 404, `HTTP ${r.status}`)
  }
  const criouAlgo = await um(`select count(*)::int as n from pedidos where restaurante_id = $1`, [vizinha])
  ok('nenhuma das tentativas criou pedido na loja vizinha', criouAlgo.n === 0, `${criouAlgo.n} pedido(s)`)

  // Chamado da vizinha: o dono da Cantina não assume nem lista.
  await q(`insert into chamados_mesa (restaurante_id, mesa_id) values ($1,$2)`, [vizinha, alheia.id])
  const chamadoAlheio = await um(`select id from chamados_mesa where mesa_id=$1`, [alheia.id])
  const assumir = await api(dono.page, '/api/admin/mesas/chamados', 'POST', { acao: 'assumir', chamadoId: chamadoAlheio.id })
  ok('chamado de outra loja não é assumido', assumir.status === 404, `HTTP ${assumir.status}`)
  const lista = await api(dono.page, '/api/admin/mesas/chamados')
  ok('a fila do salão não mostra chamado de outra loja', !(lista.json?.chamados ?? []).some((c) => c.mesaId === alheia.id))

  // Consulta DIRETA ao PostgREST com o JWT do dono da Cantina: a RLS é a barreira real,
  // e é ela que precisa devolver vazio — não a rota.
  const cli = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  const { error: erroLogin } = await cli.auth.signInWithPassword({ email: 'dono@local.test', password: SENHA })
  ok('login direto no Supabase local para sondar a RLS', !erroLogin, erroLogin?.message)

  const { data: chamadosVistos } = await cli.from('chamados_mesa').select('id, restaurante_id')
  ok('o dono não lê chamado de outra loja pelo PostgREST',
    (chamadosVistos ?? []).every((c) => c.restaurante_id === loja), `${(chamadosVistos ?? []).length} linha(s)`)

  const { error: erroEscrita } = await cli.from('chamados_mesa').insert({ restaurante_id: loja, mesa_id: (await mesaPor('Mesa 01')).id })
  ok('ninguém insere chamado direto pelo navegador', !!erroEscrita, erroEscrita?.message?.slice(0, 60))

  const { error: erroFuncao } = await cli.rpc('chamado_assumir', {
    p_restaurante: vizinha, p_chamado: chamadoAlheio.id, p_ator: null, p_ator_nome: 'X',
  })
  ok('as funções de chamado não executam com sessão de usuário', !!erroFuncao, erroFuncao?.message?.slice(0, 60))

  const { data: auditoriaVista } = await cli.from('eventos_auditoria').select('restaurante_id')
  ok('a auditoria só mostra a própria loja',
    (auditoriaVista ?? []).length > 0 && (auditoriaVista ?? []).every((e) => e.restaurante_id === loja))

  const anonCli = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: anonChamados, error: anonErro } = await anonCli.from('chamados_mesa').select('id')
  ok('anônimo não lê chamados', (anonChamados ?? []).length === 0 || !!anonErro, anonErro?.message?.slice(0, 50) ?? '0 linhas')
}

// ════════════════════════════════════════════════════════════════════════════
await browser.close()
await db.end()

const falhas = res.filter((r) => !r).length
console.log(`\n${falhas === 0 ? '✅' : '❌'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)
