/**
 * E2E da impressão profissional: agentes VIRTUAIS rodando o printer-agent/src/main.js real
 * (scripts/impressao/agente-virtual.cjs), painel e PDV no navegador de verdade, servidor e
 * banco locais. Nenhuma impressora física: cada "impressão" vira registro + PNG renderizado
 * pelo print.ps1 (-DebugPng). Loja de demonstração, sem dados reais.
 *
 *   SHOTS=<pasta> ARTEFATOS=<pasta> node scripts/seguranca/e2e-impressao-v2.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const SHOTS = process.env.SHOTS ?? null
const ART = process.env.ARTEFATOS ?? join(tmpdir(), 'menuzia-e2e-impressao')
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
rmSync(ART, { recursive: true, force: true })
mkdirSync(ART, { recursive: true })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== null && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes', 'impressao_reservas']) {
  await db.query(`delete from ${t} where restaurante_id=$1`, [loja])
}
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza e2e impressão', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
await db.query('update mesas set limpeza_desde=null, limpeza_comanda_id=null where restaurante_id=$1', [loja])
await db.query(`update restaurantes set pdv_v2=true, modulo_mesas_ativo=true, impressao_automatica=true, impressao_cozinha_por_funcao=false,
  impressao_agente_visto_em=null, impressao_agente_token=null where id=$1`, [loja])
await db.query('update pedidos set impresso=true, reimprimir=false where restaurante_id=$1', [loja])

// ── agentes virtuais ────────────────────────────────────────────────────────
function iniciarAgente(nome, impressoras) {
  const dir = join(ART, nome, 'dados')
  const saida = join(ART, nome, 'saida')
  const proc = spawn(process.execPath, ['scripts/impressao/agente-virtual.cjs'], {
    env: { ...process.env, BASE, AGENTE_DIR: dir, AGENTE_SAIDA: saida, AGENTE_IMPRESSORAS: impressoras.join('|'), RENDER: '1' },
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
  return {
    nome,
    logs,
    cmd: (o) => new Promise((r) => { esperando.push(r); proc.stdin.write(JSON.stringify(o) + '\n') }),
    impressos: () => (existsSync(join(saida, 'impressos.jsonl')) ? readFileSync(join(saida, 'impressos.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    parar: () => proc.kill(),
  }
}
async function aguardar(fn, ms = 30000, passo = 500) {
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    const v = await fn()
    if (v) return v
    await esperar(passo)
  }
  return null
}

const browser = await chromium.launch()
async function logar(usuario, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' })
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')])
  // Checklist de configuração da loja (recurso existente) abre sozinho: dispensa.
  page.on('load', () => page.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 3000 }).catch(() => {}))
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
const foto = async (page, nome) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${nome}.png`) }) }
const painel = async (page) => (await api(page, '/api/admin/impressao/painel')).json

const pGer = await logar('gerente.local')
const pAt = await logar('atendente.local')
const pViz = await logar('dono@vizinha.local')
const item = (nome) => um('select id, nome, preco from itens_cardapio where restaurante_id=$1 and nome=$2', [loja, nome])
const FILE = await item('Filé à Parmegiana')
const AGUA = await item('Água com Gás')

// ════════════════════════════════════════════════════════════════════════════
secao('1–4. Parear computador A, descobrir impressoras, atribuir funções (pela tela)')
await pGer.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
await dispensarChecklist(pGer)
await pGer.getByTestId('gerar-codigo').click()
const codigoA = (await pGer.getByTestId('codigo-pareamento').innerText()).trim()
await pGer.getByRole('button', { name: 'Esconder' }).click() // o código não vai para screenshot
ok('gerente gera o código na tela', /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(codigoA))
const A = iniciarAgente('pc-loja', ['Impressora 01', 'Impressora 02'])
const rA = await A.cmd({ cmd: 'parear', codigo: codigoA, nome: 'PC Loja' })
ok('Assistente real (main.js) pareia com o código', rA?.ok === true && rA.nome === 'PC Loja', rA?.erro)
ok('credencial nunca aparece na resposta do comando nem nos logs', !JSON.stringify(rA).includes('mza_ag_') && !A.logs.join('').includes('mza_ag_'))
const cfgDisco = readFileSync(join(ART, 'pc-loja', 'dados', 'config.json'), 'utf8')
ok('credencial guardada cifrada no computador (não em texto puro)', !cfgDisco.includes('mza_ag_') && cfgDisco.includes('credencialCifrada'))
const achou = await aguardar(async () => (await painel(pGer)).dispositivos.length === 2)
ok('Impressora 01 e 02 descobertas no computador A', !!achou)
let pn = await painel(pGer)
const d01 = pn.dispositivos.find((d) => d.nomeSistema === 'Impressora 01')
const d02 = pn.dispositivos.find((d) => d.nomeSistema === 'Impressora 02')
await api(pGer, `/api/admin/impressao/dispositivos/${d01.id}`, 'PATCH', { apelido: 'Cozinha 01', larguraMm: 80 })
await api(pGer, `/api/admin/impressao/dispositivos/${d02.id}`, 'PATCH', { apelido: 'Caixa 02', larguraMm: 58 })
await pGer.reload({ waitUntil: 'networkidle' })
await dispensarChecklist(pGer)
await pGer.getByTestId('funcao-cozinha').selectOption(d01.id)
await aguardar(async () => (await painel(pGer)).funcoes.cozinha === d01.id)
await pGer.getByTestId('funcao-caixa').selectOption(d02.id)
await aguardar(async () => (await painel(pGer)).funcoes.caixa === d02.id)
pn = await painel(pGer)
ok('Cozinha → Impressora 01, Caixa → Impressora 02', pn.funcoes.cozinha === d01.id && pn.funcoes.caixa === d02.id)
await pGer.getByTestId('cozinha-por-funcao').click()
ok('roteamento da cozinha por função ligado (opt-in, pela tela)', !!(await aguardar(async () => (await painel(pGer)).cozinhaPorFuncao)))
await foto(pGer, 'imp-01-painel-configurado')

// ════════════════════════════════════════════════════════════════════════════
secao('5–8. Mesa 01 com dois pedidos em momentos diferentes: fichas só na Impressora 01')
const mesa = await um(`select m.id, m.nome from mesas m where restaurante_id=$1 and ativa and bloqueada_em is null
  and m.limpeza_desde is null and not exists (select 1 from comandas c where c.mesa_id=m.id and c.status='aberta') order by ordem limit 1`, [loja])
// 0094: mesa abre com o nome do cliente antes do primeiro lançamento.
await api(pAt, `/api/admin/mesas/${mesa.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'Cliente Demonstração', chave: uuid() })
const l1 = await api(pAt, '/api/admin/pdv/lancamento', 'POST', { mesaId: mesa.id, chave: uuid(), itens: [{ itemId: FILE.id, quantidade: 1, complementos: [] }] })
const comandaMesa = l1.json.comandaId
await esperar(2500)
const l2 = await api(pAt, '/api/admin/pdv/lancamento', 'POST', { comandaId: comandaMesa, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 2, complementos: [] }] })
const fichas = await aguardar(() => {
  const c = A.impressos().filter((x) => x.tipo === 'ficha_cozinha')
  return c.length >= 2 ? c : null
}, 40000)
ok('as duas fichas saíram', (fichas ?? []).length === 2, `${(fichas ?? []).length}`)
ok('só na Impressora 01 (80 mm, destino da função)', (fichas ?? []).every((f) => f.impressora === 'Impressora 01' && f.paperMm === 80))
ok('nada da cozinha na Impressora 02', !A.impressos().some((x) => x.tipo === 'ficha_cozinha' && x.impressora === 'Impressora 02'))
ok('pedidos marcados impressos pela fila de sempre', (await q('select impresso from pedidos where id = any($1::uuid[])', [[l1.json.id, l2.json.id]])).every((p) => p.impresso))

// ════════════════════════════════════════════════════════════════════════════
secao('9–13. Taxa, desconto, pagamento parcial e pré-conta pelo botão do PDV')
await api(pGer, `/api/admin/comandas/${comandaMesa}`, 'POST', { acao: 'ajustar_valores', descontoTipo: 'valor', descontoValor: 5, motivo: 'Cortesia interna (não sai no papel)' })
await api(pAt, `/api/admin/comandas/${comandaMesa}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: 20, chave: uuid() })
await pAt.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
await dispensarChecklist(pAt)
await pAt.getByRole('button', { name: new RegExp(mesa.nome) }).first().click()
await pAt.getByTestId('pre-conta-imprimir').click()
await pAt.getByTestId('pre-conta-estado').getByText('Aceito pela fila do Windows').waitFor({ timeout: 30000 })
await foto(pAt, 'imp-02-pdv-pre-conta-enviada')
const pc1 = A.impressos().filter((x) => x.tipo === 'pre_conta')
ok('pré-conta saiu uma vez, só na Impressora 02 (58 mm)', pc1.length === 1 && pc1[0].impressora === 'Impressora 02' && pc1[0].paperMm === 58)
ok('nenhuma pré-conta na Impressora 01', !A.impressos().some((x) => x.tipo === 'pre_conta' && x.impressora === 'Impressora 01'))
const t1 = pc1[0].texto.replace(/[\x01\x02]/g, ' ')
ok('conteúdo: PRÉ-CONTA, não fiscal, mesa, taxa 10%, desconto, pago e restante', ['PRÉ-CONTA', 'NÃO É DOCUMENTO FISCAL', mesa.nome.toUpperCase(), 'Taxa de serviço (10%)', 'Desconto', 'Já pago', 'Pix: R$ 20,00', 'RESTANTE A PAGAR', '1ª via'].every((t) => t1.includes(t)))
ok('motivo do desconto não sai no papel', !t1.includes('Cortesia interna'))
ok('pré-conta não disparou ficha da cozinha de novo', A.impressos().filter((x) => x.tipo === 'ficha_cozinha').length === 2)

secao('14–16. Conta muda e reimpressão: 2ª via com valores novos')
await api(pAt, `/api/admin/comandas/${comandaMesa}`, 'POST', { acao: 'pagamento', forma: 'debito', valor: 10, chave: uuid() })
await pAt.getByTestId('pre-conta-reimprimir').click()
await pAt.getByTestId('pre-conta-estado').getByText(/2ª via .*Aceito pela fila do Windows/).waitFor({ timeout: 30000 })
const pc2 = A.impressos().filter((x) => x.tipo === 'pre_conta')
const t2 = (pc2[1]?.texto ?? '').replace(/[\x01\x02]/g, ' ')
ok('2ª via impressa na Impressora 02', pc2.length === 2 && pc2[1].impressora === 'Impressora 02')
ok('2ª via marcada e com o pagamento novo', t2.includes('2ª VIA (reimpressão)') && t2.includes('Débito: R$ 10,00') && /Já pago\s+R\$ 30,00/.test(t2))
ok('snapshots diferentes entre as vias', (await q(`select snapshot->>'pago' p from impressao_trabalhos where comanda_id=$1 order by via`, [comandaMesa])).map((r) => Number(r.p)).join(',') === '20,30')

secao('17. Fechar a conta da mesa')
for (const p of (await api(pAt, `/api/admin/comandas/${comandaMesa}`)).json.conta.pedidos) {
  await api(pAt, `/api/admin/comandas/${comandaMesa}`, 'POST', { acao: 'transicionar', pedidoId: p.id, de: 'recebido', para: 'preparando' })
  await api(pAt, `/api/admin/comandas/${comandaMesa}`, 'POST', { acao: 'transicionar', pedidoId: p.id, de: 'preparando', para: 'pronto' })
  await api(pAt, `/api/admin/comandas/${comandaMesa}`, 'POST', { acao: 'atender', pedidoId: p.id })
}
const restMesa = (await api(pAt, `/api/admin/comandas/${comandaMesa}`)).json.conta.totais.restante
await api(pAt, `/api/admin/comandas/${comandaMesa}`, 'POST', { acao: 'pagamento', forma: 'credito', valor: restMesa, chave: uuid() })
ok('conta fechada', (await api(pAt, `/api/admin/comandas/${comandaMesa}`, 'POST', { acao: 'fechar' })).status === 200)
ok('fechar não imprimiu nada', A.impressos().length === 4)
await pAt.keyboard.press('Escape').catch(() => {})

// ════════════════════════════════════════════════════════════════════════════
secao('18–20. Balcão: taxa 0% e taxa manual do gerente')
const bal = await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Conceição Demonstração', chave: uuid() })
await api(pAt, '/api/admin/pdv/lancamento', 'POST', { comandaId: bal.json.id, chave: uuid(), itens: [{ itemId: FILE.id, quantidade: 1, complementos: [] }, { itemId: AGUA.id, quantidade: 1, complementos: [] }] })
await aguardar(() => A.impressos().filter((x) => x.tipo === 'ficha_cozinha').length >= 3, 30000)
await api(pAt, `/api/admin/comandas/${bal.json.id}/pre-conta`, 'POST', { chave: uuid() })
const pb1 = await aguardar(() => A.impressos().filter((x) => x.tipo === 'pre_conta')[2], 30000)
const tb1 = (pb1?.texto ?? '').replace(/[\x01\x02]/g, ' ')
ok('balcão: senha, nome, sem taxa de serviço', /BALCÃO · SENHA \d+/.test(tb1) && tb1.includes('Cliente: Conceição Demonstração') && !tb1.includes('Taxa de serviço'))
ok('atendente não aplica taxa manual no balcão', (await api(pAt, `/api/admin/comandas/${bal.json.id}`, 'POST', { acao: 'ajustar_valores', taxaServico: 10 })).status === 403)
ok('gerente aplica taxa manual', (await api(pGer, `/api/admin/comandas/${bal.json.id}`, 'POST', { acao: 'ajustar_valores', taxaServico: 10 })).status === 200)
await api(pAt, `/api/admin/comandas/${bal.json.id}/pre-conta`, 'POST', { chave: uuid(), reimpressao: true })
const pb2 = await aguardar(() => A.impressos().filter((x) => x.tipo === 'pre_conta')[3], 30000)
ok('2ª via do balcão com taxa manual (10%)', (pb2?.texto ?? '').replace(/[\x01\x02]/g, ' ').includes('Taxa de serviço (10%)'))

// ════════════════════════════════════════════════════════════════════════════
secao('21–22. Impressora 02 cai: cozinha continua; volta e a pré-conta sai')
await A.cmd({ cmd: 'remover', lista: ['Impressora 02'] })
const antesQueda = A.impressos().length
const pcQueda = await api(pAt, `/api/admin/comandas/${bal.json.id}/pre-conta`, 'POST', { chave: uuid(), reimpressao: true })
const falhou = await aguardar(async () => (await um('select erro, estado from impressao_trabalhos where id=$1', [pcQueda.json.id]))?.erro, 20000)
ok('pré-conta com Impressora 02 fora: erro registrado e trabalho pendente', /nao encontrada/.test(falhou ?? ''))
const k3 = await api(pAt, '/api/admin/pdv/lancamento', 'POST', { comandaId: bal.json.id, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }] })
const kOk = await aguardar(() => A.impressos().find((x) => x.tipo === 'ficha_cozinha' && x.n > antesQueda), 30000)
ok('enquanto a 02 está fora, a ficha da cozinha sai na 01', kOk?.impressora === 'Impressora 01', k3.status)
await pAt.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
await dispensarChecklist(pAt)
await A.cmd({ cmd: 'recolocar', lista: ['Impressora 02'] })
const volta = await aguardar(async () => (await um('select estado from impressao_trabalhos where id=$1', [pcQueda.json.id])).estado === 'enviado_spooler', 60000, 1000)
ok('impressora volta: a mesma pré-conta sai (retomada, sem nova via)', !!volta && A.impressos().filter((x) => x.tipo === 'pre_conta' && x.impressora === 'Impressora 02').length === 5)

// ════════════════════════════════════════════════════════════════════════════
secao('Dois computadores e uma impressora nas duas funções')
const cB = await api(pGer, '/api/admin/impressao/pareamento', 'POST')
const B = iniciarAgente('pc-caixa', ['Impressora B'])
ok('computador B pareia', (await B.cmd({ cmd: 'parear', codigo: cB.json.codigo, nome: 'PC Caixa' }))?.ok === true)
const dB = await aguardar(async () => (await painel(pGer)).dispositivos.find((d) => d.nomeSistema === 'Impressora B'))
await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: dB.id })
const antesB = A.impressos().length
await api(pAt, `/api/admin/comandas/${bal.json.id}/pre-conta`, 'POST', { chave: uuid(), reimpressao: true })
const noB = await aguardar(() => B.impressos().find((x) => x.tipo === 'pre_conta'), 30000)
ok('Caixa no outro computador: pré-conta sai no PC Caixa (Impressora B)', noB?.impressora === 'Impressora B')
await esperar(4000)
ok('e nada sai no PC Loja', A.impressos().length === antesB)
await pGer.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
await dispensarChecklist(pGer)
await pGer.getByTestId('funcao-caixa').selectOption(d01.id)
await pGer.getByTestId('confirmar-compartilhada').click()
ok('uma impressora nas duas funções: só depois de confirmar na tela', !!(await aguardar(async () => (await painel(pGer)).funcoes.caixa === d01.id)))
await foto(pGer, 'imp-03-uma-impressora-duas-funcoes')
const antes01 = A.impressos().length
await api(pAt, `/api/admin/comandas/${bal.json.id}/pre-conta`, 'POST', { chave: uuid(), reimpressao: true })
const em01 = await aguardar(() => A.impressos().find((x) => x.n > antes01 && x.tipo === 'pre_conta'), 30000)
ok('pré-conta sai na Impressora 01 (80 mm) quando ela também é o Caixa', em01?.impressora === 'Impressora 01' && em01?.paperMm === 80)
await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: d02.id })

// ════════════════════════════════════════════════════════════════════════════
secao('23. Acesso entre lojas')
ok('outra loja não imprime pré-conta desta conta', (await api(pViz, `/api/admin/comandas/${bal.json.id}/pre-conta`, 'POST', { chave: uuid() })).status >= 400)
const pViz2 = (await api(pViz, '/api/admin/impressao/painel')).json
ok('outra loja não vê os computadores nem as impressoras desta', !(pViz2?.agentes ?? []).some((a) => ['PC Loja', 'PC Caixa'].includes(a.nome)) && !(pViz2?.dispositivos ?? []).some((d) => /Impressora (01|02|B)/.test(d.nomeSistema)))

secao('24–25. Revogar o computador A pela tela')
await pGer.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
await dispensarChecklist(pGer)
await pGer.getByTestId('revogar-PC Loja').click()
ok('A revogado', !!(await aguardar(async () => (await painel(pGer)).agentes.find((a) => a.nome === 'PC Loja')?.revogado)))
const logA = await aguardar(() => A.logs.find((l) => l.includes('desconectado da loja')), 15000)
ok('o Assistente A percebe e para de buscar trabalhos', !!logA)
const semA = await api(pAt, `/api/admin/comandas/${bal.json.id}/pre-conta`, 'POST', { chave: uuid(), reimpressao: true })
ok('pré-conta para Caixa em computador revogado: erro claro', semA.status === 409)
await foto(pGer, 'imp-04-computador-revogado')
ok('B continua pareado e ativo', (await painel(pGer)).agentes.find((a) => a.nome === 'PC Caixa')?.revogado === false)

// ── artefatos: PDFs das pré-contas (58/80) e de uma ficha da cozinha ─────────
const { pngsParaPdf } = await import('../impressao/renderizar-virtual.mjs')
const imps = [...A.impressos(), ...B.impressos()]
const escolher = (pred) => imps.find(pred)
const pdfs = [
  ['pre-conta-mesa-58mm', escolher((x) => x.tipo === 'pre_conta' && x.paperMm === 58)],
  ['pre-conta-balcao-80mm', escolher((x) => x.tipo === 'pre_conta' && x.paperMm === 80)],
  ['cozinha-80mm', escolher((x) => x.tipo === 'ficha_cozinha')],
].filter(([, x]) => x?.png)
await pngsParaPdf(pdfs.map(([nome, x]) => ({ png: x.png, pdf: join(ART, `${nome}.pdf`), paperMm: x.paperMm })))
console.log(`\nArtefatos virtuais em: ${ART}`)

A.parar()
B.parar()
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza e2e impressão', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
await db.query('update restaurantes set impressao_cozinha_por_funcao=false where id=$1', [loja])
await browser.close()
await db.end()
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
