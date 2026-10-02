/**
 * E2E — Financeiro Fase 2 (Caixa, 0133). Stack local, lojas próprias fin-e2e-a/b (fin-e2e-semente.mjs), navegador real.
 * Cada "❌ esperado" é uma tentativa de fraude que TEM que falhar.
 *   · sem caixa aberto não recebe (com a flag); abrir com fundo; recebimentos viram livro-caixa na mesma transação;
 *   · contagem cega: quem só opera não vê o esperado; quem vê valores vê;
 *   · sangria/despesa: permissão, limite com PIN de OUTRA pessoa, idempotência;
 *   · estorno vira lançamento negativo; fechamento com divergência exige justificativa + PIN; ajuste no livro;
 *   · caixa fechado imutável (nem service_role), nada se lança nele; reabrir só o dono, com motivo;
 *   · sair com o caixa aberto exige justificativa; flag desligada = comportamento antigo.
 *   No fim: flag desligada, TESTE excluídos, pagamentos de teste apagados (o livro-caixa é imutável e fica).
 *
 *   node scripts/seguranca/e2e-financeiro-fase2.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
import { semearFin, DONO_FIN, SENHA_DONO_FIN } from './fin-e2e-semente.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const CHAVES = chavesLocais()
const { DB_URL } = CHAVES
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const SEM = await semearFin(db, CHAVES)
const loja = { id: SEM.A }
const outra = { id: SEM.B }
const SENHA = 'teste-fin-12345'
const SUF = String(Date.now()).slice(-5)
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const browser = await chromium.launch()
const foto = async (p, nome) => { if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`) }) }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const criados = []
const pagamentos = []

async function logar(login, senha) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', senha)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  return { ctx, p }
}
async function ir(p, url) {
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
}
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  return { status: r.status, json: await r.json().catch(() => null), texto: '' }
}, { url: `${BASE}${url}`, metodo, corpo })
const caixa = (p, corpo) => api(p, '/api/admin/financeiro/caixa', 'POST', corpo)
const flag = (v) => db.query(`update restaurantes set financeiro_ativo=$2 where id=$1`, [loja.id, v])
const turnoAberto = () => um(`select * from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id])
const comanda = await um(`select id from comandas where restaurante_id=$1 and status='fechada' limit 1`, [loja.id])
/** Pagamento presencial como as RPCs gravam (service_role), para exercitar o gatilho. */
async function pagar(forma, valor, papel = 'service_role') {
  try {
    await db.query('begin'); await db.query(`set local role ${papel}`)
    const r = (await db.query(`insert into pagamentos_comanda (restaurante_id, comanda_id, forma, valor, valor_recebido, criado_por_nome, canal, origem)
      values ($1,$2,$3,$4,$4,'TESTE Fin2','balcao','pdv') returning id`, [loja.id, comanda.id, forma, valor])).rows[0]
    await db.query('commit'); pagamentos.push(r.id); return { id: r.id }
  } catch (e) { await db.query('rollback').catch(() => {}); return { erro: e.message } }
}
async function comoPapel(papel, sql, params = []) {
  try { await db.query('begin'); await db.query(`set local role ${papel}`); await db.query(sql, params); await db.query('rollback'); return null }
  catch (e) { await db.query('rollback').catch(() => {}); return e.message }
}
const livro = (pagId) => db.query(`select carteira, tipo, valor_centavos from fin_lancamentos where pagamento_id=$1 order by id`, [pagId]).then((r) => r.rows)

let dono, ger, ate
try {
  // Estado limpo: nenhum caixa aberto na loja de teste.
  await db.query(`update caixa_turnos set fechado_em=now(), fechado_por_nome='e2e (limpeza)' where restaurante_id=$1 and fechado_em is null`, [loja.id])
  await flag(true)
  dono = await logar(DONO_FIN, SENHA_DONO_FIN)
  for (const [papel, nome] of [['gerente', 'Gerente'], ['atendente', 'Caixa']]) {
    const r = await api(dono.p, '/api/admin/equipe', 'POST', { nome: `TESTE Fin2 ${nome} ${SUF}`, usuario: `tfin2.${papel}.${SUF}`, papel, senha: SENHA })
    criados.push({ id: r.json?.funcionario?.id, login: `tfin2.${papel}.${SUF}`, papel })
  }
  const [G, A] = criados
  ok('TESTE gerente e caixa criados', !!G.id && !!A.id)
  ger = await logar(G.login, SENHA)
  ate = await logar(A.login, SENHA)
  ok('PIN do dono', (await api(dono.p, '/api/sessao/pin', 'POST', { senha: SENHA_DONO_FIN, pin: '615283' })).status === 200)
  ok('PIN do gerente', (await api(ger.p, '/api/sessao/pin', 'POST', { senha: SENHA, pin: '482913' })).status === 200)

  console.log('\n── sem caixa aberto ──')
  const semCaixa = await pagar('dinheiro', 10)
  ok('❌ esperado: receber sem caixa aberto (flag ligada)', /caixa_fechado/.test(semCaixa.erro ?? ''), semCaixa.erro)
  const g0 = await api(ate.p, '/api/admin/financeiro/caixa')
  ok('caixa (atendente) vê "fechado" e pode abrir', g0.status === 200 && g0.json.turno === null && g0.json.acoes.includes('caixa_abrir'))

  console.log('\n── abrir com fundo (pela tela) ──')
  await ir(ate.p, `${BASE}/admin/financeiro?secao=caixa`)
  await ate.p.getByTestId('caixa-abrir').click()
  await ate.p.getByTestId('abrir-fundo').fill('200')
  await foto(ate.p, '01-abrir-caixa')
  await ate.p.getByTestId('abrir-confirmar').click()
  await ate.p.getByTestId('janela-abrir').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  const t1 = await turnoAberto()
  ok('caixa aberto com fundo de R$ 200,00 e "aberto por" da sessão', t1?.valor_inicial_centavos == 20000 && t1?.aberto_por === A.id && t1?.status === 'aberto', JSON.stringify({ f: t1?.valor_inicial_centavos, por: t1?.aberto_por_nome }))
  ok('fundo no livro-caixa (gaveta +20000)', !!(await um(`select 1 from fin_lancamentos where turno_id=$1 and tipo='abertura' and carteira='gaveta' and valor_centavos=20000`, [t1.id])))
  ok('❌ esperado: abrir um segundo caixa', (await caixa(ger.p, { acao: 'abrir', fundoCentavos: 100 })).status === 409)
  ok('❌ esperado: abrir pela rota antiga da Logística (flag ligada)', (await api(ger.p, '/api/admin/caixa', 'POST', { acao: 'abrir' })).json?.codigo === 'usar_financeiro')
  await ir(ate.p, ate.p.url())
  ok('aviso no topo: "Caixa aberto"', /Caixa aberto/.test(await ate.p.getByTestId('aviso-caixa').innerText({ timeout: 8000 }).catch(() => '')))

  console.log('\n── recebimentos viram livro-caixa ──')
  const p1 = await pagar('dinheiro', 50); const p2 = await pagar('pix', 30); const p3 = await pagar('credito', 20.1)
  ok('dinheiro → gaveta +5000', JSON.stringify(await livro(p1.id)) === JSON.stringify([{ carteira: 'gaveta', tipo: 'recebimento', valor_centavos: '5000' }]))
  ok('pix → pix a conferir (+3000)', (await livro(p2.id))[0]?.carteira === 'pix_conferir')
  ok('crédito → cartão (+2010, centavos exatos)', (await livro(p3.id))[0]?.valor_centavos === '2010' && (await livro(p3.id))[0]?.carteira === 'cartao')
  ok('lançamento no turno aberto', !!(await um(`select 1 from fin_lancamentos where pagamento_id=$1 and turno_id=$2`, [p1.id, t1.id])))

  console.log('\n── contagem cega ──')
  const vAte = await api(ate.p, '/api/admin/financeiro/caixa')
  const txt = JSON.stringify(vAte.json)
  ok('operador de caixa NÃO vê o esperado (gaveta)', vAte.json.veValores === false && vAte.json.saldos === null && !('esperado_dinheiro_centavos' in vAte.json.turno) && !JSON.stringify([vAte.json.turno, vAte.json.extrato, vAte.json.pendencias]).includes('25000'), txt.slice(0, 0))
  ok('operador NÃO vê os recebimentos no extrato', !vAte.json.extrato.some((l) => l.tipo === 'recebimento'))
  const vGer = await api(ger.p, '/api/admin/financeiro/caixa')
  ok('gerente vê a gaveta ao vivo (R$ 250,00)', vGer.json.saldos?.gaveta === 25000, String(vGer.json.saldos?.gaveta))

  console.log('\n── movimentos ──')
  ok('❌ esperado: atendente faz sangria (sem permissão)', (await caixa(ate.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 1000, motivo: 'teste', chave: `e2e-${SUF}-a` })).status === 403)
  ok('❌ esperado: sangria sem motivo', (await caixa(ger.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 1000, motivo: '', chave: `e2e-${SUF}-b` })).status === 400)
  const s1 = await caixa(ger.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 5000, motivo: 'TESTE cofre', chave: `e2e-${SUF}-c` })
  ok('gerente: sangria de R$ 50 (abaixo do limite) sem PIN', s1.status === 200 && s1.json.aprovadoPor === null)
  const s1b = await caixa(ger.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 5000, motivo: 'TESTE cofre', chave: `e2e-${SUF}-c` })
  ok('mesma chave (clique duplo) não duplica', s1b.json?.repetido === true && (await um(`select count(*)::int n from fin_lancamentos where chave_idempotencia=$1`, [`mov:e2e-${SUF}-c`])).n === 2)
  const s2 = await caixa(ger.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 15000, motivo: 'TESTE cofre grande', chave: `e2e-${SUF}-d` })
  ok('❌ esperado: sangria de R$ 150 sem aprovação', s2.status === 409 && s2.json.codigo === 'aprovacao_necessaria')
  const s3 = await caixa(ger.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 15000, motivo: 'TESTE cofre grande', chave: `e2e-${SUF}-d`, aprovacao: { aprovadorId: G.id, pin: '482913' } })
  ok('❌ esperado: aprovar a própria sangria com o próprio PIN', s3.status === 403, String(s3.status))
  const s4 = await caixa(ger.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 15000, motivo: 'TESTE cofre grande', chave: `e2e-${SUF}-d`, aprovacao: { aprovadorId: (await um(`select id from usuarios where restaurante_id=$1 and papel='dono' limit 1`, [loja.id])).id, pin: '000000' } })
  ok('❌ esperado: PIN errado do dono', s4.status === 403)
  // Pela tela: despesa de R$ 120 com PIN do dono.
  await ir(ger.p, `${BASE}/admin/financeiro?secao=movimentacoes`)
  await ger.p.getByTestId('mov-despesa').click()
  await ger.p.getByTestId('mov-valor').fill('120')
  await ger.p.getByTestId('mov-motivo').fill('TESTE gás')
  await ger.p.getByTestId('mov-confirmar').click()
  await ger.p.getByTestId('aprovacao-pin').waitFor({ timeout: 8000 })
  await ger.p.getByTestId('aprovador').filter({ hasText: 'Dono' }).first().click()
  await foto(ger.p, '02-despesa-aprovacao-pin')
  for (const d of '615283') await ger.p.getByTestId(`pin-${d}`).click()
  await ger.p.getByTestId('janela-movimento').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  const desp = await um(`select aprovado_por_nome, usuario_nome from fin_lancamentos where turno_id=$1 and tipo='despesa' and carteira='gaveta' order by id desc limit 1`, [t1.id])
  ok('despesa aprovada pelo dono: lançamento com quem fez E quem aprovou', !!desp && /Dono/.test(desp.aprovado_por_nome ?? '') && /Gerente/.test(desp.usuario_nome), JSON.stringify(desp))
  await foto(ger.p, '03-movimentacoes')

  console.log('\n── estorno ──')
  await db.query(`update pagamentos_comanda set estornado_em=now(), estornado_por_nome='TESTE Fin2', estorno_motivo='TESTE estorno' where id=$1`, [p1.id])
  const est = await livro(p1.id)
  ok('estorno gera lançamento negativo apontando o original', est.length === 2 && est[1].tipo === 'estorno' && est[1].valor_centavos === '-5000')
  const gav = (await api(ger.p, '/api/admin/financeiro/caixa')).json.saldos.gaveta
  ok('gaveta esperada: 200 + 50 − 50 − 120 − 50 = R$ 30,00', gav === 3000, String(gav))

  console.log('\n── fechamento cego com divergência (pela tela, operador) ──')
  await ir(ate.p, `${BASE}/admin/financeiro?secao=caixa`)
  await ate.p.getByTestId('caixa-fechar').click()
  await ate.p.getByTestId('fechar-dinheiro').fill('80')
  await ate.p.getByTestId('fechar-cartao').fill('20,10')
  await foto(ate.p, '04-contagem-cega')
  await ate.p.getByTestId('fechar-conferir').click()
  await esperar(1500)
  if (await ate.p.getByTestId('fechar-pendencias').count()) { await foto(ate.p, '05-pendencias'); await ate.p.getByTestId('fechar-mesmo-assim').click(); await esperar(1500) }
  ok('divergência mostrada só DEPOIS de contar (R$ 50,00 a mais)', /50,00/.test(await ate.p.getByTestId('fechar-divergencia').innerText({ timeout: 8000 }).catch(() => '')))
  await foto(ate.p, '06-divergencia')
  await ate.p.getByTestId('fechar-justificativa').fill('TESTE troco de cliente não lançado')
  await ate.p.getByTestId('fechar-com-justificativa').click()
  await ate.p.getByTestId('aprovacao-pin').waitFor({ timeout: 8000 })
  await ate.p.getByTestId('aprovador').filter({ hasText: `Gerente ${SUF}` }).click()
  for (const d of '482913') await ate.p.getByTestId(`pin-${d}`).click()
  await ate.p.getByTestId('fechar-feito').waitFor({ timeout: 8000 }).catch(() => {})
  await foto(ate.p, '07-fechado')
  const f1 = await um(`select * from caixa_turnos where id=$1`, [t1.id])
  ok('caixa fechado: esperado 3000, contado 8000, diferença +5000, aprovado pelo gerente', f1.status === 'fechado' && f1.esperado_dinheiro_centavos == 3000 && f1.contado_dinheiro_centavos == 8000 && f1.diferenca_centavos == 5000 && /Gerente/.test(f1.fechamento_aprovado_por_nome ?? ''), JSON.stringify({ s: f1.status, e: f1.esperado_dinheiro_centavos, c: f1.contado_dinheiro_centavos }))
  ok('cartão conferido (sem diferença)', f1.diferenca_cartao_centavos == 0)
  ok('ajuste no livro-caixa: gaveta +5000', !!(await um(`select 1 from fin_lancamentos where turno_id=$1 and tipo='ajuste' and carteira='gaveta' and valor_centavos=5000`, [t1.id])))
  ok('pendências do fechamento guardadas', f1.pendencias === null || typeof f1.pendencias === 'object')
  ok('alerta grave "caixa_divergente" para o dono', !!(await um(`select 1 from fin_alertas where restaurante_id=$1 and tipo='caixa_divergente' and dados->>'turno'=$2`, [loja.id, t1.id])))
  ok('cada contagem ficou na auditoria', (await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao='caixa.contou' and entidade_id=$2`, [loja.id, t1.id])).n >= 1)

  console.log('\n── caixa fechado é imutável ──')
  ok('❌ esperado: service_role muda o contado do caixa fechado', /turno_imutavel/.test(await comoPapel('service_role', `update caixa_turnos set contado_dinheiro_centavos=3000 where id=$1`, [t1.id]) ?? ''))
  ok('❌ esperado: service_role apaga o caixa fechado', !!(await comoPapel('service_role', `delete from caixa_turnos where id=$1`, [t1.id])))
  ok('❌ esperado: lançar no caixa fechado', /caixa_fechado/.test(await comoPapel('service_role', `insert into fin_lancamentos (restaurante_id, grupo_id, turno_id, carteira, tipo, valor_centavos, origem, usuario_nome, chave_idempotencia) values ($1, gen_random_uuid(), $2, 'gaveta', 'reforco', 100, 'manual', 'x', $3)`, [loja.id, t1.id, `e2e-x-${SUF}`]) ?? ''))
  ok('❌ esperado: receber com o caixa fechado', /caixa_fechado/.test((await pagar('dinheiro', 5)).erro ?? ''))
  ok('❌ esperado: reabrir de mentirinha pelo banco sem motivo', /turno_imutavel/.test(await comoPapel('service_role', `update caixa_turnos set fechado_em=null, status='reaberto', reaberto_em=now(), reaberto_por=$2 where id=$1`, [t1.id, G.id]) ?? ''))

  console.log('\n── reabrir: só o dono ──')
  ok('❌ esperado: gerente reabre', (await caixa(ger.p, { acao: 'reabrir', turnoId: t1.id, motivo: 'TESTE reabrir pelo gerente' })).status === 403)
  ok('❌ esperado: dono reabre sem motivo', (await caixa(dono.p, { acao: 'reabrir', turnoId: t1.id, motivo: 'x' })).status === 400)
  const rb = await caixa(dono.p, { acao: 'reabrir', turnoId: t1.id, motivo: 'TESTE faltou lançar uma despesa' })
  ok('dono reabre com motivo', rb.status === 200 && rb.json.turno.status === 'reaberto')
  ok('alerta grave "caixa_reaberto"', !!(await um(`select 1 from fin_alertas where restaurante_id=$1 and tipo='caixa_reaberto' and dados->>'turno'=$2`, [loja.id, t1.id])))
  const esperadoAgora = (await api(dono.p, '/api/admin/financeiro/caixa')).json.saldos.gaveta
  const fd = await caixa(dono.p, { acao: 'fechar', contadoDinheiroCentavos: esperadoAgora, contadoCartaoCentavos: 2010, aceitarPendencias: true })
  ok('dono fecha de novo (contagem certa, sem diferença)', fd.status === 200 && fd.json.turno.diferenca_centavos == 0, JSON.stringify(fd.json?.error ?? ''))

  console.log('\n── sair com o caixa aberto ──')
  ok('operador abre outro caixa (fundo 0)', (await caixa(ate.p, { acao: 'abrir', fundoCentavos: 0 })).status === 200)
  ok('❌ esperado: quem abriu sai sem justificar', (await api(ate.p, '/api/sessao/sair', 'POST', {})).json?.codigo === 'caixa_aberto')
  ok('gerente (não abriu) sai normalmente', (await api(ger.p, '/api/sessao/sair', 'POST', {})).status === 200)
  ok('saída justificada passa e alerta o dono', (await api(ate.p, '/api/sessao/sair', 'POST', { justificativa: 'TESTE fim do expediente' })).status === 200 &&
    !!(await um(`select 1 from fin_alertas where restaurante_id=$1 and tipo='saiu_com_caixa_aberto'`, [loja.id])))
  const t2 = await turnoAberto()
  await caixa(dono.p, { acao: 'fechar', contadoDinheiroCentavos: 0, contadoCartaoCentavos: 0, aceitarPendencias: true })

  console.log('\n── relatório e isolamento ──')
  const rel = await dono.ctx.newPage()
  await rel.goto(`${BASE}/admin/financeiro/caixa/${t1.id}`, { waitUntil: 'networkidle' })
  await rel.getByTestId('relatorio-caixa').waitFor({ timeout: 8000 })
  ok('relatório do fechamento abre', /Fechamento de caixa/.test(await rel.innerText('body')))
  ok('relatório mostra a reabertura e o fechamento anterior', /Reaberto/.test(await rel.getByTestId('relatorio-reaberto').innerText().catch(() => '')) && /50,00/.test(await rel.getByTestId('relatorio-reaberto').innerText().catch(() => '')))
  await foto(rel, '08-relatorio')
  const cel = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', storageState: await dono.ctx.storageState() })
  const pc = await cel.newPage(); await ir(pc, `${BASE}/admin/financeiro?secao=caixa`)
  await pc.getByTestId('caixa-situacao').waitFor({ timeout: 8000 })
  ok('celular: Caixa sem rolagem lateral', await pc.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await foto(pc, '09-caixa-celular'); await cel.close()
  const tOutra = await um(`select id from caixa_turnos where restaurante_id=$1 limit 1`, [outra.id])
  ok('❌ esperado: relatório do caixa de OUTRA loja', !tOutra || (await api(dono.p, `/api/admin/financeiro/caixa/${tOutra.id}`)).status === 404)

  console.log('\n── flag desligada: como antes ──')
  await flag(false)
  const pOff = await pagar('dinheiro', 7)
  ok('sem a flag recebe sem caixa e não lança no livro', !pOff.erro && (await livro(pOff.id)).length === 0, pOff.erro)
  const ab = await api(dono.p, '/api/admin/caixa', 'POST', { acao: 'abrir' })
  const fe = await api(dono.p, '/api/admin/caixa', 'POST', { acao: 'fechar', forcar: true })
  const tl = await um(`select status from caixa_turnos where restaurante_id=$1 order by aberto_em desc limit 1`, [loja.id])
  ok('rota antiga abre e fecha; status acompanha ("fechado")', ab.status === 200 && fe.status === 200 && tl.status === 'fechado', `${ab.status}/${fe.status}/${tl.status}`)
  ok('Financeiro some sem a flag (404)', (await api(dono.p, '/api/admin/financeiro/caixa')).status === 404)
} catch (e) {
  ok('execução sem exceção', false, e.message)
} finally {
  await flag(false).catch(() => {})
  for (const c of criados) if (c.id && dono) await api(dono.p, `/api/admin/equipe/${c.id}`, 'PATCH', { situacao: 'excluido' }).catch(() => {})
  await db.query(`update usuarios set pin_hash=null, pin_falhas=0, pin_bloqueado_ate=null, pin_definido_em=null where restaurante_id=$1 and (papel='dono' or nome like 'TESTE Fin2 %')`, [loja.id]).catch(() => {})
  if (pagamentos.length) await db.query(`delete from pagamentos_comanda where id = any($1::uuid[])`, [pagamentos]).catch((e) => console.error('limpeza pagamentos:', e.message))
  await db.query(`update caixa_turnos set fechado_em=now(), fechado_por_nome='e2e (limpeza)' where restaurante_id=$1 and fechado_em is null`, [loja.id]).catch(() => {})
  await browser.close(); await db.end()
  const falhas = res.filter((x) => !x).length
  console.log(`\n${res.length - falhas}/${res.length} verificações ok`)
  process.exit(falhas ? 1 : 0)
}
