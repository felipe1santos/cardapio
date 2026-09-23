/**
 * E2E do PDV v2 (balcão como comanda + mesa no mesmo motor), no navegador de verdade.
 *
 * Loja de demonstração local (`cantina-demo`), nenhum dado real. Liga `pdv_v2` SÓ nessa
 * loja local e desliga no fim. Tokens de impressão de teste são UUIDs aleatórios, nunca
 * impressos, e zerados no fim.
 *
 *   node scripts/seguranca/e2e-pdv-v2.mjs            (servidor em BASE, stack local)
 *   SHOTS=<pasta> node scripts/seguranca/e2e-pdv-v2.mjs   (salva screenshots)
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const SHOTS = process.env.SHOTS ?? null
const { DB_URL, API_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

execFileSync(process.execPath, ['scripts/seguranca/semear-demo-mesas.mjs'], { stdio: 'ignore' })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== '' && detalhe !== null ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const vizinha = (await um(`select id from restaurantes where slug='vizinha-demo'`)).id
const item = (nome) => um(`select id, nome, preco from itens_cardapio where restaurante_id=$1 and nome=$2`, [loja, nome])
const FILE = await item('Filé à Parmegiana')
const AGUA = await item('Água com Gás')
const SUCO = await item('Suco de Laranja')

// Estado limpo da loja de demonstração: nenhuma conta aberta de execuções anteriores.
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza e2e', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
await db.query(`update restaurantes set pdv_v2=false, impressao_automatica=true where id=$1`, [loja])
await db.query('delete from impressao_reservas where restaurante_id=$1', [loja])
const tokenImpressao = uuid()
await db.query('update restaurantes set impressao_agente_token=$2 where id=$1', [loja, tokenImpressao])

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
      try {
        json = await r.json()
      } catch {
        /* sem corpo */
      }
      return { status: r.status, json }
    },
    { url: `${BASE}${url}`, metodo, corpo },
  )
const foto = async (page, nome) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${nome}.png`), fullPage: false })
}
const errosConsole = []

// ════════════════════════════════════════════════════════════════════════════
secao('Flag desligada: PDV antigo intacto, v2 não existe')
const atendente = await logar('atendente.local')
const pa = atendente.page
pa.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errosConsole.push(m.text().slice(0, 160))
})
await pa.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
ok('card do balcão no modo antigo ("Venda rápida")', await pa.getByTestId('card-balcao').getByText('Venda rápida').isVisible())
await foto(pa, '01-pdv-antigo-flag-desligada')
ok('rota v2 da Central devolve 404 com a flag desligada', (await api(pa, '/api/admin/balcao/comandas')).status === 404)
ok('rota antiga "pagar" sem forma é recusada (não inventa dinheiro)', (await api(pa, `/api/admin/pdv/comanda/${uuid()}/pagar`, 'POST', {})).status === 400)
ok('telemetria da rota antiga registrada', !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='pdv_legado.pagar' and criado_em > now() - interval '1 minute'`, [loja])))

await db.query(`update restaurantes set pdv_v2=true where id=$1`, [loja])

// ════════════════════════════════════════════════════════════════════════════
secao('Balcão: três atendimentos simultâneos pela tela')
await pa.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
ok('card do balcão vira "Central de balcão"', await pa.getByTestId('card-balcao').getByText('Central de balcão').isVisible())
await foto(pa, '02-pdv-mesas-flag-ligada')
await pa.getByTestId('card-balcao').click()
await pa.getByTestId('balcao-novo').waitFor()
await foto(pa, '03-central-vazia')

const seqAntes = Number((await um('select balcao_seq from restaurantes where id=$1', [loja])).balcao_seq)
const clientes = [
  { nome: 'João Teste', tel: '', itens: [FILE, AGUA] },
  { nome: 'Ana Teste', tel: '27999990001', itens: [SUCO] },
  { nome: 'Pedro Teste', tel: '', itens: [AGUA] },
]
for (const [i, c] of clientes.entries()) {
  await pa.getByTestId('balcao-novo').click()
  await pa.getByTestId('balcao-nome').fill(c.nome)
  if (c.tel) await pa.getByTestId('balcao-telefone').fill(c.tel)
  if (i === 0) await foto(pa, '04-nova-comanda-balcao')
  await pa.getByTestId('balcao-abrir').click()
  await pa.getByTestId('pdv-lancar').waitFor()
  const alvo = await pa.getByTestId('pdv-alvo').innerText()
  ok(`${c.nome}: cardápio aberto na comanda certa`, alvo.includes(`Senha ${seqAntes + i + 1}`) && alvo.includes(c.nome), alvo)
  for (const it of c.itens) await pa.getByRole('button', { name: new RegExp(it.nome) }).first().click()
  if (i === 0) await foto(pa, '05-lancamento-balcao')
  await pa.getByTestId('pdv-lancar').click()
  await pa.getByText(/lançado em Balcão/).waitFor({ timeout: 15000 })
  await pa.getByRole('button', { name: 'Balcão', exact: true }).click()
  await pa.getByTestId('balcao-novo').waitFor()
}
await pa.getByTestId(`balcao-linha-${seqAntes + 3}`).waitFor()
await foto(pa, '06-central-tres-comandas')

const comandas = await q(`select id, senha, cliente_nome, cliente_telefone, taxa_servico_percentual from comandas where restaurante_id=$1 and tipo='balcao' and status='aberta' order by senha`, [loja])
ok('3 comandas de balcão abertas, senhas sequenciais', comandas.length === 3 && comandas.map((c) => c.senha).join(',') === [1, 2, 3].map((n) => seqAntes + n).join(','))
ok('telefone só na comanda, só dígitos', comandas[1].cliente_telefone === '27999990001')
ok('balcão sem taxa de serviço (loja tem 10%)', comandas.every((c) => Number(c.taxa_servico_percentual) === 0))
ok('nenhum cadastro em clientes criado pelo balcão', Number((await um(`select count(*) n from clientes where restaurante_id=$1 and telefone like '%999990001'`, [loja])).n) === 0)
const pedsBalcao = await q(`select p.canal, p.origem, p.mesa, p.atendimento_status, p.cliente_nome from pedidos p where p.comanda_id = any($1::uuid[])`, [comandas.map((c) => c.id)])
ok('pedidos: canal balcao, origem pdv, sem mesa, aguardando retirada', pedsBalcao.length === 3 && pedsBalcao.every((p) => p.canal === 'balcao' && p.origem === 'pdv' && p.mesa === null && p.atendimento_status === 'aguardando_retirada'))
const [cJoao, cAna, cPedro] = comandas

// ════════════════════════════════════════════════════════════════════════════
secao('Fila de impressão: balcão com senha, reserva')
const fila = async (instancia) => {
  const r = await fetch(`${BASE}/api/agente/pedidos`, { headers: { Authorization: `Bearer ${tokenImpressao}`, 'X-Agente-Instancia': instancia } })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const f1 = await fila('agente-e2e-1')
const doJoao = (f1.json?.pedidos ?? []).find((p) => p.clienteNome === 'João Teste')
ok('pedido do balcão chega ao Assistente com canal e senha', !!doJoao && doJoao.canal === 'balcao' && doJoao.senha === cJoao.senha, doJoao ? `canal ${doJoao.canal}, senha ${doJoao.senha}` : 'não veio')
ok('recibo do balcão recebe a mesma origem de sempre (pdv, sem mesa)', doJoao?.origem === 'pdv' && doJoao?.mesa === null)
const f2 = await fila('agente-e2e-2')
ok('segundo Assistente não recebe o que o primeiro reservou', !(f2.json?.pedidos ?? []).some((p) => p.id === doJoao?.id))
for (const p of f1.json?.pedidos ?? []) await fetch(`${BASE}/api/agente/pedidos/${p.id}/imprimir`, { method: 'POST', headers: { Authorization: `Bearer ${tokenImpressao}` } })
ok('confirmação marca impresso', (await um('select impresso from pedidos where id=$1', [doJoao.id])).impresso === true)

// ════════════════════════════════════════════════════════════════════════════
secao('Conta do João: pendências, estados separados, pagamento real, fechamento')
await pa.getByTestId(`balcao-linha-${cJoao.senha}`).click()
await pa.getByTestId('conta-titulo').getByText('João Teste').waitFor()
ok('cabeçalho: Balcão · Senha · Nome', (await pa.getByTestId('conta-titulo').innerText()).includes(`Senha ${cJoao.senha} · João Teste`))
ok('dimensões separadas visíveis', /Cozinha:.*aguardando/.test(await pa.getByTestId('conta-dimensoes').innerText()))
await foto(pa, '07-conta-balcao-aberta')
await pa.getByTestId('conta-fechar').click()
await pa.getByTestId('pendencias').waitFor()
const txtPend = await pa.getByTestId('pendencias').innerText()
ok('fechar bloqueado: pendência "Aguardando aceite" e financeiro "Não pago"', txtPend.includes('Aguardando aceite') && /Não pago|Atendido/.test(txtPend), txtPend.slice(0, 80))
await foto(pa, '08-pendencias-fechamento')
await pa.getByRole('button', { name: 'Voltar sem fechar' }).click()
await pa.getByRole('button', { name: 'Aceitar (preparar)' }).click()
await pa.getByRole('button', { name: 'Marcar pronto' }).waitFor()
await pa.getByRole('button', { name: 'Marcar pronto' }).click()
await pa.getByRole('button', { name: 'Entregue no balcão' }).waitFor()
await foto(pa, '09-pedido-pronto')
await pa.getByRole('button', { name: 'Entregue no balcão' }).click()
await pa.waitForFunction(() => document.querySelector('[data-testid="conta-dimensoes"]')?.textContent?.includes('Tudo entregue'))
const pedJoao = await um(`select status::text, atendimento_status, atendido_por_nome from pedidos where comanda_id=$1`, [cJoao.id])
ok('entregue no balcão: cozinha entregue + atendimento entregue_balcao + quem entregou', pedJoao.status === 'entregue' && pedJoao.atendimento_status === 'entregue_balcao' && pedJoao.atendido_por_nome === 'Atendente Demo')
const totalJoao = Number(FILE.preco) + Number(AGUA.preco)
await pa.getByTestId('conta-receber').click()
await pa.getByTestId('forma-dinheiro').click()
await pa.getByTestId('receber-recebido').fill('100,00')
ok('troco antecipado na tela', (await pa.getByTestId('receber-troco').innerText()).includes((100 - totalJoao).toFixed(2).replace('.', ',')))
await foto(pa, '10-receber-dinheiro-troco')
await pa.getByTestId('receber-registrar-fechar').click()
await pa.getByTestId('conta-titulo').waitFor({ state: 'detached', timeout: 15000 })
const cj = await um(`select status, total_final, fechada_por_nome from comandas where id=$1`, [cJoao.id])
const pgj = await um(`select forma, valor, valor_recebido, troco, canal, origem, criado_por_nome from pagamentos_comanda where comanda_id=$1`, [cJoao.id])
ok('conta fechada com total e autor', cj.status === 'fechada' && Number(cj.total_final) === totalJoao && cj.fechada_por_nome === 'Atendente Demo')
ok('pagamento real: dinheiro, recebido, troco do servidor, canal balcao, origem pdv', pgj.forma === 'dinheiro' && Number(pgj.valor_recebido) === 100 && Number(pgj.troco) === 100 - totalJoao && pgj.canal === 'balcao' && pgj.origem === 'pdv')
ok('atendimento concluído no fechamento', (await um(`select atendimento_status from pedidos where comanda_id=$1`, [cJoao.id])).atendimento_status === 'concluido')

// ════════════════════════════════════════════════════════════════════════════
secao('Cancelamento: atendente x gestão')
const pedPedro = await um(`select id, numero from pedidos where comanda_id=$1`, [cPedro.id])
await pa.getByTestId(`balcao-linha-${cPedro.senha}`).click()
await pa.getByRole('button', { name: 'Cancelar…' }).click()
await pa.getByTestId('cancelar-motivo').fill('Cliente desistiu')
await foto(pa, '11-cancelar-direto')
await pa.getByTestId('cancelar-confirmar').click()
await pa.getByTestId('conta-aviso').getByText(/cancelado/).waitFor()
ok('atendente cancelou direto pedido recebido sem pagamento', (await um('select status::text from pedidos where id=$1', [pedPedro.id])).status === 'cancelado')
ok('cancelado não será reimpresso', (await um('select reimprimir from pedidos where id=$1', [pedPedro.id])).reimprimir === false)
await pa.getByRole('button', { name: 'Fechar', exact: true }).click()

// Ana: pagamento parcial em duas formas, depois o atendente tenta cancelar
const contaAna = await api(pa, `/api/admin/comandas/${cAna.id}`)
const pedAna = contaAna.json.conta.pedidos[0]
const chavePix = uuid()
const p1 = await api(pa, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: 5, chave: chavePix })
const p1b = await api(pa, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: 5, chave: chavePix })
ok('clique duplo no pagamento (mesma chave) não cobra duas vezes', p1.status === 200 && p1b.json?.resultado?.idempotente === true)
ok('valor acima do restante é recusado com 409', (await api(pa, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'pagamento', forma: 'debito', valor: 999, chave: uuid() })).status === 409)
const canc = await api(pa, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'cancelar_pedido', pedidoId: pedAna.id, motivo: 'desistiu' })
ok('com pagamento na conta, atendente NÃO cancela direto (403 + orientação)', canc.status === 403 && canc.json?.codigo === 'cancelamento_requer_gestao', canc.json?.error)
ok('atendente não estorna', (await api(pa, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'estorno', pagamentoId: uuid(), motivo: 'x' })).status === 403)
ok('atendente não resolve à força', (await api(pa, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'resolver', acoes: [] })).status === 403)
const sol = await api(pa, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'solicitar_cancelamento', pedidoId: pedAna.id, motivo: 'Cliente mudou de ideia' })
ok('atendente pede o cancelamento à gerência', sol.status === 200)
const fAna = await api(pa, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'fechar' })
ok('fechar com cancelamento pendente: 409 com pendências detalhadas', fAna.status === 409 && fAna.json?.pendencias?.cancelamentos?.length === 1)

// ════════════════════════════════════════════════════════════════════════════
secao('Gerência: decisão, resolução forçada com efeito financeiro, reabertura')
const dono = await logar('dono.local')
const pd = dono.page
const contaAnaDono = (await api(pd, `/api/admin/comandas/${cAna.id}`)).json
ok('gerência vê o pedido de cancelamento na conta', contaAnaDono.conta.solicitacoes.length === 1 && contaAnaDono.permissoes.resolver === true)
await api(pd, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'decidir_cancelamento', solicitacaoId: contaAnaDono.conta.solicitacoes[0].id, aprovar: false, observacao: 'Suco já saiu' })
const semAjuste = await api(pd, `/api/admin/comandas/${cAna.id}`, 'POST', {
  acao: 'resolver', acoes: [{ pedido_id: pedAna.id, acao: 'cancelar_pedido' }], motivo: 'Cliente foi embora', confirmacao: true,
})
ok('cancelar valor já pago sem estorno: recusado com o excedente', semAjuste.status === 409 && semAjuste.json?.codigo === 'ajuste_financeiro_necessario', semAjuste.json?.error)
await pd.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
await pd.getByTestId('card-balcao').click()
await pd.getByTestId(`balcao-linha-${cAna.senha}`).click()
await pd.getByTestId('conta-titulo').getByText('Ana Teste').waitFor()
await pd.getByRole('button', { name: 'Pendências' }).click()
await pd.getByTestId('pendencias-resolver').click()
await pd.getByTestId(`resolver-${pedAna.numero}-forcar_atendido`).click()
await pd.getByTestId('resolver-motivo').fill('Cliente levou o suco antes do pronto')
await pd.getByTestId('resolver-confirmo').check()
await foto(pd, '12-resolucao-forcada')
await pd.getByTestId('resolver-aplicar-fechar').click()
await pd.getByTestId('conta-aviso').waitFor({ timeout: 15000 })
const pAnaDepois = await um('select status::text, atendimento_status, resolvido_forcado from pedidos where id=$1', [pedAna.id])
ok('forçado: entregue_balcao, marcado como resolvido à força', pAnaDepois.atendimento_status === 'entregue_balcao' && pAnaDepois.resolvido_forcado === true)
ok('conta segue aberta porque falta receber (resolução não é pagamento)', (await um('select status from comandas where id=$1', [cAna.id])).status === 'aberta')
ok('auditoria da resolução com motivo e papel', !!(await um(`select 1 from eventos_auditoria where acao='pedido.resolucao_forcada' and entidade_id=$1 and dados->>'papel'='dono'`, [pedAna.id])))
const restAna = (await api(pd, `/api/admin/comandas/${cAna.id}`)).json.conta.totais.restante
await api(pd, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'pagamento', forma: 'debito', valor: restAna, chave: uuid() })
const fechaAna = await api(pd, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'fechar' })
ok('pago em pix + débito, fecha', fechaAna.status === 200)
ok('duas formas registradas', (await q(`select distinct forma from pagamentos_comanda where comanda_id=$1 and estornado_em is null`, [cAna.id])).length === 2)
const re = await api(pd, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'reabrir', motivo: 'Fechou por engano, cliente voltou' })
ok('gerência reabre com motivo', re.status === 200 && (await um('select status, reaberta_por_nome from comandas where id=$1', [cAna.id])).status === 'aberta')
ok('atendente não reabre', (await api(pa, `/api/admin/comandas/${cJoao.id}`, 'POST', { acao: 'reabrir', motivo: 'tentativa indevida' })).status === 403)
const pagAna = (await api(pd, `/api/admin/comandas/${cAna.id}`)).json.conta.pagamentos.find((p) => p.forma === 'debito')
ok('estorno pela gerência com motivo', (await api(pd, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'estorno', pagamentoId: pagAna.id, motivo: 'Cartão recusado depois' })).status === 200)
await api(pd, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: pagAna.valor, chave: uuid() })
ok('recebe de novo e fecha', (await api(pd, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'fechar' })).status === 200)
await pd.getByRole('button', { name: 'Fechar', exact: true }).click().catch(() => {})

// ════════════════════════════════════════════════════════════════════════════
secao('Mesa pelo PDV v2 (mesmo motor)')
const mesaLivre = await um(
  `select m.id, m.nome from mesas m where m.restaurante_id=$1 and m.ativa and m.bloqueada_em is null
     and not exists (select 1 from comandas c where c.mesa_id=m.id and c.status='aberta') order by m.ordem limit 1`, [loja])
await pa.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
await pa.getByRole('button', { name: new RegExp(mesaLivre.nome) }).first().click()
await pa.getByTestId('pdv-lancar').waitFor()
await pa.getByRole('button', { name: new RegExp(FILE.nome) }).first().click()
await pa.getByTestId('pdv-lancar').click()
await pa.getByText(/lançado em/).waitFor({ timeout: 15000 })
await pa.getByRole('button', { name: new RegExp(SUCO.nome) }).first().click()
await pa.getByTestId('pdv-lancar').click()
await pa.waitForFunction(() => document.body.innerText.match(/Pedido #\d+ lançado/g)?.length)
await esperar(800)
const cm = await um(`select id, taxa_servico_percentual, tipo from comandas where mesa_id=$1 and status='aberta'`, [mesaLivre.id])
ok('mesa ganhou comanda no 1º lançamento, com taxa padrão 10%', !!cm && cm.tipo === 'mesa' && Number(cm.taxa_servico_percentual) === 10)
ok('dois lançamentos na mesma comanda', Number((await um('select count(*) n from pedidos where comanda_id=$1', [cm.id])).n) === 2)
await pa.getByTestId('pdv-ver-conta').click()
await pa.getByTestId('conta-titulo').getByText(mesaLivre.nome).waitFor()
await foto(pa, '13-conta-mesa')
for (let i = 0; i < 2; i++) {
  await pa.getByRole('button', { name: 'Aceitar (preparar)' }).first().click()
  await esperar(500)
}
for (let i = 0; i < 2; i++) {
  await pa.getByRole('button', { name: 'Marcar pronto' }).first().click()
  await esperar(500)
}
await pa.getByRole('button', { name: 'Servido' }).first().click()
await esperar(700)
const fMesa = await api(pa, `/api/admin/comandas/${cm.id}`, 'POST', { acao: 'fechar' })
ok('mesa com um pedido pronto e não servido não fecha', fMesa.status === 409 && fMesa.json?.pendencias?.pedidos?.some((p) => p.categoria === 'pronto_nao_atendido'))
await pa.getByRole('button', { name: 'Servido' }).first().click()
await esperar(700)
const contaMesa = (await api(pa, `/api/admin/comandas/${cm.id}`)).json.conta
const esperadoMesa = Math.round((Number(FILE.preco) + Number(SUCO.preco)) * 1.1 * 100) / 100
ok('total da mesa com 10% de serviço, do servidor', contaMesa.totais.total === esperadoMesa, `${contaMesa.totais.total} x ${esperadoMesa}`)
const metade = Math.round((esperadoMesa / 2) * 100) / 100
await api(pa, `/api/admin/comandas/${cm.id}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: metade, chave: uuid() })
// Dois caixas fechando juntos, depois de pagar o resto.
await api(pa, `/api/admin/comandas/${cm.id}`, 'POST', { acao: 'pagamento', forma: 'credito', valor: Math.round((esperadoMesa - metade) * 100) / 100, chave: uuid() })
const [fa, fb] = await Promise.all([
  api(pa, `/api/admin/comandas/${cm.id}`, 'POST', { acao: 'fechar' }),
  api(pd, `/api/admin/comandas/${cm.id}`, 'POST', { acao: 'fechar' }),
])
ok('dois caixas fechando a mesa ao mesmo tempo: um fecha, o outro recebe 409', [fa.status, fb.status].sort().join(',') === '200,409', `${fa.status},${fb.status}`)
ok('pagamentos da mesa com canal mesa, origem pdv', (await q(`select canal, origem from pagamentos_comanda where comanda_id=$1`, [cm.id])).every((p) => p.canal === 'mesa' && p.origem === 'pdv'))
await pa.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
ok('mesa volta a aparecer livre depois do fechamento', (await pa.getByRole('button', { name: new RegExp(mesaLivre.nome) }).first().innerText()).includes('Toque p/ abrir'))

// ════════════════════════════════════════════════════════════════════════════
secao('Tempo real: Central atualiza sem recarregar')
await pa.getByTestId('card-balcao').click()
await pa.getByTestId('balcao-novo').waitFor()
const nova = await api(pd, '/api/admin/balcao/comandas', 'POST', { nome: 'Realtime Teste', chave: uuid() })
const t0 = Date.now()
const apareceu = await pa.getByText('Realtime Teste').waitFor({ timeout: 15000 }).then(() => true, () => false)
ok('comanda aberta em outra tela aparece na Central sozinha', apareceu, `${Date.now() - t0} ms`)
await api(pd, `/api/admin/comandas/${nova.json.id}`, 'POST', { acao: 'fechar' })

// ════════════════════════════════════════════════════════════════════════════
secao('Isolamento, permissões e rotas antigas com a flag ligada')
const garcom = await logar('garcom.local')
ok('garçom não abre a Central de Balcão', [403, 307, 302].includes((await api(garcom.page, '/api/admin/balcao/comandas')).status))
await db.query('update restaurantes set pdv_v2=true where id=$1', [vizinha])
const viz = await logar('dono@vizinha.local')
ok('dono de outra loja não enxerga a conta desta loja (404)', (await api(viz.page, `/api/admin/comandas/${cAna.id}`)).status === 404)
ok('nem consegue pagar nela', (await api(viz.page, `/api/admin/comandas/${cAna.id}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: 1, chave: uuid() })).status === 404)
await db.query('update restaurantes set pdv_v2=false where id=$1', [vizinha])
const legado = await api(pa, '/api/admin/pdv/pedido', 'POST', { itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }] })
ok('rota antiga de lançamento responde 410 com a loja no v2', legado.status === 410)
ok('e a tentativa fica na telemetria', !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='pdv_legado.pedido' and dados->>'resultado'='recusado_pdv_v2'`, [loja])))
const corpoForjado = await api(pa, '/api/admin/pdv/lancamento', 'POST', {
  comandaId: (await api(pa, '/api/admin/balcao/comandas', 'POST', { nome: 'Forjado', chave: uuid() })).json.id,
  chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [], preco: 0.01 }], total: 0.01, canal: 'delivery', status: 'entregue', restauranteId: vizinha,
})
const pf = await um('select total, canal::text, status::text, restaurante_id from pedidos where id=$1', [corpoForjado.json?.id])
ok('campos forjados no corpo são ignorados (preço, canal, status, loja)', !!pf && Number(pf.total) === Number(AGUA.preco) && pf.canal === 'balcao' && pf.status === 'recebido' && pf.restaurante_id === loja)

// ════════════════════════════════════════════════════════════════════════════
secao('Kanban (visual congelado) com pedido de balcão')
await pa.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
await foto(pa, '14-kanban-com-balcao')
ok('Kanban carrega sem erro de console', errosConsole.length === 0, errosConsole.slice(0, 2).join(' | '))

// celular: Central no iframe de 390px (mesma origem, mesma sessão)
const mob = await logar('atendente.local', { width: 390, height: 844 })
await mob.page.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
await mob.page.getByTestId('card-balcao').click()
await mob.page.getByTestId('balcao-novo').waitFor()
await foto(mob.page, '15-central-celular')
const larg = await mob.page.evaluate(() => document.documentElement.scrollWidth)
ok('Central sem rolagem horizontal no celular', larg <= 390, `${larg}px`)

// ── limpeza ────────────────────────────────────────────────────────────────
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza e2e', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
await db.query(`update restaurantes set pdv_v2=false, impressao_agente_token=null where id=$1`, [loja])
await db.query('delete from impressao_reservas where restaurante_id=$1', [loja])
await browser.close()
await db.end()
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
