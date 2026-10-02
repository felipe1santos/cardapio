/**
 * E2E — Financeiro Fase 1 (Base, 0132). Stack local, lojas próprias fin-e2e-a/b (fin-e2e-semente.mjs).
 * Tabela de tentativas de fraude da fase: cada "❌ esperado" é uma tentativa que TEM que falhar.
 *   · flag desligada: módulo some (404, sem menu, sem trava, sem PIN por terminal);
 *   · PIN: exige senha, recusa PIN fraco, guarda só o hash; 5 erros bloqueiam + alerta;
 *   · tela travada: servidor recusa ações de dinheiro (423) até destravar com PIN;
 *   · troca de operador por PIN: só em terminal aberto com senha, só gente da loja;
 *   · login simultâneo gera alerta; login errado fica na auditoria;
 *   · bloquear funcionário derruba o login (ban + sessões encerradas) e reativar devolve;
 *   · ledger, aprovações e auditoria imutáveis até para o service_role; cadeia de hash acusa adulteração;
 *   · aprovação por quem pediu é recusada (banco); cancelamento autoaprovado é recusado com a flag;
 *   · isolamento: alerta de outra loja não é visto nem marcado; garçom não entra no financeiro.
 *   No fim: TESTE excluídos (desativados), flag desligada de novo, alertas TESTE apagados.
 *
 *   node scripts/seguranca/e2e-financeiro-fase1.mjs [pasta-de-prints]
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
const outraLoja = { id: SEM.B }
const SENHA = 'teste-fin-12345'
const SUF = String(Date.now()).slice(-5)
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const browser = await chromium.launch()
const foto = async (p, nome) => { if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`) }) }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const criados = []

async function logar(login, senha, ctx = null) {
  ctx = ctx ?? await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', senha)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 15000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  return { ctx, p }
}
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  return { status: r.status, json: await r.json().catch(() => null) }
}, { url: `${BASE}${url}`, metodo, corpo })
const menu = async (p) => (await p.locator('aside nav a').allInnerTexts()).map((t) => t.trim().split('\n')[0])
const eventos = (acao, desde) => um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao=$2 and criado_em >= $3`, [loja.id, acao, desde])
const flag = (v) => db.query(`update restaurantes set financeiro_ativo=$2 where id=$1`, [loja.id, v])
/** Roda SQL como outro papel do banco, dentro de transação desfeita. Devolve a mensagem de erro (ou null). */
async function comoPapel(papel, sql, params = []) {
  try {
    await db.query('begin'); await db.query(`set local role ${papel}`)
    await db.query(sql, params)
    await db.query('rollback'); return null
  } catch (e) { await db.query('rollback').catch(() => {}); return e.message }
}

const inicio = new Date().toISOString()
let dono, ger, ate, gar
try {
  await flag(false)
  dono = await logar(DONO_FIN, SENHA_DONO_FIN)
  const pd = dono.p

  console.log('\n── cadastro TESTE (gerente, atendente, garçom) ──')
  for (const [papel, nome] of [['gerente', 'Gerente'], ['atendente', 'Caixa'], ['garcom', 'Garçom']]) {
    const r = await api(pd, '/api/admin/equipe', 'POST', { nome: `TESTE Fin ${nome} ${SUF}`, usuario: `tfin.${papel}.${SUF}`, papel, senha: SENHA })
    ok(`criou ${papel} TESTE`, r.status === 201, String(r.status))
    criados.push({ id: r.json?.funcionario?.id, login: `tfin.${papel}.${SUF}`, papel })
  }
  const [G, A, W] = criados

  console.log('\n── flag DESLIGADA: tudo como antes ──')
  ok('GET /api/admin/financeiro → 404', (await api(pd, '/api/admin/financeiro')).status === 404)
  ok('estado: financeiroAtivo=false', (await api(pd, '/api/sessao/estado')).json?.financeiroAtivo === false)
  ok('menu sem "Financeiro"', !(await menu(pd)).includes('Financeiro'))
  ok('PIN por terminal recusado (403)', (await api(pd, '/api/sessao/pin-entrar')).status === 403)

  await flag(true)
  console.log('\n── flag LIGADA ──')
  await pd.reload({ waitUntil: 'networkidle' })
  ok('menu do dono com "Financeiro"', (await menu(pd)).includes('Financeiro'))
  ger = await logar(G.login, SENHA)
  ate = await logar(A.login, SENHA)
  gar = await logar(W.login, SENHA)
  ok('gerente vê "Financeiro" no menu', (await menu(ger.p)).includes('Financeiro'))
  ok('garçom NÃO vê "Financeiro"', !(await menu(gar.p)).includes('Financeiro'))
  const rg = await api(gar.p, '/api/admin/financeiro/auditoria')
  ok('❌ esperado: garçom chama a API da auditoria', rg.status === 403, String(rg.status))
  const ra = await api(ate.p, '/api/admin/financeiro/auditoria')
  ok('❌ esperado: atendente (caixa) lê a auditoria', ra.status === 403, String(ra.status))
  ok('gerente lê a auditoria', (await api(ger.p, '/api/admin/financeiro/auditoria')).status === 200)

  console.log('\n── PIN pessoal ──')
  ok('❌ esperado: definir PIN com senha errada', (await api(ger.p, '/api/sessao/pin', 'POST', { senha: 'errada-123', pin: '482913' })).status === 403)
  ok('❌ esperado: PIN fraco (123456)', (await api(ger.p, '/api/sessao/pin', 'POST', { senha: SENHA, pin: '123456' })).status === 400)
  ok('❌ esperado: PIN de 4 dígitos', (await api(ger.p, '/api/sessao/pin', 'POST', { senha: SENHA, pin: '4829' })).status === 400)
  // Pela tela: menu de conta → Criar meu PIN.
  await ger.p.getByLabel('Minha conta').click()
  await ger.p.getByTestId('menu-meu-pin').click()
  await ger.p.getByTestId('meu-pin-senha').fill(SENHA)
  await ger.p.getByTestId('meu-pin-novo').fill('482913')
  await ger.p.getByTestId('meu-pin-conf').fill('482913')
  await foto(ger.p, '01-meu-pin')
  await ger.p.getByTestId('meu-pin-salvar').click()
  ok('PIN salvo pela tela', await ger.p.getByTestId('pin-salvo').waitFor({ timeout: 8000 }).then(() => true, () => false))
  await ger.p.keyboard.press('Escape'); await ger.p.mouse.click(5, 5)
  const h = await um(`select pin_hash from usuarios where id=$1`, [G.id])
  ok('banco guarda só o hash bcrypt (nunca o PIN)', /^\$2[aby]\$/.test(h.pin_hash ?? '') && !String(h.pin_hash).includes('482913'))
  ok('atendente cria PIN pela API', (await api(ate.p, '/api/sessao/pin', 'POST', { senha: SENHA, pin: '739164' })).status === 200)
  ok('dono cria PIN', (await api(pd, '/api/sessao/pin', 'POST', { senha: SENHA_DONO_FIN, pin: '615283' })).status === 200)

  console.log('\n── tela travada ──')
  await ger.p.reload({ waitUntil: 'networkidle' })
  await ger.p.getByLabel('Minha conta').click()
  await ger.p.getByTestId('menu-bloquear').click()
  await ger.p.getByTestId('tela-travada').waitFor({ timeout: 5000 })
  await foto(ger.p, '02-tela-travada')
  ok('estado: travada=true', (await api(ger.p, '/api/sessao/estado')).json?.travada === true)
  const r423 = await api(ger.p, '/api/admin/financeiro/auditoria')
  ok('❌ esperado: ação de dinheiro com a tela travada (tirando a sobreposição pelo DevTools)', r423.status === 423, String(r423.status))
  await ger.p.reload({ waitUntil: 'networkidle' })
  ok('recarregar a página NÃO destrava', await ger.p.getByTestId('tela-travada').waitFor({ timeout: 8000 }).then(() => true, () => false))
  ok('o painel por baixo continua no ar (sessão viva)', (await api(ger.p, '/api/sessao/estado')).status === 200)
  for (const d of '111111') await ger.p.getByTestId(`pin-${d}`).click()
  ok('❌ esperado: PIN errado destrava', await ger.p.getByTestId('pin-erro').waitFor({ timeout: 8000 }).then(() => true, () => false))
  for (const d of '482913') await ger.p.getByTestId(`pin-${d}`).click()
  await ger.p.getByTestId('tela-travada').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  ok('PIN certo destrava', (await ger.p.getByTestId('tela-travada').count()) === 0)
  ok('ação de dinheiro volta a funcionar', (await api(ger.p, '/api/admin/financeiro/auditoria')).status === 200)

  console.log('\n── troca de operador ──')
  await ger.p.getByLabel('Minha conta').click()
  await ger.p.getByTestId('menu-trocar-operador').click()
  await ger.p.getByTestId('tela-travada').waitFor()
  await ger.p.getByTestId('operador').first().waitFor({ timeout: 5000 })
  await foto(ger.p, '03-trocar-operador')
  const nomes = await ger.p.getByTestId('operador').allInnerTexts()
  ok('lista só gente da loja com PIN', nomes.some((n) => n.includes(`Caixa ${SUF}`)) && !nomes.some((n) => n.includes(`Garçom ${SUF}`)), nomes.join(', '))
  const outroUsu = await um(`select id from usuarios where restaurante_id<>$1 limit 1`, [loja.id])
  const rx = await api(ger.p, '/api/sessao/pin-entrar', 'POST', { usuarioId: outroUsu.id, pin: '000000' })
  ok('❌ esperado: entrar como funcionário de OUTRA loja', rx.status === 404, String(rx.status))
  await ger.p.getByTestId('operador').filter({ hasText: `Caixa ${SUF}` }).click()
  await Promise.all([ger.p.waitForLoadState('load'), (async () => { for (const d of '739164') await ger.p.getByTestId(`pin-${d}`).click() })()])
  await esperar(1500)
  const est = await api(ger.p, '/api/sessao/estado')
  ok('terminal agora é do atendente', est.json?.nome === `TESTE Fin Caixa ${SUF}`, est.json?.nome)
  const sesG = await um(`select motivo_encerramento from usuarios_sessoes where usuario_id=$1 and encerrada_em is not null order by encerrada_em desc limit 1`, [G.id])
  ok('sessão do gerente encerrada como "troca_operador"', sesG?.motivo_encerramento === 'troca_operador')
  ok('auditoria: entrou_por_pin', (await eventos('sessao.entrou_por_pin', inicio)).n >= 1)
  const novo = await browser.newContext()
  const pn = await novo.newPage(); await pn.goto(`${BASE}/login`)
  const rsem = await api(pn, '/api/sessao/pin-entrar', 'POST', { usuarioId: A.id, pin: '739164' })
  ok('❌ esperado: PIN num aparelho que ninguém abriu com senha', rsem.status === 403, String(rsem.status))
  await novo.close()

  console.log('\n── PIN: 5 erros bloqueiam ──')
  let ultimo = 0
  for (let i = 0; i < 5; i++) ultimo = (await api(ger.p, '/api/sessao/desbloquear', 'POST', { pin: '999999' })).status
  ok('5º erro bloqueia (423)', ultimo === 423, String(ultimo))
  ok('❌ esperado: PIN certo durante o bloqueio', (await api(ger.p, '/api/sessao/desbloquear', 'POST', { pin: '739164' })).status === 423)
  ok('alerta "pin_bloqueado" para o dono', !!(await um(`select 1 from fin_alertas where restaurante_id=$1 and tipo='pin_bloqueado' and criado_em >= $2`, [loja.id, inicio])))
  ok('dono apaga o PIN (Equipe)', (await api(pd, `/api/admin/equipe/${A.id}/pin`, 'DELETE')).status === 200)
  ok('PIN apagado no banco e desbloqueado', !!(await um(`select 1 from usuarios where id=$1 and pin_hash is null and pin_bloqueado_ate is null`, [A.id])))
  ok('❌ esperado: gerente apaga o PIN do dono', (await api(ger.p, `/api/admin/equipe/${(await um(`select id from usuarios where restaurante_id=$1 and papel='dono' limit 1`, [loja.id])).id}/pin`, 'DELETE')).status >= 401)

  console.log('\n── login simultâneo e login errado ──')
  const g2 = await logar(G.login, SENHA)
  const g3 = await logar(G.login, SENHA)
  await api(g2.p, '/api/sessao/ping', 'POST'); await api(g3.p, '/api/sessao/ping', 'POST')
  ok('alerta "login_simultaneo"', !!(await um(`select 1 from fin_alertas where restaurante_id=$1 and tipo='login_simultaneo' and criado_em >= $2`, [loja.id, inicio])))
  const ruim = await browser.newContext(); const pr = await ruim.newPage()
  await pr.goto(`${BASE}/login`, { waitUntil: 'networkidle' }); await pr.fill('input[name="email"]', G.login); await pr.fill('input[name="password"]', 'senha-errada-9'); await pr.click('button[type="submit"]'); await esperar(1500)
  ok('login com senha errada vai para a auditoria', (await eventos('sessao.login_falhou', inicio)).n >= 1)
  await ruim.close()

  console.log('\n── bloquear derruba o login ──')
  const rb = await api(pd, `/api/admin/equipe/${G.id}`, 'PATCH', { situacao: 'bloqueado' })
  ok('dono bloqueia o gerente', rb.status === 200, String(rb.status))
  const rgb = await api(g2.p, '/api/admin/financeiro/auditoria')
  ok('❌ esperado: gerente bloqueado continua usando o terminal aberto', rgb.status === 401 || rgb.status === 403, String(rgb.status))
  ok('sessões do gerente encerradas', !(await um(`select 1 from usuarios_sessoes where usuario_id=$1 and encerrada_em is null`, [G.id])))
  const banido = await um(`select banned_until from auth.users where id=$1`, [G.id])
  ok('login banido no Auth', !!banido?.banned_until && new Date(banido.banned_until) > new Date())
  const gx = await logar(G.login, SENHA)
  ok('❌ esperado: gerente bloqueado entra com senha', !gx.p.url().includes('/admin'), gx.p.url())
  await gx.ctx.close()
  await api(pd, `/api/admin/equipe/${G.id}`, 'PATCH', { situacao: 'ativo' })
  ok('reativar devolve o login', !(await um(`select banned_until from auth.users where id=$1 and banned_until > now()`, [G.id])))
  const gy = await logar(G.login, SENHA)
  ok('gerente reativado entra de novo', gy.p.url().includes('/admin'))
  await gy.ctx.close(); await g2.ctx.close(); await g3.ctx.close()

  console.log('\n── ledger, aprovações e auditoria imutáveis ──')
  const lanc = await um(`insert into fin_lancamentos (restaurante_id, grupo_id, carteira, tipo, valor_centavos, forma, origem, usuario_nome, chave_idempotencia, motivo)
    values ($1, gen_random_uuid(), 'gaveta', 'reforco', 5000, 'dinheiro', 'manual', 'TESTE e2e', $2, 'TESTE e2e fase 1') returning id, hash, valor_centavos`, [loja.id, `teste-e2e-${SUF}`])
  ok('lançamento recebe hash', /^[0-9a-f]{64}$/.test(lanc.hash ?? ''))
  ok('❌ esperado: service_role altera lançamento', !!(await comoPapel('service_role', `update fin_lancamentos set valor_centavos=1 where id=$1`, [lanc.id])))
  ok('❌ esperado: service_role apaga lançamento', !!(await comoPapel('service_role', `delete from fin_lancamentos where id=$1`, [lanc.id])))
  ok('❌ esperado: authenticated insere lançamento', !!(await comoPapel('authenticated', `insert into fin_lancamentos (restaurante_id, grupo_id, carteira, tipo, valor_centavos, origem, usuario_nome, chave_idempotencia) values ($1, gen_random_uuid(), 'gaveta', 'reforco', 1, 'manual', 'x', 'xxxxxxxxxx')`, [loja.id])))
  ok('❌ esperado: service_role altera auditoria', !!(await comoPapel('service_role', `update eventos_auditoria set dados='{}' where restaurante_id=$1`, [loja.id])))
  ok('❌ esperado: service_role apaga auditoria', !!(await comoPapel('service_role', `delete from eventos_auditoria where restaurante_id=$1`, [loja.id])))
  ok('❌ esperado: aprovar a própria ação', !!(await comoPapel('service_role', `insert into fin_aprovacoes (restaurante_id, acao, solicitante_id, solicitante_nome, aprovador_id, aprovador_nome) values ($1,'desconto',$2,'x',$2,'x')`, [loja.id, G.id])))
  const v1 = await api(pd, '/api/admin/financeiro/auditoria', 'POST', { acao: 'verificar' })
  ok('verificação: tudo íntegro', v1.json?.ok === true, JSON.stringify(v1.json?.problemas?.slice(0, 2)))
  // Adulteração "por dentro" (dono do banco, fora do app) e verificação acusa; depois desfaz.
  await db.query(`alter table fin_lancamentos disable trigger fin_lancamentos_imutavel`).catch(() => {})
  await db.query(`update fin_lancamentos set valor_centavos=1 where id=$1`, [lanc.id])
  const v2 = await api(pd, '/api/admin/financeiro/auditoria', 'POST', { acao: 'verificar' })
  ok('adulteração direta no banco é acusada', v2.json?.ok === false && v2.json.problemas.some((p) => String(p.registro) === String(lanc.id)), JSON.stringify(v2.json?.problemas?.slice(0, 2)))
  await db.query(`update fin_lancamentos set valor_centavos=$2 where id=$1`, [lanc.id, lanc.valor_centavos])
  await db.query(`alter table fin_lancamentos enable trigger fin_lancamentos_imutavel`).catch(() => {})
  ok('restaurado: íntegro de novo', (await api(pd, '/api/admin/financeiro/auditoria', 'POST', { acao: 'verificar' })).json?.ok === true)

  console.log('\n── cancelamento autoaprovado (R9) ──')
  const ped = await um(`select id from pedidos order by criado_em desc limit 1`)
  const auto = `insert into solicitacoes_cancelamento (restaurante_id, pedido_id, motivo, solicitado_por, solicitado_por_nome) values ($1,$2,'TESTE',$3,'x') returning id`
  // O insert e o update numa só instrução não enxergam a linha nova: dois passos na mesma transação.
  async function autoaprova() {
    try {
      await db.query('begin')
      const s = (await db.query(auto, [loja.id, ped.id, G.id])).rows[0]
      await db.query(`update solicitacoes_cancelamento set status='aprovada', decidido_por=$2 where id=$1`, [s.id, G.id])
      await db.query('rollback'); return null
    } catch (e) { await db.query('rollback').catch(() => {}); return e.message }
  }
  ok('❌ esperado: aprovar o próprio pedido de cancelamento (flag ligada)', /autoaprovacao/.test(await autoaprova() ?? ''))
  await flag(false)
  ok('flag desligada: comportamento antigo (sem a trava)', (await autoaprova()) === null)
  await flag(true)

  console.log('\n── isolamento ──')
  const alOutra = await um(`insert into fin_alertas (restaurante_id, tipo, gravidade, mensagem) values ($1,'teste_e2e','info','TESTE outra loja') returning id`, [outraLoja.id])
  const lista = await api(pd, '/api/admin/financeiro/auditoria')
  ok('alerta de outra loja não aparece', !lista.json.alertas.some((a) => a.id === alOutra.id))
  ok('❌ esperado: marcar como lido alerta de outra loja', (await api(pd, '/api/admin/financeiro/auditoria', 'PATCH', { alertaId: alOutra.id })).status === 404)
  const meu = lista.json.alertas.find((a) => !a.lido_em)
  ok('marcar alerta da própria loja', !meu || (await api(pd, '/api/admin/financeiro/auditoria', 'PATCH', { alertaId: meu.id })).status === 200)
  await db.query(`delete from fin_alertas where id=$1`, [alOutra.id])

  console.log('\n── tela do Financeiro ──')
  await pd.goto(`${BASE}/admin/financeiro?secao=auditoria`, { waitUntil: 'networkidle' })
  await pd.getByTestId('fin-alertas').waitFor({ timeout: 8000 })
  await pd.getByTestId('fin-verificar').click()
  await pd.getByTestId('fin-integridade-resultado').waitFor({ timeout: 8000 })
  ok('verificar integridade pela tela', /íntegro/.test(await pd.getByTestId('fin-integridade-resultado').innerText()))
  await foto(pd, '04-financeiro-auditoria')
  ok('acessos recentes listados', (await pd.getByTestId('fin-sessoes').innerText()).includes(`Gerente ${SUF}`))
  const cel = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', storageState: await dono.ctx.storageState() })
  const pc = await cel.newPage(); await pc.goto(`${BASE}/admin/financeiro?secao=auditoria`, { waitUntil: 'networkidle' })
  await pc.getByTestId('fin-alertas').waitFor({ timeout: 8000 })
  ok('celular: sem rolagem lateral', await pc.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await foto(pc, '05-financeiro-celular')
  await cel.close()
} catch (e) {
  ok('execução sem exceção', false, e.message)
} finally {
  for (const c of criados) if (c.id && dono) await api(dono.p, `/api/admin/equipe/${c.id}`, 'PATCH', { situacao: 'excluido' }).catch(() => {})
  await db.query(`update usuarios set pin_hash=null, pin_falhas=0, pin_bloqueado_ate=null, pin_definido_em=null where restaurante_id=$1 and nome like 'TESTE Fin %'`, [loja.id])
  await db.query(`update usuarios set pin_hash=null, pin_falhas=0, pin_bloqueado_ate=null, pin_definido_em=null where restaurante_id=$1 and papel='dono'`, [loja.id])
  await db.query(`delete from fin_alertas where restaurante_id=$1 and criado_em >= $2`, [loja.id, inicio])
  await flag(false)
  await browser.close(); await db.end()
  const falhas = res.filter((x) => !x).length
  console.log(`\n${res.length - falhas}/${res.length} verificações ok`)
  process.exit(falhas ? 1 : 0)
}
