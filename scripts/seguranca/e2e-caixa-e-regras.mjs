/**
 * Os fluxos que a auditoria da release candidate acrescentou, feitos PELA TELA, em
 * navegador real — não por chamada de API:
 *
 *   1. dono liga/desliga o módulo em Ajustes (e desligar com conta aberta é recusado);
 *   2. dono muda as regras do salão em "Conta e pagamentos";
 *   3. garçom PEDE o cancelamento de um item; a gestão aprova pela conta;
 *   4. dono dá desconto percentual pelo formulário; "cliente recusou a taxa";
 *   5. fiado exige de quem é a conta;
 *   6. caixa (atendente) abre a mesa direto na conta, recebe e fecha;
 *   7. QR revogado sem substituto, e gerado de novo.
 *
 * Screenshots em celular (390×844) e desktop para a conferência humana. Só loopback.
 *   node scripts/seguranca/servidor-local.mjs build && ... start
 *   node scripts/seguranca/e2e-caixa-e-regras.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)

execFileSync(process.execPath, ['scripts/seguranca/semear-demo-mesas.mjs'], { stdio: 'ignore' })
mkdirSync('.shots', { recursive: true })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const mesa02 = await um(`select id, nome from mesas where restaurante_id=$1 and nome='Mesa 02'`, [loja])
const mesa01 = await um(`select id, nome from mesas where restaurante_id=$1 and nome='Mesa 01'`, [loja])

const browser = await chromium.launch()
const CELULAR = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
const DESKTOP = { viewport: { width: 1360, height: 900 } }

async function logar(usuario, tela = DESKTOP) {
  const ctx = await browser.newContext({ ...tela, locale: 'pt-BR' })
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

async function dispensarChecklist(page) {
  const botao = page.locator('button', { hasText: 'OK, entendi' })
  if (await botao.count()) {
    await botao.first().click()
    await page.waitForTimeout(300)
  }
}

async function abrirConta(page, mesaId) {
  await page.goto(`${BASE}/admin/mesas/${mesaId}`, { waitUntil: 'networkidle' })
  const aba = page.getByRole('tab', { name: /Conta/ })
  if (await aba.count()) await aba.click()
  await page.locator('[data-testid="restante"]').waitFor({ timeout: 20000 })
}

const dono = await logar('dono.local')
const garcom = await logar('garcom.local', CELULAR)
const caixa = await logar('atendente.local', CELULAR)

// ════════════════════════════════════════════════════════════════════════════
secao('1. módulo em Ajustes')
{
  const p = dono.page
  await p.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' })
  await dispensarChecklist(p)
  await p.getByRole('button', { name: 'Mesas', exact: true }).first().click()
  await p.getByText('Módulo Mesas e Comandas').waitFor({ timeout: 15000 })
  ok('Ajustes mostra o módulo ligado', (await p.getByText('Ligado', { exact: true }).count()) > 0)
  await p.getByRole('button', { name: 'Desligar' }).click()
  ok('desligar pede confirmação e avisa das contas abertas', (await p.getByText(/conta aberta|contas abertas/).count()) > 0)
  await p.getByRole('button', { name: 'Desligar o módulo' }).click()
  // O Next tem um anunciador de rota com role=alert vazio: o escopo é o aviso do cartão.
  const aviso = p.locator('p[role="alert"]', { hasText: /conta/ })
  await aviso.waitFor({ timeout: 15000 })
  const alerta = await aviso.innerText()
  ok('com conta de mesa aberta, o servidor recusa desligar', /Feche ou cancele/.test(alerta), alerta)
  const ainda = await um(`select modulo_mesas_ativo from restaurantes where id=$1`, [loja])
  ok('e o módulo continua ligado', ainda.modulo_mesas_ativo === true)
  await p.screenshot({ path: '.shots/cx-01-ajustes-modulo.png' })
}

// ════════════════════════════════════════════════════════════════════════════
secao('2. regras do salão pela tela')
{
  const p = dono.page
  await p.goto(`${BASE}/admin/mesas`, { waitUntil: 'networkidle' })
  await dispensarChecklist(p)
  await p.getByRole('button', { name: 'Conta e pagamentos' }).click()
  const regra = p.getByRole('checkbox', { name: /Garçom recebe pagamento/ })
  await regra.waitFor({ timeout: 15000 })
  ok('regra "garçom recebe" nasce desligada', !(await regra.isChecked()))
  await regra.check()
  await p.getByRole('button', { name: 'Salvar' }).click()
  await p.getByText('Configuração salva.').waitFor({ timeout: 15000 })
  const r = await um(`select salao_garcom_recebe from restaurantes where id=$1`, [loja])
  ok('dono liga a regra pela tela', r.salao_garcom_recebe === true)
  await p.screenshot({ path: '.shots/cx-02-regras-salao.png' })

  // Com a regra ligada, o formulário de pagamento aparece para o garçom.
  await abrirConta(garcom.page, mesa02.id)
  ok('com a regra, o garçom vê "Receber pagamento"', (await garcom.page.getByText('Receber pagamento').count()) === 1)
  await regra.uncheck()
  await p.getByRole('button', { name: 'Salvar' }).click()
  await p.getByText('Configuração salva.').waitFor({ timeout: 15000 })
  await abrirConta(garcom.page, mesa02.id)
  ok('sem a regra, o garçom não vê o formulário de pagamento', (await garcom.page.getByText('Receber pagamento').count()) === 0)
  ok('nem o botão de fechar a conta', (await garcom.page.getByRole('button', { name: 'Fechar conta' }).count()) === 0)
  const aud = await um(`select dados from eventos_auditoria where restaurante_id=$1 and acao='mesas.configurou_conta' order by criado_em desc limit 1`, [loja])
  ok('a mudança de regra fica auditada com antes e depois', aud?.dados?.antes?.garcomRecebe === true && aud?.dados?.depois?.garcomRecebe === false)
  await p.keyboard.press('Escape')
}

// ════════════════════════════════════════════════════════════════════════════
secao('3. garçom pede o cancelamento; a gestão decide')
{
  const g = garcom.page
  await abrirConta(g, mesa02.id)
  const botao = g.getByRole('button', { name: /^Pedir cancelamento de / }).first()
  const rotulo = await botao.getAttribute('aria-label')
  await botao.click()
  await g.getByRole('dialog').locator('input').fill('cliente mudou o pedido')
  await g.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click()
  await g.getByText('Pedido de cancelamento enviado à gestão.').waitFor({ timeout: 15000 })
  ok('o garçom vê o item marcado como "aguardando gestão"', (await g.getByText('Cancelamento pedido — aguardando gestão').count()) === 1, rotulo)
  ok('o garçom não tem botão de aprovar', (await g.getByRole('button', { name: /Aprovar/ }).count()) === 0)
  await g.screenshot({ path: '.shots/cx-03-garcom-pediu-cancelamento.png', fullPage: true })

  const d = dono.page
  await abrirConta(d, mesa02.id)
  await d.locator('[data-testid="solicitacoes"]').waitFor({ timeout: 15000 })
  ok('a gestão vê o pedido pendente com motivo e autor', /cliente mudou o pedido/.test(await d.locator('[data-testid="solicitacoes"]').innerText()))
  await d.screenshot({ path: '.shots/cx-04-gestao-decide.png' })
  await d.getByRole('button', { name: /Aprovar/ }).click()
  await d.getByText('Cancelamento aprovado.').waitFor({ timeout: 15000 })
  ok('aprovado, o bloco some e o item aparece cancelado', (await d.locator('[data-testid="solicitacoes"]').count()) === 0 &&
    (await d.getByText(/Cancelado por Dono Demo/).count()) === 1)
}

// ════════════════════════════════════════════════════════════════════════════
secao('4. desconto percentual e taxa recusada, pela tela')
{
  const d = dono.page
  await abrirConta(d, mesa02.id)
  await d.getByRole('button', { name: 'Ajustar taxa de serviço ou desconto' }).click()
  await d.getByRole('radio', { name: '%' }).click()
  await d.getByLabel('Desconto em porcentagem').fill('10')
  await d.getByLabel('Motivo do desconto').fill('cliente da casa')
  await d.getByRole('button', { name: 'Aplicar' }).click()
  await d.getByText('Valores ajustados.').waitFor({ timeout: 15000 })
  const c = await um(`select desconto_tipo, desconto_percentual from comandas where mesa_id=$1 and status='aberta'`, [mesa02.id])
  ok('comanda fica com desconto de 10%', c.desconto_tipo === 'percentual' && Number(c.desconto_percentual) === 10)
  ok('a tela mostra "Desconto (10%)"', (await d.getByText(/Desconto \(10%\)/).count()) === 1)

  await d.getByRole('button', { name: 'Cliente recusou a taxa' }).click()
  await d.getByText('Taxa de serviço removida.').waitFor({ timeout: 15000 })
  const t = await um(`select taxa_servico_percentual, desconto_tipo from comandas where mesa_id=$1 and status='aberta'`, [mesa02.id])
  ok('taxa removida sem mexer no desconto', Number(t.taxa_servico_percentual) === 0 && t.desconto_tipo === 'percentual')
  ok('e a tela oferece restaurar a taxa padrão', (await d.getByRole('button', { name: /Restaurar taxa de 10/ }).count()) === 1)
  await d.screenshot({ path: '.shots/cx-05-desconto-percentual.png', fullPage: true })
  await d.getByRole('button', { name: /Restaurar taxa de 10/ }).click()
  await d.getByText(/Taxa de 10% restaurada/).waitFor({ timeout: 15000 })
}

// ════════════════════════════════════════════════════════════════════════════
secao('5. fiado só com de quem é a conta')
{
  // Fiado precisa estar entre as formas aceitas: o dono liga pela API da tela.
  await dono.page.evaluate(async () => {
    await fetch('/api/admin/mesas/configuracao', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taxaServicoPadrao: 10, formasPagamento: ['dinheiro', 'pix', 'credito', 'debito', 'fiado'] }),
    })
  })
  const d = dono.page
  await abrirConta(d, mesa02.id)
  await d.getByRole('radio', { name: 'Fiado' }).click()
  await d.getByLabel('Valor do pagamento').fill('10')
  ok('sem dizer de quem é, o fiado não registra', await d.getByRole('button', { name: 'Registrar pagamento' }).isDisabled())
  await d.getByLabel('De quem é a conta').fill('Seu Jorge, 11 98888-0000')
  await d.getByRole('button', { name: 'Registrar pagamento' }).click()
  await d.getByText('Pagamento registrado.').waitFor({ timeout: 15000 })
  ok('o fiado aparece na lista com a observação', (await d.getByText('Seu Jorge, 11 98888-0000').count()) === 1)

  await abrirConta(caixa.page, mesa02.id)
  ok('o caixa não vê a opção de fiado', (await caixa.page.getByRole('radio', { name: 'Fiado' }).count()) === 0)
}

// ════════════════════════════════════════════════════════════════════════════
secao('6. caixa recebe e fecha pela tela (celular)')
{
  const c = caixa.page
  await c.goto(`${BASE}/admin/mesas`, { waitUntil: 'networkidle' })
  ok('o caixa não vê o painel de chamados nem "Nova mesa"',
    (await c.getByRole('button', { name: 'Nova mesa' }).count()) === 0)
  await c.screenshot({ path: '.shots/cx-06-caixa-salao.png', fullPage: true })
  await c.locator('a', { hasText: 'Ver conta' }).first().click()
  await c.locator('[data-testid="restante"]').waitFor({ timeout: 20000 })
  ok('o caixa abre a mesa direto na conta', (await c.getByRole('tab', { name: 'Lançar pedido' }).count()) === 0)
  const restante = (await c.locator('[data-testid="restante"]').innerText()).trim()
  await c.getByRole('radio', { name: 'Pix' }).click()
  await c.getByRole('button', { name: /^Tudo/ }).click()
  await c.getByRole('button', { name: 'Registrar pagamento' }).dblclick()
  await c.getByText('Pagamento registrado.').waitFor({ timeout: 15000 })
  await c.locator('[data-testid="restante"]').filter({ hasText: '0,00' }).waitFor({ timeout: 15000 })
  const pix = await q(`select count(*)::int n from pagamentos_comanda where comanda_id=(select id from comandas where mesa_id=$1 and status='aberta') and forma='pix' and estornado_em is null`, [mesa02.id])
  ok('clique duplo do caixa registra UM pagamento', pix[0].n === 1, `restante era ${restante}`)
  await c.screenshot({ path: '.shots/cx-07-caixa-quitou.png', fullPage: true })
  await c.getByRole('button', { name: 'Fechar conta' }).click()
  await c.getByRole('alertdialog').getByRole('button', { name: 'Fechar conta' }).click()
  await c.getByText(/fechada\. A mesa está livre/).waitFor({ timeout: 15000 })
  const f = await um(`select status, fechada_por_nome from comandas where mesa_id=$1 order by aberta_em desc limit 1`, [mesa02.id])
  ok('conta fechada pelo caixa', f.status === 'fechada' && f.fechada_por_nome === 'Atendente Demo', JSON.stringify(f))
  const ev = await um(`select papel, dados from eventos_auditoria where restaurante_id=$1 and acao='conta.fechou' order by criado_em desc limit 1`, [loja])
  ok('fechamento auditado com o papel do caixa e a situação da taxa', ev?.papel === 'atendente' && ev?.dados?.taxa_situacao === 'aceita', JSON.stringify(ev))
}

// ════════════════════════════════════════════════════════════════════════════
secao('7. QR revogado pela tela')
{
  const d = dono.page
  await d.goto(`${BASE}/admin/mesas`, { waitUntil: 'networkidle' })
  await dispensarChecklist(d)
  const cartao = d.locator('div.flex-col.rounded-menuzia', { has: d.locator('span', { hasText: /^Mesa 01$/ }) })
  await cartao.locator('button[title="Ver QR Code"]').click()
  await d.locator('img[alt="QR Code da Mesa 01"]').waitFor({ timeout: 15000 })
  const link = await d.getByLabel('Link da mesa').inputValue()
  ok('o drawer mostra o link da mesa vindo da rota protegida', /\/mesa\/[0-9a-f-]{36}$/.test(link), link.replace(/[0-9a-f-]{36}$/, '<token>'))
  await d.getByRole('button', { name: 'Revogar sem gerar outro' }).click()
  await d.getByRole('button', { name: 'Revogar', exact: true }).click()
  await d.getByText(/QR revogado\. Nenhum link abre/).waitFor({ timeout: 15000 })
  ok('a tela mostra o QR revogado', true)
  const cliente = await (await browser.newContext()).newPage()
  const r = await cliente.goto(link, { waitUntil: 'domcontentloaded' })
  ok('o link antigo morre na hora', (r?.status() ?? 0) === 404, `HTTP ${r?.status()}`)
  await d.screenshot({ path: '.shots/cx-08-qr-revogado.png' })
  await d.getByRole('button', { name: 'Fechar' }).first().click()
  ok('o salão marca a mesa como "QR revogado"', (await cartao.getByText('QR revogado — gere um novo').count()) === 1)
  await cartao.locator('button[title="Ver QR Code"]').click()
  await d.getByRole('button', { name: /Gerar novo/ }).click()
  await d.getByRole('button', { name: 'Revogar e gerar novo' }).click()
  await d.locator('img[alt="QR Code da Mesa 01"]').waitFor({ timeout: 15000 })
  const novo = await d.getByLabel('Link da mesa').inputValue()
  const r2 = await cliente.goto(novo, { waitUntil: 'domcontentloaded' })
  ok('gerar de novo devolve um link que funciona', novo !== link && (r2?.status() ?? 0) === 200, `HTTP ${r2?.status()}`)
  await cliente.context().close()
  void mesa01
}

await browser.close()
await db.end()
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas === 0 ? '✅' : '❌'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)
