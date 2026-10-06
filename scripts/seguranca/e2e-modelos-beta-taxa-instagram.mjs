/**
 * E2E (2026-09-28): taxa manual da conta, Instagram da loja e os modelos oficiais do
 * Assistente Beta (comanda da cozinha e pré-conta).
 *
 * Loja ISOLADA local (E2E_LOJA), stack local, nada de produção, nenhuma impressora:
 * os documentos viram PNG pelo mesmo ticket.html / ticket-canvas.js do Beta (render-beta.mjs).
 *
 *   E2E_LOJA=cantina-pdv2 E2E_VIZINHA=vizinha-pdv2 E2E_SUFIXO=pdv2 SHOTS=<pasta> \
 *     node scripts/seguranca/e2e-modelos-beta-taxa-instagram.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
import { E2E_LOJA, E2E_VIZINHA, USU, exigirLojaIsolada } from './e2e-ambiente.mjs'
import { renderizarBeta, renderizarCozinhaBeta, fecharRender } from '../impressao/render-beta.mjs'

exigirLojaIsolada()
const require = createRequire(import.meta.url)
const QRCode = require('qrcode')
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'menuzia-e2e-modelos-beta')
mkdirSync(SHOTS, { recursive: true })
const { DB_URL, API_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)

execFileSync(process.execPath, ['scripts/seguranca/semear-demo-mesas.mjs'], { stdio: 'ignore' })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== '' && detalhe !== null ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const sha = (s) => createHash('sha256').update(s).digest('hex')
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]

const loja = await um(`select id, slug from restaurantes where slug=$1`, [E2E_LOJA])
const L = loja.id
const vizinha = (await um(`select id from restaurantes where slug=$1`, [E2E_VIZINHA])).id
const FILE = await um(`select id, preco from itens_cardapio where restaurante_id=$1 and nome='Filé à Parmegiana'`, [L])
const AGUA = await um(`select id, preco from itens_cardapio where restaurante_id=$1 and nome='Água com Gás'`, [L])
const MESA = await um(`select id, nome from mesas where restaurante_id=$1 and ativa order by ordem, nome limit 1`, [L])

await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza e2e modelos', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [L])
for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes', 'impressao_reservas']) {
  await db.query(`delete from ${t} where restaurante_id=$1`, [L])
}
const tokenLegado = uuid()
await db.query(`update restaurantes set pdv_v2=true, modulo_mesas_ativo=true, impressao_automatica=true, impressao_cozinha_por_funcao=false,
  impressao_beta_liberado=true, impressao_beta_modo='teste', impressao_cozinha_transferida_em=null, impressao_agente_token=$2, instagram_url=null where id=$1`, [L, tokenLegado])
await db.query('update pedidos set impresso=true, reimprimir=false where restaurante_id=$1', [L])
const inicio = (await um('select now() t')).t

const browser = await chromium.launch()
async function logar(usuario, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')])
  await page.waitForLoadState('networkidle').catch(() => {})
  return { ctx, page }
}
const api = (page, url, metodo = 'GET', corpo) =>
  page.evaluate(
    async ({ url, metodo, corpo }) => {
      const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
      let json = null
      try { json = await r.json() } catch { /* sem corpo */ }
      return { status: r.status, json }
    },
    { url: `${BASE}${url}`, metodo, corpo },
  )
const foto = (page, nome) => page.screenshot({ path: join(SHOTS, `${nome}.png`) })

const dono = await logar(USU.dono)
const pd = dono.page
const garcom = await logar(USU.garcom)
const vizinhaDono = await logar(USU.donoVizinha)

async function abrirBalcao(nome) {
  const r = await api(pd, '/api/admin/balcao/comandas', 'POST', { nome, modalidade: 'retirada', chave: uuid() })
  const id = r.json?.id ?? r.json?.comandaId
  const senha = r.json?.senha
  const l = await api(pd, '/api/admin/pdv/lancamento', 'POST', { pagamento: { escolha: 'dinheiro' }, comandaId: id, chave: uuid(), itens: [{ itemId: FILE.id, quantidade: 1, complementos: [] }, { itemId: AGUA.id, quantidade: 2, complementos: [] }] })
  return { id, senha, abertura: r, lancamento: l }
}
const conta = async (id) => (await api(pd, `/api/admin/comandas/${id}`)).json?.conta
const subtotalEsperado = Math.round((Number(FILE.preco) + 2 * Number(AGUA.preco)) * 100) / 100

try {
  // ════════════════════════════════════════════════════════════════════════════
  secao('Taxa manual no PDV (balcão)')
  const b1 = await abrirBalcao('Taxa Teste')
  ok('conta de balcão aberta e itens lançados', !!b1.id && b1.lancamento.status < 300, `${b1.abertura.status}/${b1.lancamento.status}`)
  const c0 = await conta(b1.id)
  ok('antes: sem taxa manual, total = subtotal', c0?.taxaExtra === null && c0?.totais.total === subtotalEsperado, JSON.stringify(c0?.totais))

  await pd.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
  await pd.getByTestId('card-balcao').click()
  await pd.getByTestId(`balcao-linha-${b1.senha}`).click()
  await pd.getByTestId('conta-titulo').waitFor()
  // 2026-10-01: "Taxas" na barra de ações da conta, modal de várias taxas (0124).
  ok('botão "Taxas" na barra de ações da conta', (await pd.getByTestId('conta-adicionar-taxa').innerText()).includes('Taxas'))
  await pd.getByTestId('conta-adicionar-taxa').click()
  await pd.getByTestId('taxas-modal').waitFor()
  await foto(pd, 'pdv-01-modal-taxa')
  await pd.getByTestId('taxa-adicionar').click()
  await pd.getByTestId('taxa-nome').last().fill('Couvert')
  await pd.getByTestId('taxa-tipo-fixo').last().click()
  await pd.getByTestId('taxa-base').last().fill('12,50')
  await pd.getByTestId('taxas-salvar').click()
  await pd.getByTestId('conta-taxa-linha').first().waitFor({ timeout: 10000 })
  await foto(pd, 'pdv-02-conta-com-taxa')
  const linhaTaxa = await pd.getByTestId('conta-taxa-linha').first().innerText()
  ok('tela: linha "Couvert R$ 12,50" nos totais da conta', /Couvert/.test(linhaTaxa) && /12,50/.test(linhaTaxa), linhaTaxa.replace(/\s+/g, ' '))
  const c1 = await conta(b1.id)
  ok('taxa entra no total só desta conta', c1.totais.total === Math.round((subtotalEsperado + 12.5) * 100) / 100 && c1.totais.taxaExtra === 12.5, JSON.stringify(c1.totais))
  ok('taxa não vira item nem pedido', c1.pedidos.flatMap((p) => p.itens).every((i) => i.nome !== 'Couvert'))
  ok('catálogo intacto (nenhum item "Couvert")', !(await um(`select 1 x from itens_cardapio where restaurante_id=$1 and nome ilike 'couvert%'`, [L])))
  const rest = (await pd.getByTestId('conta-restante').innerText()).replace(/\s/g, '')
  ok('restante na tela já com a taxa', rest.includes((subtotalEsperado + 12.5).toFixed(2).replace('.', ',')), rest)

  // Fechamento: a linha aparece na simulação e dá para trocar a taxa ali.
  await pd.getByTestId('conta-fechar').click()
  await pd.getByTestId('fechar-modal').waitFor({ timeout: 15000 })
  await esperar(1500)
  // Pedidos ainda na cozinha: o fechamento pede uma decisão (aqui, entregue).
  for (const b of await pd.locator('[data-testid^="fechar-pendencia-"][data-testid$="-entregue"]').all()) await b.click()
  await pd.getByTestId('fechar-simulacao').waitFor({ timeout: 15000 })
  const sim = await pd.getByTestId('fechar-simulacao').innerText()
  ok('fechamento: resumo mostra a taxa', /Couvert/.test(sim) && /12,50/.test(sim), sim.replace(/\s+/g, ' ').slice(0, 160))
  ok('fechamento: opção "Alterar taxas" presente', (await pd.getByTestId('fechar-taxa-extra').innerText()).includes('Alterar taxas'))
  await pd.getByTestId('fechar-taxa-extra').click()
  await pd.getByTestId('taxas-modal').waitFor()
  await pd.getByTestId('taxa-nome').first().fill('Taxa extra')
  await pd.getByTestId('taxa-base').first().fill('8')
  await pd.getByTestId('taxas-salvar').click()
  await pd.getByTestId('taxas-modal').waitFor({ state: 'detached', timeout: 10000 })
  await esperar(1200)
  const sim2 = await pd.getByTestId('fechar-simulacao').innerText()
  await foto(pd, 'pdv-03-fechamento-com-taxa')
  ok('fechamento: alterar a taxa recalcula o saldo', /Taxa extra/.test(sim2) && sim2.includes((subtotalEsperado + 8).toFixed(2).replace('.', ',')), sim2.replace(/\s+/g, ' ').slice(0, 200))
  // Recebe o saldo (já com a taxa) no Pix e fecha.
  await pd.getByTestId('fechar-pag-0-forma-pix').click()
  await pd.getByTestId('fechar-pag-0-valor').fill((subtotalEsperado + 8).toFixed(2).replace('.', ','))
  await pd.getByTestId('fechar-confirmar').click()
  await pd.getByText('Inclui Taxa extra').first().waitFor({ timeout: 15000 }).catch(() => {})
  await foto(pd, 'pdv-04-resumo-fechada')
  const resumo = await pd.locator('body').innerText()
  ok('resumo do fechamento mostra a taxa incluída', /conta fechada/i.test(resumo) && /Inclui Taxa extra\s*R\$\s*8,00/.test(resumo))
  const f1 = await um(`select status, total_final, taxa_extra_valor, taxa_extra_nome from comandas where id=$1`, [b1.id])
  ok('conta fechada com a taxa no total final', f1.status === 'fechada' && Number(f1.total_final) === Math.round((subtotalEsperado + 8) * 100) / 100 && f1.taxa_extra_nome === 'Taxa extra', JSON.stringify(f1))
  const posF = await api(pd, `/api/admin/comandas/${b1.id}`, 'POST', { acao: 'taxa_extra', nome: 'Couvert', valor: 9 })
  ok('conta fechada: não aceita taxa', posF.status === 409 && /fechada/i.test(posF.json?.error ?? ''), `${posF.status} ${posF.json?.error ?? ''}`)

  // Outra conta: remover e validar antes de pagar.
  const b5 = await abrirBalcao('Remover Teste')
  await api(pd, `/api/admin/comandas/${b5.id}`, 'POST', { acao: 'taxa_extra', nome: 'Couvert', valor: 5 })
  const rem = await api(pd, `/api/admin/comandas/${b5.id}`, 'POST', { acao: 'taxa_extra', nome: 'Couvert', valor: 0 })
  const c2 = await conta(b5.id)
  ok('remover a taxa antes de pagar: total volta ao subtotal', rem.status === 200 && c2.taxaExtra === null && c2.totais.total === subtotalEsperado, JSON.stringify(c2.totais))
  const inval = await api(pd, `/api/admin/comandas/${b5.id}`, 'POST', { acao: 'taxa_extra', nome: '', valor: 5 })
  ok('taxa sem nome é recusada', inval.status === 400 && /nome/i.test(inval.json?.error ?? ''), inval.json?.error)
  const neg = await api(pd, `/api/admin/comandas/${b5.id}`, 'POST', { acao: 'taxa_extra', nome: 'Couvert', valor: -3 })
  ok('taxa negativa é recusada', neg.status === 400, neg.json?.error)

  const aud = await q(`select acao, usuario_nome, dados, criado_em from eventos_auditoria where entidade_id = any($1) and acao like 'conta.%taxa_extra' order by criado_em`, [[b1.id, b5.id]])
  ok('auditoria: adicionou, alterou e removeu, com quem, quando, nome e valor', aud.length === 4 &&
    aud[0].acao === 'conta.taxa_extra' && aud[0].dados.nome === 'Couvert' && Number(aud[0].dados.para) === 12.5 &&
    aud[1].dados.nome === 'Taxa extra' && Number(aud[1].dados.de) === 12.5 && Number(aud[1].dados.para) === 8 &&
    aud[3].acao === 'conta.removeu_taxa_extra' && Number(aud[3].dados.de) === 5 && aud.every((a) => a.usuario_nome && a.criado_em),
    aud.map((a) => `${a.acao}:${a.dados.nome}:${a.dados.de}->${a.dados.para} por ${a.usuario_nome}`).join(' | '))

  const g = await api(garcom.page, `/api/admin/comandas/${b1.id}`, 'POST', { acao: 'taxa_extra', nome: 'Couvert', valor: 5 })
  ok('garçom não aplica taxa (sem permissão)', g.status === 403 || g.status === 404, `${g.status} ${g.json?.error ?? ''}`)
  const v = await api(vizinhaDono.page, `/api/admin/comandas/${b1.id}`, 'POST', { acao: 'taxa_extra', nome: 'Couvert', valor: 5 })
  ok('loja vizinha não acessa a conta (nem a taxa)', v.status === 404 || v.status === 403, `${v.status} ${v.json?.error ?? ''}`)
  const vRpc = await db.query(`select comanda_taxa_extra_definir($1,$2,'Couvert',5,null,'x')`, [vizinha, b1.id]).then(() => 'aceitou', (e) => e.message)
  ok('banco recusa taxa de outra loja', vRpc === 'comanda_inexistente', vRpc)

  // Conta cancelada: a taxa acompanha; nada mais muda.
  const b2 = await abrirBalcao('Cancelar Teste')
  await api(pd, `/api/admin/comandas/${b2.id}`, 'POST', { acao: 'taxa_extra', nome: 'Couvert', valor: 7 })
  const canc = await api(pd, `/api/admin/comandas/${b2.id}`, 'POST', { acao: 'cancelar_conta', motivo: 'teste da taxa manual' })
  const rowC = await um(`select status, taxa_extra_valor, taxa_extra_nome from comandas where id=$1`, [b2.id])
  ok('conta cancelada leva a taxa junto (fica registrada na conta cancelada)', canc.status === 200 && rowC.status === 'cancelada' && Number(rowC.taxa_extra_valor) === 7, JSON.stringify(rowC))
  const posC = await api(pd, `/api/admin/comandas/${b2.id}`, 'POST', { acao: 'taxa_extra', nome: 'Couvert', valor: 9 })
  ok('conta cancelada: não aceita taxa', posC.status === 409, `${posC.status} ${posC.json?.error ?? ''}`)

  // Taxa > 0 e já pago acima do novo total: recusa em vez de deixar a conta "pagando a mais".
  const b4 = await abrirBalcao('Pago Teste')
  await api(pd, `/api/admin/comandas/${b4.id}`, 'POST', { acao: 'taxa_extra', nome: 'Couvert', valor: 10 })
  const c4 = await conta(b4.id)
  const pag = await api(pd, `/api/admin/comandas/${b4.id}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: c4.totais.total, chave: uuid() })
  const baixar = await api(pd, `/api/admin/comandas/${b4.id}`, 'POST', { acao: 'taxa_extra', nome: 'Couvert', valor: 0 })
  ok('pago com a taxa: tirar a taxa depois é recusado (pago passaria do total)', pag.status === 200 && baixar.status === 409, `${pag.status}/${baixar.status} ${baixar.json?.error ?? ''}`)

  // ════════════════════════════════════════════════════════════════════════════
  secao('Taxa manual em Mesas e Comandas')
  await api(pd, `/api/admin/mesas/${MESA.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'Cliente Mesa', chave: uuid() })
  const lm = await api(pd, '/api/admin/pdv/lancamento', 'POST', { pagamento: { escolha: 'dinheiro' }, mesaId: MESA.id, chave: uuid(), itens: [{ itemId: FILE.id, quantidade: 1, complementos: [] }] })
  const cm = await um(`select id from comandas where mesa_id=$1 and status='aberta'`, [MESA.id])
  ok('conta da mesa aberta pelo lançamento', lm.status < 300 && !!cm, `${lm.status} ${lm.json?.error ?? ''}`)
  await pd.goto(`${BASE}/admin/mesas/${MESA.id}`, { waitUntil: 'networkidle' })
  await pd.getByRole('tab', { name: 'Conta' }).click()
  await pd.getByTestId('mesa-adicionar-taxa').waitFor({ timeout: 15000 })
  await pd.getByTestId('mesa-adicionar-taxa').click()
  await pd.getByTestId('taxas-modal').waitFor()
  await pd.getByTestId('taxa-adicionar').click()
  await pd.getByTestId('taxa-nome').last().fill('Couvert artístico')
  await pd.getByTestId('taxa-tipo-fixo').last().click()
  await pd.getByTestId('taxa-base').last().fill('15')
  await pd.getByTestId('taxas-salvar').click()
  await pd.getByTestId('taxas-modal').waitFor({ state: 'detached', timeout: 10000 })
  await pd.getByText('Couvert artístico').first().waitFor({ timeout: 10000 })
  await foto(pd, 'mesa-01-conta-com-taxa')
  const tot = await um(`select t.* from comanda_totais($1) t`, [cm.id])
  ok('mesa: taxa no total da conta', Number(tot.total) === Math.round((Number(FILE.preco) * 1.1 + 15) * 100) / 100 || Number(tot.total) === Math.round((Number(FILE.preco) + Number(tot.taxa_servico) + 15) * 100) / 100, JSON.stringify(tot))
  ok('mesa: botão mostra "Alterar taxas (Couvert artístico)"', (await pd.getByTestId('mesa-adicionar-taxa').innerText()).includes('Couvert artístico'))

  // Pré-conta com a taxa: impressora de Caixa do Beta no banco local (virtual PDF).
  const credCaixa = `mza_ag_${randomBytes(24).toString('hex')}`
  const agC = (await um(`insert into impressao_agentes (restaurante_id, nome, credencial_hash, versao, visto_em) values ($1,'PC-E2E',$2,'0.2.0-beta.2', now()) returning id`, [L, sha(credCaixa)])).id
  const dispPdf = (await um(`insert into impressao_dispositivos (restaurante_id, agente_id, nome_sistema, largura_mm) values ($1,$2,'Microsoft Print to PDF',80) returning id`, [L, agC])).id
  const dispTermica = (await um(`insert into impressao_dispositivos (restaurante_id, agente_id, nome_sistema, largura_mm) values ($1,$2,'POS-80 E2E',80) returning id`, [L, agC])).id
  await db.query(`insert into impressao_funcoes (restaurante_id, funcao, dispositivo_id) values ($1,'caixa',$2)`, [L, dispPdf])
  await db.query(`update restaurantes set impressao_beta_modo='caixa' where id=$1`, [L])
  const pc = await api(pd, `/api/admin/comandas/${cm.id}/pre-conta`, 'POST', { chave: uuid(), reimpressao: false })
  const tPc = await um(`select snapshot, dispositivo_id from impressao_trabalhos where comanda_id=$1 and tipo='pre_conta' order by criado_em desc limit 1`, [cm.id])
  ok('pré-conta (Somente Caixa) vai para a fila do Beta, na impressora virtual', pc.status < 300 && tPc?.dispositivo_id === dispPdf, `${pc.status} ${pc.json?.error ?? ''}`)
  ok('snapshot da pré-conta traz a taxa manual, a mesa e o número do pedido', Number(tPc?.snapshot.taxa_extra) === 15 && tPc?.snapshot.taxa_extra_nome === 'Couvert artístico' && !!tPc?.snapshot.pedido_numero && tPc?.snapshot.mesa === MESA.nome,
    JSON.stringify({ taxa: tPc?.snapshot.taxa_extra, nome: tPc?.snapshot.taxa_extra_nome, mesa: tPc?.snapshot.mesa, n: tPc?.snapshot.pedido_numero }))
  const rPc = await renderizarBeta(tPc.snapshot, { saida: join(SHOTS, 'beta-preconta-mesa-com-taxa.png') })
  ok('pré-conta desenhada: linha "Couvert artístico" e o TOTAL', /Couvert artístico\s+R\$ 15,00/.test(rPc.texto) && !!rPc.total?.valor && rPc.largura === 576, rPc.total?.valor)

  // ════════════════════════════════════════════════════════════════════════════
  secao('Instagram da loja (Ajustes › Perfil da loja)')
  await pd.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' })
  const campoIg = pd.getByTestId('loja-instagram')
  await campoIg.waitFor({ timeout: 15000 })
  // Loja de teste sem telefone/logo: o painel abre o aviso de pendências por cima.
  await pd.waitForTimeout(1200)
  const entendi = pd.getByRole('button', { name: /ok, entendi/i })
  if (await entendi.isVisible().catch(() => false)) await entendi.click()
  await campoIg.fill('https://facebook.com/menuzia')
  await pd.locator('button:visible', { hasText: /salvar altera/i }).first().click()
  await esperar(1200)
  ok('link que não é do Instagram é recusado na tela e não salva', (await um(`select instagram_url from restaurantes where id=$1`, [L])).instagram_url === null &&
    (await pd.getByText(/instagram\.com/i).count()) > 0)
  await campoIg.fill('@menuzia.teste')
  await pd.locator('button:visible', { hasText: /salvar altera/i }).first().click()
  await esperar(2000)
  const igSalvo = (await um(`select instagram_url from restaurantes where id=$1`, [L])).instagram_url
  ok('"@usuario" é normalizado e salvo como URL', igSalvo === 'https://instagram.com/menuzia.teste', igSalvo)
  await foto(pd, 'ajustes-instagram')
  const bancoRecusa = await db.query(`update restaurantes set instagram_url='https://evil.com/x' where id=$1`, [L]).then(() => 'aceitou', (e) => e.message)
  ok('banco recusa link inválido mesmo sem passar pela tela', /restaurantes_instagram_url_check/.test(bancoRecusa), bancoRecusa)

  // ════════════════════════════════════════════════════════════════════════════
  secao('Comanda da cozinha pelo Beta: modelo, QR do Instagram e fallback')
  const t1 = await api(pd, `/api/admin/impressao/dispositivos/${dispTermica}`, 'POST', { acao: 'cozinha_teste', chave: uuid() })
  const snapT = (await um(`select snapshot from impressao_trabalhos where dispositivo_id=$1 and snapshot->>'cozinha_teste'='true' order by criado_em desc limit 1`, [dispTermica]))?.snapshot
  const esperado = QRCode.create('https://instagram.com/menuzia.teste', { errorCorrectionLevel: 'H' })
  const linhasEsperadas = Array.from({ length: esperado.modules.size }, (_, y) => Array.from({ length: esperado.modules.size }, (_, x) => (esperado.modules.get(y, x) ? '1' : '0')).join(''))
  ok('Testar Cozinha: trabalho de teste, sem pedido', t1.status < 300 && !!snapT && snapT.pedido?.id === 'teste', `${t1.status}`)
  ok('QR = Instagram da loja (matriz idêntica à do link)', snapT?.qr?.origem === 'instagram' && snapT.qr.url === 'https://instagram.com/menuzia.teste' && JSON.stringify(snapT.qr.linhas) === JSON.stringify(linhasEsperadas))
  const rC = await renderizarCozinhaBeta(snapT.pedido, { config: {}, lojaNome: snapT.loja, extras: snapT.extras, qr: snapT.qr, teste: true }, { saida: join(SHOTS, 'beta-cozinha-teste-instagram.png') })
  ok('comanda de teste desenhada no modelo (TOTAL R$ 45,40, QR com ícone)', rC.total?.valor === 'R$ 45,40' && rC.doc.blocos.some((b) => (b.t === 'qr' && b.icone === 'instagram') || (b.t === 'rodape_loja' && b.qr?.icone === 'instagram')))

  await db.query(`update restaurantes set instagram_url=null where id=$1`, [L])
  await api(pd, `/api/admin/impressao/dispositivos/${dispTermica}`, 'POST', { acao: 'cozinha_teste', chave: uuid() })
  const snapF = (await um(`select snapshot from impressao_trabalhos where dispositivo_id=$1 and snapshot->>'cozinha_teste'='true' order by criado_em desc limit 1`, [dispTermica]))?.snapshot
  ok('sem Instagram: fallback = QR do cardápio da loja', snapF?.qr?.origem === 'cardapio' && snapF.qr.url === `https://app.menuzia.com.br/loja/${loja.slug}`, snapF?.qr?.url)
  await renderizarCozinhaBeta(snapF.pedido, { config: {}, lojaNome: snapF.loja, extras: snapF.extras, qr: snapF.qr, teste: true }, { saida: join(SHOTS, 'beta-cozinha-teste-cardapio.png') })
  await db.query(`update restaurantes set instagram_url='https://instagram.com/menuzia.teste' where id=$1`, [L])

  // ════════════════════════════════════════════════════════════════════════════
  secao('Roteamento: Somente teste / Somente Caixa / Cozinha e Caixa, sem duplicar')
  const fila = async (bearer) => {
    const r = await fetch(`${BASE}/api/agente/pedidos`, { headers: { Authorization: `Bearer ${bearer}`, 'X-Agente-Versao': '0.2.0-beta.2', 'X-Agente-Instancia': 'e2e-antigo-01' } })
    return { status: r.status, json: await r.json().catch(() => null) }
  }
  const pedidoDelivery = async () => {
    const b = await abrirBalcao('Cozinha Teste')
    return um(`select id, numero from pedidos where comanda_id=$1 order by criado_em limit 1`, [b.id])
  }
  // Somente teste: a cozinha é do Assistente antigo; o Beta não recebe nada.
  await db.query(`update restaurantes set impressao_beta_modo='teste', impressao_cozinha_por_funcao=false where id=$1`, [L])
  const pT = await pedidoDelivery()
  const betaT = await fila(credCaixa)
  const antT = await fila(tokenLegado)
  ok('Somente teste: Beta não recebe pedido real', (betaT.json?.pedidos ?? []).length === 0 && !betaT.json?.cozinhaBeta, `${betaT.status}`)
  ok('Somente teste: o Assistente antigo recebe a ficha (como sempre), sem os dados do Beta', (antT.json?.pedidos ?? []).some((p) => p.id === pT.id) && !antT.json?.cozinhaBeta)
  for (const p of antT.json?.pedidos ?? []) await fetch(`${BASE}/api/agente/pedidos/${p.id}/imprimir`, { method: 'POST', headers: { Authorization: `Bearer ${tokenLegado}` } })
  // Somente Caixa: pré-conta pelo Beta (acima), cozinha ainda no antigo.
  await db.query(`update restaurantes set impressao_beta_modo='caixa' where id=$1`, [L])
  const pC = await pedidoDelivery()
  const betaC = await fila(credCaixa)
  const antC = await fila(tokenLegado)
  ok('Somente Caixa: cozinha continua no antigo; Beta não recebe ficha', (betaC.json?.pedidos ?? []).length === 0 && (antC.json?.pedidos ?? []).some((p) => p.id === pC.id))
  for (const p of antC.json?.pedidos ?? []) await fetch(`${BASE}/api/agente/pedidos/${p.id}/imprimir`, { method: 'POST', headers: { Authorization: `Bearer ${tokenLegado}` } })
  // Cozinha e Caixa: a térmica do mesmo PC vira Cozinha; só o Beta recebe a ficha.
  await db.query(`insert into impressao_funcoes (restaurante_id, funcao, dispositivo_id) values ($1,'cozinha',$2) on conflict (restaurante_id, funcao) do update set dispositivo_id=excluded.dispositivo_id`, [L, dispTermica])
  await db.query(`update restaurantes set impressao_beta_modo='cozinha_caixa', impressao_cozinha_por_funcao=true, impressao_cozinha_transferida_em=now() - interval '1 second' where id=$1`, [L])
  await esperar(1500)
  const pK = await pedidoDelivery()
  const antK = await fila(tokenLegado)
  const betaK = await fila(credCaixa)
  const doBeta = (betaK.json?.pedidos ?? []).find((p) => p.id === pK.id)
  ok('Cozinha e Caixa: o Assistente antigo NÃO recebe a ficha (sem duplicar)', (antK.json?.pedidos ?? []).length === 0)
  ok('Cozinha e Caixa: o Beta recebe a ficha, com destino e dados do modelo', !!doBeta && betaK.json?.destinoCozinha?.nomeSistema === 'POS-80 E2E' && !!betaK.json?.cozinhaBeta?.extras?.[pK.id] && betaK.json?.cozinhaBeta?.qr?.origem === 'instagram')
  const rK = await renderizarCozinhaBeta(doBeta, { config: betaK.json.config, lojaNome: betaK.json.loja?.nome, extras: betaK.json.cozinhaBeta.extras[pK.id], qr: betaK.json.cozinhaBeta.qr }, { saida: join(SHOTS, 'beta-cozinha-real-balcao.png') })
  ok('ficha real desenhada no modelo (senha ao lado do número, itens, TOTAL)', /#\d+ \| SENHA \d+/.test(rK.texto) && rK.texto.includes('FILÉ À PARMEGIANA') && !!rK.total, rK.total?.valor)
  const reserva = await um(`select count(*)::int n from impressao_reservas where pedido_id=$1`, [pK.id])
  ok('pedido reservado uma única vez (só para o Beta)', reserva.n === 1, String(reserva.n))
  await fetch(`${BASE}/api/agente/pedidos/${pK.id}/imprimir`, { method: 'POST', headers: { Authorization: `Bearer ${credCaixa}` } })
  const antDepois = await fila(tokenLegado)
  ok('depois de impresso pelo Beta, o antigo continua sem recebê-lo', !(antDepois.json?.pedidos ?? []).some((p) => p.id === pK.id))

  // Mesa em Cozinha e Caixa: DADOS DA MESA, sem endereço.
  const lm2 = await api(pd, '/api/admin/pdv/lancamento', 'POST', { pagamento: { escolha: 'dinheiro' }, mesaId: MESA.id, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }] })
  const betaM = await fila(credCaixa)
  const pm = (betaM.json?.pedidos ?? []).find((p) => p.canal === 'mesa')
  const rM = pm ? await renderizarCozinhaBeta(pm, { config: betaM.json.config, lojaNome: betaM.json.loja?.nome, extras: betaM.json.cozinhaBeta.extras[pm.id], qr: betaM.json.cozinhaBeta.qr }, { saida: join(SHOTS, 'beta-cozinha-real-mesa.png') }) : null
  ok('ficha de mesa: MESA no topo, DADOS DA MESA com comanda e atendente, sem endereço', lm2.status < 300 && !!rM && rM.texto.includes('MESA 01') && !rM.texto.includes('MESA MESA') && rM.texto.includes('DADOS DA MESA') && /Comanda: \d+/.test(rM.texto) && !rM.texto.includes('Endere'), rM?.texto.split('\n').slice(-8).join(' | '))
  for (const p of betaM.json?.pedidos ?? []) await fetch(`${BASE}/api/agente/pedidos/${p.id}/imprimir`, { method: 'POST', headers: { Authorization: `Bearer ${credCaixa}` } })

  // ════════════════════════════════════════════════════════════════════════════
  secao('Pré-visualização (tela nova: janela "Ver comanda", mesmo desenho do Beta) e tamanho da letra')
  await db.query(`update impressao_dispositivos set tamanho_fonte='grande', largura_mm=80, largura_pontos=null where id=$1`, [dispTermica])
  const abrirImpressao = async () => {
    await pd.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
    await pd.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 3000 }).catch(() => {})
    await pd.getByTestId('card-modelos').waitFor({ timeout: 20000 })
  }
  // Abre "Ver <doc>", mede o desenho e fecha (Esc).
  const medirPrevia = async (doc = 'comanda') => {
    await pd.getByTestId(`ver-${doc}`).click()
    await pd.getByTestId('modal-previa').waitFor({ timeout: 10000 })
    const m = await pd.waitForFunction(() => { const c = document.querySelector('[data-testid="modal-previa-canvas"]'); return c && c.width >= 256 && c.height > 300 ? { w: c.width, h: c.height } : null }, null, { timeout: 20000 }).then((h) => h.jsonValue())
    const legivel = await pd.evaluate(() => { try { document.querySelector('[data-testid=modal-previa-canvas]').getContext('2d').getImageData(0, 0, 1, 1); return true } catch { return false } })
    const erro = await pd.getByTestId('modal-previa').getByText('Não foi possível desenhar').count()
    return { ...m, legivel, erro, fechar: async () => { await pd.keyboard.press('Escape'); await pd.waitForTimeout(300) } }
  }
  await abrirImpressao()
  const pv1 = await medirPrevia('comanda')
  ok('comanda desenhada na janela na largura da impressora da Cozinha (576 pontos)', pv1.w === 576 && pv1.h > 900, JSON.stringify({ w: pv1.w, h: pv1.h }))
  // Logo do Storage (outro domínio): sem CORS o canvas ficava "sujo".
  ok('prévia sem erro e com os pixels legíveis (logo de outro domínio com CORS)', pv1.erro === 0 && pv1.legivel)
  await foto(pd, 'previa-comanda-grande')
  await pv1.fechar()
  // A mesma comanda desenhada fora da página (render-ticket) tem a mesma medida: é o mesmo desenho.
  const { renderizarTicket } = await import('../impressao/render-ticket.mjs')
  // Mesmos dados de demonstração da janela (lib/impressao/demonstracao.mjs = os modelos v3).
  const { pedidoDemonstracao } = await import('../../lib/impressao/demonstracao.mjs')
  const { montarComandaV3 } = require('../../printer-agent/src/v3.js')
  const pv = (await api(pd, '/api/admin/impressao/previa')).json
  const cfgRow = await um(`select impressao_mostrar_numero_item a, impressao_mostrar_preco_complementos b, impressao_mostrar_nome_complementos c, impressao_fonte_maior_producao d, impressao_multiplicar_opcoes_qtd e, impressao_logo f from restaurantes where id=$1`, [L])
  const cfgLoja = { mostrarNumeroItem: cfgRow.a, mostrarPrecoComplementos: cfgRow.b, mostrarNomeComplementos: cfgRow.c, fonteMaiorProducao: cfgRow.d, multiplicarOpcoesQtd: cfgRow.e, imprimirLogo: cfgRow.f }
  let logoRef = null
  if (pv.logoUrl) { const r = await fetch(pv.logoUrl); logoRef = `data:${r.headers.get('content-type')};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}` }
  ok('rota da prévia traz nome/telefone/endereço da loja e o QR', typeof pv.loja?.nome === 'string' && pv.loja.nome.length > 0 && Array.isArray(pv.qr?.linhas), JSON.stringify(pv.loja))
  const dm = pedidoDemonstracao('entrega')
  const ref = await renderizarTicket(montarComandaV3(dm.pedido, { config: cfgLoja, lojaNome: pv.loja.nome, loja: pv.loja, extras: dm.extras, qr: pv.qr }), { larguraMm: 80, logo: logoRef, imprimirLogo: cfgLoja.imprimirLogo !== false, saida: join(SHOTS, 'previa-ref-cozinha.png') })
  ok('pré-visualização = impressão (mesma largura e altura do PNG do Beta)', ref.largura === pv1.w && ref.altura === pv1.h, `${ref.largura}x${ref.altura} vs ${pv1.w}x${pv1.h}`)
  // Opções da comanda (Configurações avançadas): gravam na chave de sempre e a janela já mostra.
  const antesFonte = cfgRow.d
  await pd.getByTestId('avancado-alternar').click()
  ok('Configurações avançadas: as 6 opções da comanda', (await pd.getByTestId('opcoes-impressao').getByRole('switch').count()) === 6)
  await pd.getByTestId('opcao-fonteMaiorProducao').click()
  let gravou = false
  for (let i = 0; i < 20 && !gravou; i++) {
    gravou = (await um('select impressao_fonte_maior_producao v from restaurantes where id=$1', [L]))?.v === !antesFonte
    if (!gravou) await pd.waitForTimeout(400)
  }
  const pvF = await medirPrevia('comanda')
  ok('"Letra maior nos itens": grava impressao_fonte_maior_producao e a janela muda', gravou && pvF.h !== pv1.h, `${pv1.h} → ${pvF.h}`)
  await pvF.fechar()
  await pd.getByTestId('opcao-fonteMaiorProducao').click()
  for (let i = 0; i < 20; i++) { if ((await um('select impressao_fonte_maior_producao v from restaurantes where id=$1', [L]))?.v === antesFonte) break; await pd.waitForTimeout(400) }
  // Letra da impressora (Calibrar e ajustar): grava a predefinição e o Beta recebe.
  await pd.getByTestId(`letra-${dispTermica}`).selectOption('pequena')
  let salva = false
  for (let i = 0; i < 20 && !salva; i++) {
    salva = (await um('select tamanho_fonte from impressao_dispositivos where id=$1', [dispTermica]))?.tamanho_fonte === 'pequena'
    if (!salva) await pd.waitForTimeout(500)
  }
  ok('letra pequena grava na predefinição da impressora', salva)
  await pd.waitForTimeout(5500) // a tela recarrega o painel a cada 5 s
  const pv2 = await medirPrevia('comanda')
  ok('letra pequena: a janela desenha menor', pv2.h < pv1.h, `${pv1.h} → ${pv2.h}`)
  await pv2.fechar()
  const betaP = await fila(credCaixa)
  ok('o Beta passa a receber a letra pequena da impressora da Cozinha', betaP.json?.destinoCozinha?.tamanhoFonte === 'pequena', betaP.json?.destinoCozinha?.tamanhoFonte)
  const pv3 = await medirPrevia('pre_conta')
  ok('"Ver pré-conta" desenha a pré-conta (impressora do Recibo/Extrato, 576 pontos)', pv3.w === 576 && pv3.h > 700, JSON.stringify({ w: pv3.w, h: pv3.h }))
  await foto(pd, 'previa-preconta')
  await pv3.fechar()
  await db.query(`update impressao_dispositivos set tamanho_fonte='grande' where id=$1`, [dispTermica])
} finally {
  await browser.close()
  await fecharRender()
  // Loja isolada de volta ao estado neutro: Somente teste, sem computador/funções, sem Instagram.
  await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza e2e modelos', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [L])
  for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes', 'impressao_reservas']) {
    await db.query(`delete from ${t} where restaurante_id=$1`, [L])
  }
  await db.query(`update restaurantes set impressao_beta_modo='teste', impressao_cozinha_por_funcao=false, impressao_cozinha_transferida_em=null, impressao_beta_liberado=false, impressao_agente_token=null, instagram_url=null where id=$1`, [L])
  await db.query('update pedidos set impresso=true, reimprimir=false where restaurante_id=$1 and criado_em >= $2', [L, inicio])
  await db.end()
}

const passou = res.filter(Boolean).length
console.log(`\n${passou === res.length ? '✅' : '❌'} ${passou}/${res.length} verificações passaram — capturas em ${SHOTS}`)
process.exit(passou === res.length ? 0 : 1)
