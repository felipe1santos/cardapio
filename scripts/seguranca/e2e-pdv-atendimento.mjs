/**
 * E2E do atendimento identificado (0094–0096): card preto (balcão, telefone, entrega
 * manual), mesa com nome, fechamento com cozinha pendente, mesa em limpeza, QR,
 * Kanban, cliente/cupom/fidelidade, permissões e outra loja — navegador de verdade,
 * servidor e banco LOCAIS, loja de demonstração.
 *
 *   SHOTS=<pasta> node scripts/seguranca/e2e-pdv-atendimento.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const SHOTS = process.env.SHOTS ?? null
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== null && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
async function aguardar(fn, ms = 20000, passo = 400) {
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

// ── loja de demonstração em estado conhecido ────────────────────────────────
const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const vizinha = (await um(`select id from restaurantes where slug='vizinha-demo'`)).id
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza e2e atendimento', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
await db.query(`update mesas set limpeza_desde=null, limpeza_comanda_id=null, bloqueada_em=null where restaurante_id=$1 and nome like 'Mesa%'`, [loja])
await db.query(`update restaurantes set pdv_v2=true, modulo_mesas_ativo=true, status_loja='aberto_manual', aceita_entrega=true, taxa_entrega_padrao=6,
  salao_garcom_recebe=false, impressao_cozinha_por_funcao=false where id=$1`, [loja])
await db.query(`delete from clientes where restaurante_id=$1 and telefone in ('5527988880001','5527988880002','5527988880003')`, [loja])
await db.query(`delete from fidelidade_progresso where restaurante_id=$1 and cliente_telefone in ('5527988880001','5527988880002','5527988880003')`, [loja])
await db.query(`delete from cupom_usos where restaurante_id=$1 and cliente_telefone in ('5527988880001','5527988880002','5527988880003')`, [loja])
await db.query(`delete from cupons where restaurante_id=$1 and codigo='BALCAO10'`, [loja])
await db.query(`delete from campanhas_fidelidade where restaurante_id=$1 and nome='Fidelidade E2E'`, [loja])
const cupom = (await um(`insert into cupons (restaurante_id, codigo, ativo, tipo, valor, publico, uso_unico_por_cliente, max_usos)
  values ($1,'BALCAO10',true,'desconto_percentual',10,'todos',true,50) returning id`, [loja])).id
await db.query(`insert into campanhas_fidelidade (restaurante_id, nome, tipo_meta, meta_quantidade, premio_tipo, premio_valor)
  values ($1,'Fidelidade E2E','qtd_pedidos',5,'desconto_valor',10)`, [loja])
const mesas = await q(`select id, nome, token from mesas where restaurante_id=$1 and ativa and nome like 'Mesa%' order by ordem`, [loja])
const [M1, M2, M3] = mesas
const item = (nome) => um('select id, nome, preco from itens_cardapio where restaurante_id=$1 and nome=$2', [loja, nome])
const FILE = await item('Filé à Parmegiana')
const AGUA = await item('Água com Gás')
const SUCO = await item('Suco de Laranja')

// ── navegador ───────────────────────────────────────────────────────────────
const browser = await chromium.launch()
async function logar(usuario, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' })
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')])
  page.on('load', () => page.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 3000 }).catch(() => {}))
  return page
}
const dispensar = (page) => page.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 3000 }).catch(() => {})
const api = (page, url, metodo = 'GET', corpo) =>
  page.evaluate(async ({ url, metodo, corpo }) => {
    const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
    let json = null
    try { json = await r.json() } catch { /* sem corpo */ }
    return { status: r.status, json }
  }, { url: `${BASE}${url}`, metodo, corpo })
const foto = async (page, nome) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${nome}.png`) }) }
const lancar = (page, alvo, itens) => api(page, '/api/admin/pdv/lancamento', 'POST', { ...alvo, chave: uuid(), itens })
const L = (it, qtd = 1) => ({ itemId: it.id, quantidade: qtd, complementos: [] })
const irPdv = async (page) => { await page.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' }); await dispensar(page) }

const pAt = await logar('atendente.local')
const pGer = await logar('gerente.local')
const pGar = await logar('garcom.local')
const pViz = await logar('dono@vizinha.local')

// ════════════════════════════════════════════════════════════════════════════
secao('Card preto: balcão, telefone, entrega manual')
await irPdv(pAt)
await pAt.getByTestId('card-balcao').click()
await pAt.getByTestId('balcao-novo').click()
const antesBalcao = Number((await um(`select count(*) n from comandas where restaurante_id=$1 and tipo='balcao'`, [loja])).n)
await pAt.getByTestId('balcao-abrir').click()
ok('1. balcão sem nome recusado na tela', (await pAt.getByTestId('balcao-erro').innerText()).includes('nome')
  && Number((await um(`select count(*) n from comandas where restaurante_id=$1 and tipo='balcao'`, [loja])).n) === antesBalcao)
ok('2. balcão sem nome recusado pela API', (await api(pAt, '/api/admin/balcao/comandas', 'POST', { chave: uuid() })).status === 400)
ok('3. balcão só com espaços recusado pela API', (await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: '    ', chave: uuid() })).status === 400)
ok('   origem/canal/tipo/taxa do navegador são ignorados', (await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Forjado', chave: uuid(), origem: 'cardapio', canal: 'delivery', tipo: 'entrega', taxaEntrega: -5 })).status === 201
  && (await um(`select tipo, entrega from comandas where restaurante_id=$1 and cliente_nome='Forjado' order by aberta_em desc limit 1`, [loja])).entrega === false)
await pAt.getByTestId('balcao-nome').fill('Balcão Sem Telefone')
await pAt.getByTestId('balcao-abrir').click()
await pAt.getByTestId('pdv-lancar').waitFor()
const cSemTel = await um(`select id, senha, cliente_telefone, cliente_id from comandas where restaurante_id=$1 and cliente_nome='Balcão Sem Telefone' order by aberta_em desc limit 1`, [loja])
ok('4. balcão com nome e sem telefone aceito', !!cSemTel && cSemTel.cliente_telefone === null && cSemTel.cliente_id === null)
const lSemTel = await lancar(pAt, { comandaId: cSemTel.id }, [L(AGUA)])
ok('   lança no balcão', lSemTel.status === 201)
// Pedido por telefone + dados de entrega, pelo mesmo card
await irPdv(pAt)
await pAt.getByTestId('card-balcao').click()
await pAt.getByTestId('balcao-novo').click()
await pAt.getByTestId('balcao-nome').fill('Cliente Telefone Demo')
await pAt.getByTestId('balcao-telefone').fill('27988880001')
await pAt.getByTestId('balcao-entrega-toggle').click()
await pAt.getByTestId('entrega-cep').fill('29000-000')
await pAt.getByTestId('entrega-bairro').fill('Centro')
await pAt.getByTestId('entrega-rua').fill('Rua de Demonstração')
await pAt.getByTestId('entrega-numero').fill('100')
await pAt.getByTestId('entrega-complemento').fill('Casa 2')
await pAt.getByTestId('entrega-cidade').fill('Cidade Demo')
await pAt.getByTestId('entrega-referencia').fill('Perto da praça')
await pAt.getByTestId('entrega-observacao').fill('Tocar a campainha')
await pAt.getByTestId('entrega-taxa').fill('8,50')
await foto(pAt, 'a01-card-preto-entrega')
await pAt.getByTestId('balcao-abrir').click()
await pAt.getByTestId('pdv-lancar').waitFor()
const cEnt = await um(`select * from comandas where restaurante_id=$1 and cliente_nome='Cliente Telefone Demo' order by aberta_em desc limit 1`, [loja])
ok('5. telefone normalizado', cEnt.cliente_telefone === '5527988880001')
ok('7/8. pedido telefônico com dados de entrega completos pelo mesmo card', cEnt.entrega && cEnt.entrega_rua === 'Rua de Demonstração' && cEnt.entrega_numero === '100'
  && cEnt.entrega_bairro === 'Centro' && cEnt.entrega_cep === '29000000' && cEnt.entrega_complemento === 'Casa 2' && cEnt.entrega_cidade === 'Cidade Demo'
  && cEnt.entrega_referencia === 'Perto da praça' && cEnt.entrega_observacao === 'Tocar a campainha' && Number(cEnt.taxa_entrega) === 8.5 && cEnt.taxa_entrega_manual)
ok('13. cliente novo criado na loja pelo telefone', !!cEnt.cliente_id && Number((await um(`select count(*) n from clientes where restaurante_id=$1 and telefone='5527988880001'`, [loja])).n) === 1)
const lEnt = await lancar(pAt, { comandaId: cEnt.id }, [L(FILE)])
const pEnt = await um('select * from pedidos where id=$1', [lEnt.json.id])
ok('9. pedido manual entra na cozinha (recebido, na fila)', pEnt.status === 'recebido' && pEnt.impresso === false
  && (await q('select * from impressao_elegiveis($1)', [loja])).some((x) => Object.values(x).includes(pEnt.id)))
ok('   entrega manual: tipo entrega, origem PDV, endereço e taxa no pedido', pEnt.tipo === 'entrega' && pEnt.origem === 'pdv' && pEnt.endereco_rua === 'Rua de Demonstração' && Number(pEnt.taxa_entrega) === 8.5)
// segundo atendimento com o MESMO telefone em outra máscara
const outro = await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Mesmo Cliente', telefone: '+55 (27) 98888-0001', chave: uuid() })
ok('12. cliente existente encontrado pelo telefone (máscara diferente, sem duplicar)', (await um('select cliente_id from comandas where id=$1', [outro.json.id])).cliente_id === cEnt.cliente_id
  && Number((await um(`select count(*) n from clientes where restaurante_id=$1 and telefone='5527988880001'`, [loja])).n) === 1)
ok('14. sem telefone não vincula por nome', (await um('select cliente_id from comandas where id=$1', [cSemTel.id])).cliente_id === null)
// 6. dois balcões ao mesmo tempo
const [bA, bB] = await Promise.all([
  api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Simultâneo A', chave: uuid() }),
  api(pGer, '/api/admin/balcao/comandas', 'POST', { nome: 'Simultâneo B', chave: uuid() }),
])
await Promise.all([lancar(pAt, { comandaId: bA.json.id }, [L(AGUA)]), lancar(pGer, { comandaId: bB.json.id }, [L(SUCO, 2)])])
const [cA, cB] = await Promise.all([api(pAt, `/api/admin/comandas/${bA.json.id}`), api(pGer, `/api/admin/comandas/${bB.json.id}`)])
ok('6. dois balcões simultâneos não se misturam', bA.json.senha !== bB.json.senha && cA.json.conta.pedidos.length === 1 && cB.json.conta.pedidos.length === 1
  && cA.json.conta.pedidos[0].itens[0].nome === AGUA.nome && cB.json.conta.pedidos[0].itens[0].quantidade === 2)
// 10/11. logística
for (const st of ['preparando', 'pronto']) await db.query('update pedidos set status=$2 where id=$1', [pEnt.id, st])
await db.query("update pedidos set status='preparando' where id=$1", [lSemTel.json.id])
await db.query("update pedidos set status='pronto' where id=$1", [lSemTel.json.id])
await pGer.goto(`${BASE}/admin/logistica`, { waitUntil: 'networkidle' })
await dispensar(pGer)
const naLog = await aguardar(async () => (await pGer.content()).includes('Cliente Telefone Demo'), 15000)
ok('10. entrega manual pronta aparece na logística', !!naLog)
ok('11. balcão (sem entrega) não entra na logística', !(await pGer.content()).includes('Balcão Sem Telefone'))
await foto(pGer, 'a02-logistica-entrega-manual')

// ════════════════════════════════════════════════════════════════════════════
secao('Mesas: nome obrigatório, concorrência, conta antiga')
await irPdv(pAt)
await pAt.getByTestId(`mesa-${M1.nome}`).click()
await pAt.getByTestId('mesa-abrir').click()
ok('18. mesa sem nome recusada na tela', (await pAt.getByTestId('mesa-erro').innerText()).includes('nome')
  && !(await um(`select id from comandas where mesa_id=$1 and status='aberta'`, [M1.id])))
ok('18. mesa sem nome recusada pela API', (await api(pAt, `/api/admin/mesas/${M1.id}/atendimento`, 'POST', { acao: 'abrir', nome: '  ', chave: uuid() })).status === 400)
ok('18. lançar direto na mesa sem abrir é recusado', (await lancar(pAt, { mesaId: M1.id }, [L(AGUA)])).status === 409)
await pAt.getByTestId('mesa-nome').fill('Fernanda Mesa')
await foto(pAt, 'a03-abrir-mesa-nome')
await pAt.getByTestId('mesa-abrir').click()
await pAt.getByTestId('pdv-lancar').waitFor()
const cM1 = await um(`select id, cliente_nome, cliente_telefone from comandas where mesa_id=$1 and status='aberta'`, [M1.id])
ok('19. mesa com nome e sem telefone abre', cM1?.cliente_nome === 'Fernanda Mesa' && cM1.cliente_telefone === null)
const lM1 = await lancar(pAt, { comandaId: cM1.id }, [L(FILE)])
const lM1b = await lancar(pAt, { mesaId: M1.id }, [L(AGUA)])
ok('   pedidos da mesa reutilizam o nome', (await q('select cliente_nome from pedidos where id = any($1)', [[lM1.json.id, lM1b.json.id]])).every((p) => p.cliente_nome === 'Fernanda Mesa'))
const [o1, o2] = await Promise.all([
  api(pAt, `/api/admin/mesas/${M2.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'Operador 1', chave: uuid() }),
  api(pGer, `/api/admin/mesas/${M2.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'Operador 2', chave: uuid() }),
])
ok('20. dois operadores abrindo a mesma mesa: 201 + 409, uma sessão', [o1.status, o2.status].sort().join(',') === '201,409'
  && Number((await um(`select count(*) n from comandas where mesa_id=$1 and status='aberta'`, [M2.id])).n) === 1, `${o1.status},${o2.status}`)
// conta antiga sem nome (aberta antes da regra)
await db.query('update restaurantes set pdv_v2=false where id=$1', [loja])
const antiga = (await um('insert into comandas (restaurante_id, mesa_id) values ($1,$2) returning id', [loja, M3.id])).id
await db.query('update restaurantes set pdv_v2=true where id=$1', [loja])
const leitura = await api(pAt, `/api/admin/comandas/${antiga}`)
ok('21. conta antiga sem nome continua legível', leitura.status === 200 && leitura.json.conta.semNome === true)
const l22 = await lancar(pAt, { comandaId: antiga }, [L(AGUA)])
ok('22. conta antiga exige nome antes do próximo lançamento', l22.status === 409 && l22.json?.codigo === 'comanda_sem_nome')
await irPdv(pAt)
await pAt.getByTestId(`mesa-${M3.nome}`).click()
await pAt.getByTestId('conta-sem-nome').waitFor()
await foto(pAt, 'a04-conta-antiga-sem-nome')
await pAt.getByTestId('conta-sem-nome').getByRole('button', { name: 'Informar nome' }).click()
await pAt.getByTestId('identificar-nome').fill('Nome Completado')
await pAt.getByTestId('identificar-salvar').click()
await pAt.getByTestId('conta-sem-nome').waitFor({ state: 'detached' })
ok('   nome informado: lançamento liberado e corrigido na auditoria', (await lancar(pAt, { comandaId: antiga }, [L(AGUA)])).status === 201
  && !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='comanda.identificou' and entidade_id=$2`, [loja, antiga])))
await pAt.getByRole('button', { name: 'Fechar', exact: true }).click().catch(() => {})

// ════════════════════════════════════════════════════════════════════════════
secao('Fechamento da mesa com cozinha pendente')
// Mesa 01: dois pedidos na cozinha (um aguardando aceite, outro em preparo)
await db.query("update pedidos set status='preparando' where id=$1", [lM1.json.id])
const contaM1 = (await api(pGer, `/api/admin/comandas/${cM1.id}`)).json.conta
ok('garçom sem permissão financeira não fecha conta (403)', (await api(pGar, `/api/admin/comandas/${cM1.id}`, 'POST', { acao: 'fechar_completo', chave: uuid(), acoes: [], pagamentos: [] })).status === 403)
ok('40. garçom não aplica cupom, não estorna, não força', [
  (await api(pGar, `/api/admin/comandas/${cM1.id}`, 'POST', { acao: 'aplicar_cupom', codigo: 'BALCAO10' })).status,
  (await api(pGar, `/api/admin/comandas/${cM1.id}`, 'POST', { acao: 'estorno', pagamentoId: uuid(), motivo: 'x' })).status,
].every((s) => s === 403))
ok('   atendente não cancela no fechamento (decisão da gerência)', (await api(pAt, `/api/admin/comandas/${cM1.id}`, 'POST', {
  acao: 'fechar_completo', chave: uuid(), acoes: [{ pedido_id: lM1.json.id, acao: 'cancelar', motivo: 'Tentativa indevida' }], pagamentos: [],
})).status === 403)
await irPdv(pGer)
await pGer.getByTestId(`mesa-${M1.nome}`).click()
await pGer.getByTestId('conta-fechar').click()
await pGer.getByTestId('fechar-modal').waitFor()
const numA = (await um('select numero from pedidos where id=$1', [lM1b.json.id])).numero
const numB = (await um('select numero from pedidos where id=$1', [lM1.json.id])).numero
await pGer.getByTestId(`fechar-pendencia-${numA}`).waitFor()
const txtFechar = await pGer.getByTestId('fechar-modal').innerText()
ok('24/25. pendências mostradas com número, itens, estado, valor, horário e operador',
  /aguardando aceite/i.test(txtFechar) && /em preparo/i.test(txtFechar) && txtFechar.includes(`#${numA}`) && txtFechar.includes(AGUA.nome) && txtFechar.includes('Atendente Demo'))
ok('   sem decisão, não confirma', await pGer.getByTestId('fechar-confirmar').isDisabled())
await foto(pGer, 'a05-fechar-pendencias')
await pGer.getByTestId(`fechar-pendencia-${numA}-entregue`).click()
await pGer.getByTestId(`fechar-pendencia-${numB}-cancelar`).click()
await pGer.getByTestId(`fechar-motivo-${numB}`).fill('abc')
ok('27. cancelar exige motivo (curto não habilita)', await pGer.getByTestId('fechar-confirmar').isDisabled())
await pGer.getByTestId(`fechar-motivo-${numB}`).fill('Cliente desistiu do prato')
await pGer.getByTestId('fechar-simulacao').waitFor()
const esperado = Math.round(Number(AGUA.preco) * 1.1 * 100) / 100
await pGer.waitForFunction((v) => document.querySelector('[data-testid="fechar-restante"]')?.textContent?.includes(v), esperado.toFixed(2).replace('.', ','))
ok('28. cancelamento recalcula a conta (sem o prato cancelado, com 10%)', (await pGer.getByTestId('fechar-restante').innerText()).includes(esperado.toFixed(2).replace('.', ',')))
// 29. duas formas: Pix R$ 5 + resto em dinheiro
await pGer.getByTestId('fechar-pag-0-forma-pix').click()
await pGer.getByTestId('fechar-pag-0-valor').fill('5,00')
await pGer.getByTestId('fechar-add-pagamento').click()
await pGer.getByTestId('fechar-pag-1-forma-dinheiro').click()
await pGer.getByTestId('fechar-pag-1-valor').fill((esperado - 5).toFixed(2).replace('.', ','))
await pGer.waitForFunction(() => !document.querySelector('[data-testid="fechar-confirmar"]')?.disabled)
await foto(pGer, 'a06-fechar-decisoes-pagamentos')
// 30. clique duplo
await pGer.getByTestId('fechar-confirmar').dblclick()
await pGer.getByTestId('conta-titulo').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
const fechadaM1 = await um('select status, total_final, chave_fechamento from comandas where id=$1', [cM1.id])
const pagsM1 = await q('select forma, valor from pagamentos_comanda where comanda_id=$1 and estornado_em is null order by forma', [cM1.id])
ok('23/29. conta fechada com Pix + dinheiro', fechadaM1.status === 'fechada' && pagsM1.map((p) => p.forma).join(',') === 'dinheiro,pix' && Number(fechadaM1.total_final) === esperado)
ok('30. clique duplo não duplicou pagamento nem fechamento', pagsM1.length === 2 && Number((await um(`select count(*) n from eventos_auditoria where entidade_id=$1 and acao='conta.fechou'`, [cM1.id])).n) === 1)
const pedsM1 = await q('select id, status::text s, resolvido_forcado f, cancelado_observacao o from pedidos where comanda_id=$1', [cM1.id])
ok('26. aguardando aceite marcado como entregue (forçado)', pedsM1.find((p) => p.id === lM1b.json.id)?.s === 'entregue' && pedsM1.find((p) => p.id === lM1b.json.id)?.f === true)
ok('27. em preparo cancelado com motivo', pedsM1.find((p) => p.id === lM1.json.id)?.s === 'cancelado' && pedsM1.find((p) => p.id === lM1.json.id)?.o === 'Cliente desistiu do prato')
// 31. dois operadores fechando Mesa 02 ao mesmo tempo
const cM2 = (await um(`select id from comandas where mesa_id=$1 and status='aberta'`, [M2.id])).id
const lM2 = await lancar(pAt, { comandaId: cM2 }, [L(AGUA)])
await db.query("update pedidos set status='entregue' where id=$1", [lM2.json.id])
const totM2 = (await api(pGer, `/api/admin/comandas/${cM2}`)).json.conta.totais.restante
const [fa, fb] = await Promise.all([
  api(pGer, `/api/admin/comandas/${cM2}`, 'POST', { acao: 'fechar_completo', chave: uuid(), acoes: [], pagamentos: [{ forma: 'pix', valor: totM2, chave: uuid() }] }),
  api(pAt, `/api/admin/comandas/${cM2}`, 'POST', { acao: 'fechar_completo', chave: uuid(), acoes: [], pagamentos: [{ forma: 'credito', valor: totM2, chave: uuid() }] }),
])
ok('31. dois operadores fechando juntos: 200 + 409, um pagamento só', [fa.status, fb.status].sort().join(',') === '200,409'
  && Number((await um('select count(*) n from pagamentos_comanda where comanda_id=$1 and estornado_em is null', [cM2])).n) === 1, `${fa.status},${fb.status}`)

// ════════════════════════════════════════════════════════════════════════════
secao('Mesa em limpeza, QR e liberação')
await irPdv(pGer)
const estadoM1 = await pGer.getByTestId(`mesa-${M1.nome}`).getAttribute('data-estado')
ok('32. mesa fechada entra em limpeza (laranja)', estadoM1 === 'limpeza' && (await pGer.getByTestId(`mesa-${M1.nome}`).getAttribute('class')).includes('bg-status-pending'))
await foto(pGer, 'a07-mesas-limpeza')
ok('33. mesa em limpeza recusa novo atendimento', (await api(pAt, `/api/admin/mesas/${M1.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'Novo', chave: uuid() })).status === 409)
ok('33. … e novo pedido', (await lancar(pAt, { mesaId: M1.id }, [L(AGUA)])).status === 409)
const qr = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
await qr.goto(`${BASE}/mesa/${M1.token}`, { waitUntil: 'networkidle' })
ok('34. QR informa indisponibilidade temporária (mesmo token)', (await qr.locator('[data-mesa-em-limpeza]').count()) === 1 && /em preparação/i.test(await qr.innerText('body')))
await foto(qr, 'a08-qr-mesa-em-preparacao')
ok('34. QR não abre sessão enquanto em limpeza', Number((await um(`select count(*) n from sessoes_mesa where mesa_id=$1 and status='aberta'`, [M1.id])).n) === 0)
await pGer.getByTestId(`mesa-${M1.nome}`).click()
const txtLimpeza = await pGer.getByTestId('limpeza-detalhe').innerText()
ok('   ao tocar: último cliente, horário e quem fechou', txtLimpeza.includes('Fernanda Mesa') && txtLimpeza.includes('Gerente'))
await foto(pGer, 'a09-limpeza-detalhe')
await pGer.getByTestId('mesa-liberar').click()
await pGer.waitForFunction((n) => document.querySelector(`[data-testid="mesa-${n}"]`)?.getAttribute('data-estado') === 'livre', M1.nome, { timeout: 15000 })
ok('35/36. funcionário libera a mesa e ela volta a verde', (await pGer.getByTestId(`mesa-${M1.nome}`).getAttribute('class')).includes('bg-status-ready'))
ok('   liberação registrada (quem e quando)', !!(await um(`select 1 from mesas where id=$1 and liberada_por_nome is not null and liberada_em is not null`, [M1.id])))
ok('35. liberar de novo é idempotente', (await api(pGer, `/api/admin/mesas/${M1.id}/atendimento`, 'POST', { acao: 'liberar' })).json?.idempotente === true)
await qr.goto(`${BASE}/mesa/${M1.token}`, { waitUntil: 'networkidle' })
ok('   QR volta a permitir atendimento', (await qr.locator('[data-mesa-em-limpeza]').count()) === 0)
// 37. mesa bloqueada durante a limpeza
await db.query('update mesas set bloqueada_em=now() where id=$1', [M2.id])
const lib = await api(pGer, `/api/admin/mesas/${M2.id}/atendimento`, 'POST', { acao: 'liberar' })
ok('37. mesa bloqueada não é liberada por engano (continua bloqueada)', lib.json?.estado === 'bloqueada'
  && (await api(pAt, `/api/admin/mesas/${M2.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'X', chave: uuid() })).status === 409)
await db.query('update mesas set bloqueada_em=null where id=$1', [M2.id])

// ════════════════════════════════════════════════════════════════════════════
secao('Cliente, cupom e fidelidade')
const cCli = await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Cliente Cupom', telefone: '27988880002', chave: uuid() })
const lCli = await lancar(pAt, { comandaId: cCli.json.id }, [L(FILE)])
ok('16. cupom inexistente recusado no servidor', (await api(pAt, `/api/admin/comandas/${cCli.json.id}`, 'POST', { acao: 'aplicar_cupom', codigo: 'NAOEXISTE' })).status === 404)
ok('16. desconto forjado no corpo é ignorado', (await api(pAt, `/api/admin/comandas/${cCli.json.id}`, 'POST', { acao: 'aplicar_cupom', codigo: 'BALCAO10', desconto: 999, descontoValor: 999 })).status === 200
  && (await api(pAt, `/api/admin/comandas/${cCli.json.id}`)).json.conta.totais.desconto === Math.round(Number(FILE.preco) * 0.1 * 100) / 100)
await db.query("update pedidos set status='entregue' where id=$1", [lCli.json.id])
const totCli = (await api(pAt, `/api/admin/comandas/${cCli.json.id}`)).json.conta.totais.restante
const fCli = await api(pAt, `/api/admin/comandas/${cCli.json.id}`, 'POST', { acao: 'fechar_completo', chave: uuid(), acoes: [], pagamentos: [{ forma: 'pix', valor: totCli, chave: uuid() }] })
ok('   fecha com cupom; uso contado uma vez', fCli.status === 200 && Number((await um('select count(*) n from cupom_usos where cupom_id=$1', [cupom])).n) === 1)
const prog = await aguardar(async () => (await um(`select progresso_qtd from fidelidade_progresso where restaurante_id=$1 and cliente_telefone='5527988880002'`, [loja])), 8000)
ok('17. fidelidade: a conta fechada conta uma vez', Number(prog?.progresso_qtd) === 1)
await api(pGer, `/api/admin/comandas/${cCli.json.id}`, 'POST', { acao: 'reabrir', motivo: 'Conferência de valores' })
await api(pGer, `/api/admin/comandas/${cCli.json.id}`, 'POST', { acao: 'fechar_completo', chave: uuid(), acoes: [], pagamentos: [] })
await esperar(1500)
ok('46. reabrir e fechar de novo: cupom e fidelidade não duplicam', Number((await um('select count(*) n from cupom_usos where cupom_id=$1', [cupom])).n) === 1
  && Number((await um(`select progresso_qtd from fidelidade_progresso where restaurante_id=$1 and cliente_telefone='5527988880002'`, [loja])).progresso_qtd) === 1)
ok('   segundo cupom para o mesmo telefone é recusado (uso único)', (await api(pAt, `/api/admin/comandas/${(await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Cliente Cupom', telefone: '27988880002', chave: uuid() })).json.id}`, 'POST', { acao: 'aplicar_cupom', codigo: 'BALCAO10' })).status === 409)
await pGer.goto(`${BASE}/admin/clientes`, { waitUntil: 'networkidle' })
await dispensar(pGer)
ok('15. histórico do cliente atualizado (aparece em Clientes)', !!(await aguardar(async () => (await pGer.innerText('body')).includes('Cliente Cupom') || (await pGer.innerText('body')).includes('(27) 98888-0002'), 10000)))

// ════════════════════════════════════════════════════════════════════════════
secao('Kanban, garçom, delivery e outra loja')
// garçom abre e lança na Mesa 03? (ocupada pela conta antiga) → usa a primeira mesa livre
const livre = await um(`select m.id, m.nome from mesas m where m.restaurante_id=$1 and m.ativa and m.bloqueada_em is null and m.limpeza_desde is null
  and not exists (select 1 from comandas c where c.mesa_id=m.id and c.status='aberta') order by m.ordem limit 1`, [loja])
ok('garçom abre mesa com nome', (await api(pGar, `/api/admin/mesas/${livre.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'Cliente do Garçom', chave: uuid() })).status === 201)
const lg = await api(pGar, `/api/admin/mesas/${livre.id}/lancamento`, 'POST', { chaveIdempotencia: uuid(), selecoesVistas: [], itens: [L(AGUA)] })
ok('   garçom lança (salão) com o nome do cliente', lg.status === 201 && (await um('select cliente_nome, lancado_via from pedidos where id=$1', [lg.json.pedidoId])).lancado_via === 'salao')
const dv = await fetch(`${BASE}/api/loja/cantina-demo/pedido`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tipo: 'entrega', cliente: { nome: 'Delivery Demo', telefone: '27988880003' }, endereco: { rua: 'Rua A', numero: '1', complemento: '', bairro: 'Centro', cep: '29000-000', cidade: 'Cidade Demo', referencia: '' }, pagamento: 'pix', trocoPara: null, itens: [L(AGUA)] }),
})
ok('41. delivery continua funcionando', dv.status === 201)
// Caixa abre a Mesa 01 (liberada) e lança; entrega manual ganha um pedido ainda na cozinha.
const abM1 = await api(pAt, `/api/admin/mesas/${M1.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'Cliente do Caixa', chave: uuid() })
const lp = await lancar(pAt, { comandaId: abM1.json.comandaId }, [L(AGUA)])
await lancar(pAt, { comandaId: cEnt.id }, [L(SUCO)])
await pGer.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
await dispensar(pGer)
await aguardar(async () => (await pGer.innerText('body')).includes('Cliente do Garçom'), 15000)
const kanban = await pGer.innerText('body')
ok('38. Kanban: PDV · Balcão · Senha', /PDV · Balcão · Senha \d+/.test(kanban))
ok('38. Kanban: PDV · Entrega manual', kanban.includes('PDV · Entrega manual'))
ok('38. Kanban: Salão · Mesa (lançado pelo garçom)', new RegExp(`Salão · ${livre.nome}`).test(kanban))
ok('38. Kanban: badge Delivery no pedido da vitrine', /DELIVERY/.test(kanban))
ok('38. Kanban: nome e telefone discreto, sem endereço completo', kanban.includes('Cliente Telefone Demo') && kanban.includes('98888-0001') && !kanban.includes('Rua de Demonstração'))
await foto(pGer, 'a10-kanban-etiquetas')
ok('38. Kanban: PDV · Mesa quando o caixa lança na mesa', lp.status === 201 && kanban.includes(`PDV · ${M1.nome}`))
ok('39. outra loja: abrir mesa desta loja → 404', (await api(pViz, `/api/admin/mesas/${livre.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'Intruso', chave: uuid() })).status === 404)
ok('39. outra loja: ler/fechar conta desta loja → 404', (await api(pViz, `/api/admin/comandas/${cEnt.id}`)).status === 404
  && (await api(pViz, `/api/admin/comandas/${cEnt.id}`, 'POST', { acao: 'fechar_completo', chave: uuid(), acoes: [], pagamentos: [] })).status === 404)
ok('39. outra loja: liberar mesa desta loja → 404', (await api(pViz, `/api/admin/mesas/${M1.id}/atendimento`, 'POST', { acao: 'liberar' })).status === 404)
ok('auditoria sem telefone completo nem endereço', (await q(`select dados::text d from eventos_auditoria where restaurante_id=$1 and criado_em > now() - interval '30 minutes'
  and acao in ('balcao.abriu','mesa.abriu','comanda.identificou','balcao.entrega_ativada','conta.fechou','mesa.limpeza','mesa.liberou')`, [loja]))
  .every((a) => !/988880001|988880002|Rua de Demonstração/.test(a.d)))

// ════════════════════════════════════════════════════════════════════════════
secao('Telas em 360×800, 390×844, 768×1024 e desktop')
const tamanhos = [['360x800', 360, 800], ['390x844', 390, 844], ['768x1024', 768, 1024], ['desktop', 1440, 900]]
for (const [nome, w, h] of tamanhos) {
  const p = await logar('gerente.local', { width: w, height: h })
  await irPdv(p)
  const semRolagem = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  await foto(p, `t-${nome}-pdv-mesas`)
  await p.getByTestId('card-balcao').click()
  await p.getByTestId('balcao-novo').click()
  await p.getByTestId('balcao-entrega-toggle').click()
  const formOk = await p.getByTestId('entrega-rua').isVisible()
  await foto(p, `t-${nome}-card-preto-entrega`)
  await p.keyboard.press('Escape')
  ok(`${nome}: painel sem rolagem lateral e formulário de entrega visível`, semRolagem && formOk)
  await p.context().close()
}

await browser.close()
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza e2e atendimento', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
await db.query(`update mesas set limpeza_desde=null, limpeza_comanda_id=null where restaurante_id=$1`, [loja])
await db.query(`delete from campanhas_fidelidade where restaurante_id=$1 and nome='Fidelidade E2E'`, [loja])
await db.end()
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
