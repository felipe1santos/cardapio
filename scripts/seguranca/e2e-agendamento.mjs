/**
 * E2E — Fase 7 (2026-09-30): pedidos agendados. Stack local, loja ordem-qr-e2e.
 *   · loja fechada agora + agendamento ligado → "Somente pedidos agendados" e "Abrimos…";
 *   · checkout no celular: sem horário não passa; com horário o pedido nasce com agendado_para;
 *   · servidor recusa horário fora da grade/intervalo, loja fechada sem agendamento e horário lotado;
 *   · o agendado fica fora da fila de impressão, da cozinha e das colunas do Kanban (faixa
 *     "Agendados") até X minutos antes; depois entra sozinho;
 *   · Ajustes: seção salva no banco; desligado = vitrine volta ao "Fechada".
 * Restaura a loja e apaga os pedidos/estação TESTE no fim.
 *
 *   node scripts/seguranca/e2e-agendamento.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'ordem-qr-e2e'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const COLS = 'status_loja, horario_funcionamento, aceita_entrega, aceita_retirada, agendamento_ativo, agendamento_quando, agendamento_dias, agendamento_antecedencia_min, agendamento_intervalo_min, agendamento_limite, agendamento_entrega, agendamento_retirada, agendamento_libera_min'
const loja = await um(`select id, ${COLS} from restaurantes where slug=$1`, [SLUG])
const TEL = '27999880077'
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const horaSP = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date()))
const hh = (h) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

// Grade: todo dia abre daqui a 2h e fecha daqui a 6h → fechada agora, agendável hoje.
const h0 = horaSP()
const ABRE = hh(h0 + 2), FECHA = hh(h0 + 6)
const grade = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [{ abre: ABRE, fecha: FECHA }]]))

const browser = await chromium.launch()
let estacao = null
try {
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2`, [loja.id, TEL])
  await db.query(`update restaurantes set status_loja='automatico', horario_funcionamento=$2, aceita_entrega=true, aceita_retirada=true,
    agendamento_ativo=true, agendamento_quando='fechada', agendamento_dias=3, agendamento_antecedencia_min=60, agendamento_intervalo_min=30,
    agendamento_limite=1, agendamento_entrega=true, agendamento_retirada=true, agendamento_libera_min=30 where id=$1`, [loja.id, JSON.stringify(grade)])

  console.log(`\n── API de horários (grade ${ABRE}–${FECHA}) ──`)
  const api1 = await (await fetch(`${BASE}/api/loja/${SLUG}/agendamento`)).json()
  ok('loja fechada + agendamento ligado → pode agendar', api1.podeAgendar === true && api1.dias.length >= 1, JSON.stringify(api1.dias?.[0] ?? null).slice(0, 120))
  const primeiro = api1.dias[0]
  ok('primeiro horário é a abertura (fora da grade não aparece)', primeiro.horarios[0] === ABRE && !primeiro.horarios.includes(hh(h0 + 1)), primeiro.horarios.slice(0, 3).join(', '))
  ok('de 30 em 30 minutos', primeiro.horarios[1] === ABRE.replace(':00', ':30') || ABRE === '23:00')

  console.log('\n── vitrine no celular ──')
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 800 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
  await p.evaluate(() => localStorage.clear())
  await p.reload({ waitUntil: 'networkidle' })
  const status = await p.getByTestId('status-somente-agendado').first().innerText().catch(() => '')
  const diaHoje = DIAS[new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay()]
  ok('cartão da loja: "Somente pedidos agendados" + "Abrimos hoje (dia) às HH:00"', /Somente pedidos agendados/.test(status) && status.includes(`Abrimos hoje (${diaHoje}) às ${ABRE}`), status.replace(/\n/g, ' / '))
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'vitrine-somente-agendado-390.png') })
  await p.locator('button:has-text("R$")', { hasText: 'Coca Lata' }).first().tap()
  await p.getByRole('button', { name: /Adicionar/ }).last().tap()
  await p.waitForTimeout(500)
  await p.getByText('Ver sacola').first().tap()
  ok('sacola: faixa "Somente pedidos agendados"', (await p.getByTestId('faixa-somente-agendado').count()) > 0)
  await p.getByRole('button', { name: /^Retirada/ }).first().tap().catch(() => {})
  const cont = p.getByRole('button', { name: /Continuar para pagamento/ }).last()
  ok('botão de finalizar habilitado com a loja fechada (agendado)', await cont.isEnabled())
  await cont.tap()
  const tel = p.getByPlaceholder('(00) 00000-0000').first()
  await tel.waitFor({ timeout: 8000 })
  await tel.fill(TEL)
  await p.locator('div').filter({ has: p.getByText('Informe seu telefone') }).last().getByRole('button', { name: /^Continuar$/i }).tap()
  await p.waitForTimeout(1200)
  await p.getByText('Pix', { exact: true }).first().tap()
  await p.getByRole('button', { name: /Ir para endereço|Continuar/ }).last().tap()
  await p.waitForTimeout(600)
  await p.getByPlaceholder('Seu nome').fill('TESTE Agendado')
  await p.getByRole('button', { name: /Revisar pedido/ }).tap()
  await p.waitForTimeout(1200)
  const bloco = p.getByTestId('checkout-agendamento')
  ok('revisão: "Quando você quer retirar?" sem a opção "Agora" (loja fechada)', (await bloco.count()) > 0 && (await bloco.getByRole('button', { name: 'Agora' }).count()) === 0)
  await p.getByRole('button', { name: /Fazer pedido/ }).tap()
  await p.waitForTimeout(600)
  ok('sem escolher horário não envia', (await p.getByText('Escolha o dia e o horário do agendamento.').count()) > 0)
  await p.getByTestId('agendamento-hora').selectOption(primeiro.horarios[1] ?? primeiro.horarios[0])
  const horaEscolhida = primeiro.horarios[1] ?? primeiro.horarios[0]
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'checkout-agendamento-390.png') })
  await p.getByRole('button', { name: /Fazer pedido/ }).tap()
  await p.waitForTimeout(2500)
  const ped = await um(`select id, numero, status, agendado_para, tipo from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2 order by criado_em desc limit 1`, [loja.id, TEL])
  const esperado = new Date(`${primeiro.data}T${horaEscolhida}:00-03:00`).toISOString()
  ok('pedido gravado com agendado_para = dia/horário escolhidos', ped && new Date(ped.agendado_para).toISOString() === esperado && ped.status === 'recebido', JSON.stringify(ped))
  await p.getByText(/Meus pedidos|Pedidos/).first().tap().catch(() => {})
  await ctx.close()

  console.log('\n── servidor confere tudo ──')
  const corpo = (extra) => ({ tipo: 'retirada', cliente: { nome: 'TESTE Agendado', telefone: TEL }, endereco: {}, pagamento: 'pix', trocoPara: null,
    itens: [{ itemId: null, quantidade: 1, observacao: '', complementos: [] }], ...extra })
  const item = await um(`select id from itens_cardapio where restaurante_id=$1 and nome ilike '%Coca Lata%' limit 1`, [loja.id])
  const post = async (extra) => {
    const b = corpo(extra); b.itens[0].itemId = item.id
    const r = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    return { st: r.status, j: await r.json().catch(() => ({})) }
  }
  const foraIntervalo = new Date(new Date(`${primeiro.data}T${ABRE}:00-03:00`).getTime() + 10 * 60000).toISOString()
  let r = await post({ agendadoPara: foraIntervalo })
  ok('horário fora do intervalo (abertura + 10 min) recusado', r.st >= 400 && /não está disponível/.test(r.j.error ?? ''), `${r.st} ${r.j.error}`)
  r = await post({ agendadoPara: new Date(`${primeiro.data}T${hh(h0 + 1)}:00-03:00`).toISOString() })
  ok('horário antes de abrir (fora da grade) recusado', r.st >= 400, `${r.st} ${r.j.error}`)
  r = await post({})
  ok('sem agendamento, loja fechada recusa', r.st >= 400 && /fechada/.test(r.j.error ?? ''), `${r.st} ${r.j.error}`)
  r = await post({ agendadoPara: esperado })
  ok('horário lotado (limite 1) recusado', r.st >= 400 && /lotou/.test(r.j.error ?? ''), `${r.st} ${r.j.error}`)
  const api2 = await (await fetch(`${BASE}/api/loja/${SLUG}/agendamento`)).json()
  ok('horário lotado some da lista', !(api2.dias.find((d) => d.data === primeiro.data)?.horarios ?? []).includes(horaEscolhida))

  console.log('\n── fora do fluxo até a liberação ──')
  estacao = await um(`insert into estacoes (restaurante_id, nome, modo) values ($1, 'TESTE agendamento', 'completa') returning id, token`, [loja.id])
  const kds = async () => (await (await fetch(`${BASE}/api/cozinha/${estacao.token}`)).json())
  const naFila = async () => (await db.query(`select 1 from impressao_elegiveis($1) x where x = $2`, [loja.id, ped.id])).rowCount > 0
  const noKds = async () => JSON.stringify(await kds()).includes(ped.id)
  ok('fila de impressão: agendado NÃO entra antes da hora', !(await naFila()))
  ok('cozinha: agendado NÃO aparece antes da hora', !(await noKds()))

  const dono = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR' })
  const d = await dono.newPage()
  await d.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await d.fill('input[name="email"]', 'dono.ordemqr')
  await d.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([d.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), d.click('button[type="submit"]')])
  await d.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
  await d.getByRole('button', { name: /ok, entendi/i }).click({ timeout: 4000 }).catch(() => {})
  await d.waitForTimeout(1500)
  const faixa = await d.getByTestId('faixa-agendados').innerText().catch(() => '')
  ok('Kanban: faixa "Agendados" mostra o pedido, fora da coluna Recebido', faixa.includes(`#${ped.numero}`), faixa.replace(/\n/g, ' '))
  if (PRINTS) await d.screenshot({ path: join(PRINTS, 'kanban-faixa-agendados.png') })

  // Chega a hora: o horário passa a estar a 10 min (liberação 30 min antes).
  await db.query(`update pedidos set agendado_para = now() + interval '10 minutes' where id=$1`, [ped.id])
  ok('fila de impressão: liberado entra sozinho', await naFila())
  ok('cozinha: liberado aparece', await noKds())
  await d.reload({ waitUntil: 'networkidle' })
  await d.waitForTimeout(1500)
  const naColuna = (await d.getByText(/Agendado hoje às|Agendado amanhã às/).count()) > 0 && (await d.getByTestId('faixa-agendados').count()) === 0
  ok('Kanban: liberado vai para a coluna com a etiqueta "Agendado …"', naColuna)
  if (PRINTS) await d.screenshot({ path: join(PRINTS, 'kanban-liberado.png') })

  console.log('\n── Ajustes ──')
  await d.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' })
  await d.getByRole('button', { name: /ok, entendi/i }).click({ timeout: 4000 }).catch(() => {})
  await d.waitForTimeout(1200)
  const secao = d.getByTestId('ajustes-agendamento')
  ok('Ajustes › Loja: seção "Pedidos agendados"', (await secao.count()) > 0)
  await secao.scrollIntoViewIfNeeded()
  if (PRINTS) await secao.screenshot({ path: join(PRINTS, 'ajustes-agendamento.png') })
  await d.getByTestId('agendamento-quando').selectOption('sempre')
  await d.getByTestId('agendamento-salvar').click()
  await d.waitForTimeout(1200)
  ok('salvar grava no banco', (await um(`select agendamento_quando q from restaurantes where id=$1`, [loja.id])).q === 'sempre')
  await d.getByTestId('agendamento-ativo').uncheck()
  await d.getByTestId('agendamento-salvar').click()
  await d.waitForTimeout(1200)
  ok('desligar grava no banco', (await um(`select agendamento_ativo a from restaurantes where id=$1`, [loja.id])).a === false)
  const api3 = await (await fetch(`${BASE}/api/loja/${SLUG}/agendamento`)).json()
  ok('desligado: API não oferece agendamento', api3.podeAgendar === false)
  await dono.close()
  const v2 = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 800 }, locale: 'pt-BR' })
  const p2 = await v2.newPage()
  await p2.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
  ok('desligado: vitrine volta ao "Fechada"', (await p2.getByTestId('status-somente-agendado').count()) === 0 && (await p2.getByText(/Fechada/).count()) > 0)
  await v2.close()
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2`, [loja.id, TEL])
  if (estacao) await db.query(`delete from estacoes where id=$1`, [estacao.id])
  await db.query(`update restaurantes set status_loja=$2, horario_funcionamento=$3, aceita_entrega=$4, aceita_retirada=$5, agendamento_ativo=$6, agendamento_quando=$7,
    agendamento_dias=$8, agendamento_antecedencia_min=$9, agendamento_intervalo_min=$10, agendamento_limite=$11, agendamento_entrega=$12, agendamento_retirada=$13,
    agendamento_libera_min=$14 where id=$1`, [loja.id, loja.status_loja, loja.horario_funcionamento === null ? null : JSON.stringify(loja.horario_funcionamento), loja.aceita_entrega, loja.aceita_retirada,
    loja.agendamento_ativo, loja.agendamento_quando, loja.agendamento_dias, loja.agendamento_antecedencia_min, loja.agendamento_intervalo_min, loja.agendamento_limite,
    loja.agendamento_entrega, loja.agendamento_retirada, loja.agendamento_libera_min])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
