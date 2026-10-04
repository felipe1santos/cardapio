/**
 * E2E — Painel da plataforma (/superadmin) e /cadastro só por convite (2026-10-04).
 * Servidor local com SUPERADMIN_EMAILS=suporte@robo-a.local (start-server.sh). Cria só dados TESTE
 * (lojas "TESTE SA …", e-mails @teste-sa.local) e apaga tudo no fim.
 *
 *   node scripts/seguranca/e2e-superadmin.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE)
exigirLoopback(API_URL, BASE)
const SENHA = 'demo-local-123456'
const SA = { email: 'suporte@robo-a.local', login: 'suporte.roboa' }
const SUF = String(Date.now()).slice(-6)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const texto = (v) => JSON.stringify(v)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
async function ate(fn, ms = 10000) { const fim = Date.now() + ms; while (Date.now() < fim) { if (await fn()) return true; await esperar(300) } return false }

// ── Semente TESTE ───────────────────────────────────────────────────────────
const authCriados = []
const lojasCriadas = []
async function conta(email, { login = null, papel = 'dono', restaurante = null, autorizado = true, expira = null, nome = 'TESTE', desativado = null, situacao = null, cargo = null } = {}) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error) throw error
  authCriados.push(data.user.id)
  await db.query(`insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado, acesso_expira_em, desativado_em, situacao, cargo, nome_loja)
    values ($1,$2,$3::papel_usuario,$4,$5,$6,$7,$8,$9,$10,$11,'')`, [data.user.id, restaurante, papel, nome, email, login ?? '', autorizado, expira, desativado, situacao, cargo])
  return data.user.id
}
async function loja(nome) {
  const r = await um(`insert into restaurantes (nome, slug) values ($1, $2) returning id`, [nome, `teste-sa-${nome.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${SUF}`])
  lojasCriadas.push(r.id)
  return r.id
}
const LA = await loja('TESTE SA Alfa')
const LB = await loja('TESTE SA Beta')
const LC = await loja('TESTE SA Excluir')
const VALIDADE_ANTIGA = new Date(Date.now() + 40 * 86_400_000).toISOString()
const donoA = await conta(`dono.a.${SUF}@teste-sa.local`, { login: `tsa.a${SUF}`, restaurante: LA, nome: 'TESTE Dono Alfa' })
await conta(`garcom.${SUF}@equipe.menuzia.local`, { login: `tsa.g${SUF}`, papel: 'garcom', restaurante: LA, nome: 'TESTE Garçom Alfa' })
await conta(`pausado.${SUF}@equipe.menuzia.local`, { login: `tsa.p${SUF}`, papel: 'atendente', restaurante: LA, nome: 'TESTE Pausado Alfa', desativado: new Date().toISOString(), situacao: 'pausado' })
await conta(`excl.${SUF}@equipe.menuzia.local`, { login: `tsa.x${SUF}`, papel: 'cozinha', restaurante: LA, nome: 'TESTE Excluído Alfa', desativado: new Date().toISOString(), situacao: 'excluido' })
const donoB = await conta(`dono.b.${SUF}@teste-sa.local`, { login: `tsa.b${SUF}`, restaurante: LB, nome: 'TESTE Dono Beta', expira: VALIDADE_ANTIGA })
const donoC = await conta(`dono.c.${SUF}@teste-sa.local`, { login: `tsa.c${SUF}`, restaurante: LC, nome: 'TESTE Dono Excluir', autorizado: false })
const preRemover = await conta(`pre.rem.${SUF}@teste-sa.local`, { autorizado: false, nome: '' })
for (const [r, total] of [[LA, 50], [LA, 30], [LB, 20]]) {
  await db.query(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento) values ($1,'retirada','entregue',$2,$2,'TESTE SA','11900000000','pix')`, [r, total])
}
const EMAIL_NOVO = `novo.${SUF}@teste-sa.local`

/** Números esperados, calculados direto do banco (independente do código da tela). */
async function esperado() {
  const sa = SA.email
  const r = await um(`
    with donos as (select * from usuarios where papel='dono' and restaurante_id is not null),
    lojas as (select restaurante_id, bool_or(autorizado and (acesso_expira_em is null or acesso_expira_em > now())) com_acesso from donos group by restaurante_id),
    ent as (select restaurante_id, sum(total) fat, count(*) qtd from pedidos where status='entregue' group by restaurante_id)
    select (select count(*) from lojas) + (select count(*) from usuarios where papel='dono' and restaurante_id is null and email <> $1) cadastros,
      (select count(*) from lojas where com_acesso) ativos,
      (select count(*) from usuarios where papel='dono' and restaurante_id is null and email <> $1) pendentes,
      (select coalesce(sum(e.fat),0) from ent e join lojas l using (restaurante_id)) fat,
      (select coalesce(sum(e.qtd),0) from ent e join lojas l using (restaurante_id)) pedidos,
      (select count(*) from usuarios) usuarios_total`, [sa])
  return { cadastros: Number(r.cadastros), ativos: Number(r.ativos), pendentes: Number(r.pendentes), fat: Number(r.fat), pedidos: Number(r.pedidos), usuariosTotal: Number(r.usuarios_total) }
}
const num = (s) => Number(String(s).replace(/[^\d,]/g, '').replace(',', '.'))

async function logar(b, login, vp = { width: 1366, height: 860 }, extra = {}) {
  const ctx = await b.newContext({ viewport: vp, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', ...extra })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  return { ctx, p }
}
async function abrirPainel(p) {
  await p.goto(`${BASE}/superadmin`, { waitUntil: 'networkidle' })
  await p.getByTestId('resumo-plataforma').waitFor({ timeout: 20000 })
}
const linhaDe = (p, chave) => p.locator(`[data-testid="linha-loja"][data-chave="${chave}"]`)
async function buscar(p, t) { await p.getByTestId('busca-plataforma').fill(t); await esperar(250) }
function medirPopup(testid) {
  const el = document.querySelector(`[data-testid="${testid}"]`)
  if (!el) return { existe: false }
  const r = el.getBoundingClientRect()
  const t = document.elementFromPoint(r.left + r.width / 2, r.top + 12)
  return { existe: true, noBody: el.parentElement === document.body, z: getComputedStyle(el).zIndex, dentro: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, porCima: !!t && el.contains(t) }
}

const b = await chromium.launch()
const cfgAntes = await um(`select cadastro_automatico, cadastro_automatico_dias from config_plataforma where id=1`)
try {
  secao('1. /cadastro só por convite')
  // Mesmo com a coluna antiga ligada no banco, o código não a lê mais.
  await db.query(`insert into config_plataforma (id, cadastro_automatico, cadastro_automatico_dias) values (1, true, 30) on conflict (id) do update set cadastro_automatico=true`)
  const r1 = await fetch(`${BASE}/api/cadastro/verificar-email?email=${encodeURIComponent(`ninguem.${SUF}@teste-sa.local`)}`).then((r) => r.json())
  ok('e-mail sem pré-cadastro: "nao_encontrado" mesmo com o cadastro automático ligado no banco', r1.status === 'nao_encontrado', texto(r1))
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/cadastro`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', `ninguem.${SUF}@teste-sa.local`)
    ok('mensagem clara: "Cadastro disponível só por convite. Fale com o suporte."', await p.getByTestId('cadastro-so-convite').waitFor({ timeout: 8000 }).then(() => true, () => false))
    ok('o resto do formulário fica travado', await p.locator('input[name="nomeLoja"]').isDisabled() && await p.locator('button[type="submit"]').isDisabled())
    if (PRINTS) await p.screenshot({ path: join(PRINTS, 'cadastro-so-convite-celular.png') })
    await ctx.close()
  }

  secao('2. Acesso só do superadmin')
  {
    const { ctx, p } = await logar(b, 'dono.ordemqr')
    await p.goto(`${BASE}/superadmin`, { waitUntil: 'networkidle' })
    ok('lojista comum não vê /superadmin', !new URL(p.url()).pathname.startsWith('/superadmin') && !(await p.getByTestId('resumo-plataforma').count()), p.url())
    await ctx.close()
  }

  secao('3. Lista por loja, números do topo e sublogins (1366)')
  const { ctx, p } = await logar(b, SA.login)
  ok('superadmin entra direto no painel', new URL(p.url()).pathname.startsWith('/superadmin'), p.url())
  await abrirPainel(p)
  const esp = await esperado()
  const topo = {
    cadastros: num(await p.getByTestId('resumo-cadastros').innerText()), ativos: num(await p.getByTestId('resumo-ativos').innerText()),
    pendentes: num(await p.getByTestId('resumo-pendentes').innerText()), fat: num(await p.getByTestId('resumo-faturamento').innerText()),
    pedidos: num(await p.getByTestId('resumo-pedidos').innerText()),
  }
  ok('Cadastros = só lojas (não conta a equipe)', topo.cadastros === esp.cadastros && topo.cadastros < esp.usuariosTotal, `tela ${topo.cadastros} · esperado ${esp.cadastros} · usuários ${esp.usuariosTotal}`)
  ok('Ativos e Aguardando 1º acesso contam só lojas', topo.ativos === esp.ativos && topo.pendentes === esp.pendentes, texto({ topo, esp }))
  ok('Faturamento e Pedidos somados por loja, sem duplicar', Math.abs(topo.fat - esp.fat) < 0.01 && topo.pedidos === esp.pedidos, texto({ fat: topo.fat, esp: esp.fat, ped: topo.pedidos, espPed: esp.pedidos }))
  ok('faixa da paginação mostra o total de lojas', (await p.getByTestId('faixa-plataforma').innerText()).includes(`de ${esp.cadastros} lojas`), await p.getByTestId('faixa-plataforma').innerText())
  await buscar(p, 'TESTE SA')
  ok('uma linha por loja: Alfa aparece 1 vez e nenhum funcionário vira linha', (await linhaDe(p, LA).count()) === 1 && (await p.getByTestId('linha-loja').count()) === 3, String(await p.getByTestId('linha-loja').count()))
  const linhaA = linhaDe(p, LA)
  ok('coluna Sublogins com a contagem (excluído pela loja não conta)', (await linhaA.getByTestId('sublogins-botao').innerText()).trim() === '2')
  ok('faturamento da loja = soma dos entregues dela', (await linhaA.innerText()).includes('R$ 80,00'))
  await linhaA.getByTestId('sublogins-botao').click()
  const modalSub = p.getByTestId('modal-sublogins')
  ok('modal de sublogins: nome, login, cargo/papel, status, último acesso e criado em', (await modalSub.getByTestId('sublogins-tabela').getByTestId('sublogin').count()) === 2 && /TESTE Garçom Alfa/.test(await modalSub.innerText()) && /Pausado/.test(await modalSub.innerText()) && /@tsa\.g/.test(await modalSub.innerText()) && /Garçom/.test(await modalSub.innerText()))
  ok('modal de sublogins é só leitura (sem botões de ação)', (await modalSub.locator('button').count()) <= 2)
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'depois-sublogins-desktop.png') })
  await p.keyboard.press('Escape')
  await buscar(p, `tsa.g${SUF}`)
  ok('busca pelo login de um sublogin acha a loja dele', (await p.getByTestId('linha-loja').count()) === 1 && (await linhaDe(p, LA).count()) === 1)
  await buscar(p, `dono.b.${SUF}@teste-sa.local`)
  ok('busca por e-mail', (await linhaDe(p, LB).count()) === 1)
  await buscar(p, '')
  const seloB = await (await buscar(p, 'TESTE SA Beta'), linhaDe(p, LB).getByTestId('selo-situacao')).innerText()
  ok('conta antiga com validade continua "Ativo até…"', /^Ativo até \d\d\/\d\d\/\d\d$/.test(seloB), seloB)
  const corSelo = await linhaDe(p, LB).getByTestId('selo-situacao').evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color])
  ok('selos em cor viva com texto branco', corSelo[1] === 'rgb(255, 255, 255)' && corSelo[0] === 'rgb(3, 105, 161)', texto(corSelo))
  await buscar(p, '')

  secao('4. Filtros, ordenação, tabela')
  await p.getByTestId('filtro-pendente').click()
  const pend = await p.getByTestId('tabela-lojas').getByTestId('selo-situacao').allInnerTexts()
  ok('filtro "Aguardando 1º acesso"', pend.length >= 1 && pend.every((t) => t === 'Aguardando 1º acesso'), texto(pend))
  await p.getByTestId('filtro-sem_acesso').click()
  ok('filtro "Sem acesso"', (await p.getByTestId('tabela-lojas').getByTestId('selo-situacao').allInnerTexts()).every((t) => /Sem acesso|Expirou/.test(t)))
  await p.getByTestId('filtro-todos').click()
  await p.getByTestId('ordenar-faturamento').click()
  const fats = (await p.locator('[data-testid="linha-loja"] td:nth-child(6)').allInnerTexts()).map(num).filter((x) => !Number.isNaN(x))
  ok('ordenar por faturamento (maior primeiro)', fats.length > 3 && fats.every((v, i) => i === 0 || fats[i - 1] >= v), texto(fats.slice(0, 5)))
  await p.getByTestId('ordenar-loja').click()
  const nomes = (await p.getByTestId('tabela-lojas').getByTestId('linha-loja-nome').allInnerTexts()).filter((n) => n !== 'Loja ainda sem nome')
  ok('ordenar por loja (A→Z)', nomes.every((n, i) => i === 0 || nomes[i - 1].localeCompare(n, 'pt-BR') <= 0), texto(nomes.map((n, i) => [nomes[i - 1], n]).filter(([a, n], i) => i > 0 && a.localeCompare(n, 'pt-BR') > 0).slice(0, 3)))
  if (esp.cadastros > 20) {
    await p.getByTestId('pagina-proxima').click()
    ok('paginação: 2ª página', (await p.getByTestId('faixa-plataforma').innerText()).startsWith('21–'))
    await p.getByTestId('pagina-anterior').click()
  }
  const fixos = await p.evaluate(() => {
    const th = document.querySelector('[data-testid="tabela-lojas"] thead')
    const td = document.querySelector('[data-testid="linha-loja"] td')
    return { cabecalho: getComputedStyle(th).position, loja: getComputedStyle(td).position }
  })
  ok('cabeçalho fixo e coluna da loja fixa à esquerda', fixos.cabecalho === 'sticky' && fixos.loja === 'sticky', texto(fixos))
  await p.evaluate(() => { const r = document.querySelector('[data-testid="tabela-rolagem"]'); r.scrollLeft = 400; r.scrollTop = 200 })
  const aposRolar = await p.evaluate(() => { const td = document.querySelector('[data-testid="linha-loja"] td'); const r = document.querySelector('[data-testid="tabela-rolagem"]').getBoundingClientRect(); return Math.round(td.getBoundingClientRect().left - r.left) })
  ok('rolando para o lado, a loja continua visível', aposRolar <= 1, String(aposRolar))
  await p.evaluate(() => { const r = document.querySelector('[data-testid="tabela-rolagem"]'); r.scrollLeft = 0; r.scrollTop = 0 })
  ok('sem o bloco "Cadastro automático" e sem o formulário fixo de cadastro', !(await p.getByText('Cadastro automático').count()) && !(await p.getByText('Permitir cadastro automático').count()))
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'depois-desktop.png') })

  secao('5. + Cadastrar cliente (modal) e primeiro acesso')
  await p.getByTestId('cadastrar-cliente').click()
  const m = p.getByTestId('modal-cadastrar')
  await m.getByTestId('cadastrar-email').fill('invalido@')
  ok('e-mail inválido: "Pré-cadastrar" desabilitado', await m.getByTestId('cadastrar-enviar').isDisabled())
  await m.getByTestId('cadastrar-email').fill(`dono.a.${SUF}@teste-sa.local`)
  await m.getByTestId('cadastrar-enviar').click()
  ok('e-mail duplicado: erro claro e o modal continua aberto', await ate(async () => /já está cadastrado/.test(await p.getByTestId('toast').allInnerTexts().then((t) => t.join(' ')))) && await m.isVisible())
  const dataValidade = new Date(Date.now() + 60 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  await m.getByTestId('cadastrar-email').fill(EMAIL_NOVO)
  await m.getByTestId('cadastrar-loja').fill('TESTE SA Novo Burger')
  await m.getByTestId('cadastrar-nome').fill('TESTE Responsável Novo')
  await m.getByTestId('cadastrar-telefone').fill('(11) 90000-0001')
  await m.getByTestId('validade-com').check()
  await m.getByTestId('validade-data').fill(dataValidade)
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'depois-modal-cadastrar-desktop.png') })
  await m.getByTestId('cadastrar-enviar').click()
  ok('toast de sucesso e o modal fecha', await ate(async () => /pré-cadastrado/.test((await p.getByTestId('toast').allInnerTexts()).join(' '))) && await ate(async () => !(await m.isVisible())))
  const novo = await um(`select id, nome, nome_loja, telefone, autorizado, restaurante_id, acesso_expira_em from usuarios where email=$1`, [EMAIL_NOVO])
  if (novo) authCriados.push(novo.id)
  ok('pré-cadastro salvo com loja, responsável, telefone e validade', !!novo && novo.nome_loja === 'TESTE SA Novo Burger' && novo.nome === 'TESTE Responsável Novo' && !novo.restaurante_id && !!novo.acesso_expira_em, texto(novo))
  await buscar(p, 'Novo Burger')
  ok('nova linha "Aguardando 1º acesso"', await ate(async () => (await linhaDe(p, `pre:${novo?.id}`).getByTestId('selo-situacao').innerText().catch(() => '')) === 'Aguardando 1º acesso'))
  const audPre = await um(`select count(*) n from auditoria_plataforma where acao='plataforma.pre_cadastrou' and usuario_id=$1 and ator_email=$2`, [novo?.id, SA.email])
  ok('pré-cadastro registrado na auditoria da plataforma', Number(audPre.n) === 1)
  {
    const ctx2 = await b.newContext({ viewport: { width: 414, height: 900 }, locale: 'pt-BR' })
    const c = await ctx2.newPage()
    await c.goto(`${BASE}/cadastro`, { waitUntil: 'networkidle' })
    await c.fill('input[name="email"]', EMAIL_NOVO)
    ok('/cadastro com o e-mail convidado: liberado e pré-preenchido', await ate(async () => (await c.inputValue('input[name="nomeLoja"]')) === 'TESTE SA Novo Burger') && (await c.inputValue('input[name="nome"]')) === 'TESTE Responsável Novo' && (await c.inputValue('input[name="telefone"]')) === '(11) 90000-0001')
    await c.fill('input[name="usuario"]', `tsa.n${SUF}`)
    await c.fill('input[name="senha"]', SENHA); await c.fill('input[name="confirmarSenha"]', SENHA)
    await c.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled, null, { timeout: 8000 }).catch(() => {})
    await Promise.all([c.waitForURL(/\/login/, { timeout: 20000 }).catch(() => {}), c.click('button[type="submit"]')])
    const depois = await um(`select u.autorizado, u.restaurante_id, u.acesso_expira_em, r.nome from usuarios u left join restaurantes r on r.id=u.restaurante_id where u.id=$1`, [novo?.id])
    if (depois?.restaurante_id) lojasCriadas.push(depois.restaurante_id)
    ok('primeiro acesso cria a loja e libera, mantendo a validade do convite', !!depois?.restaurante_id && depois.autorizado && String(depois.acesso_expira_em) === String(novo?.acesso_expira_em) && depois.nome === 'TESTE SA Novo Burger', texto(depois))
    await ctx2.close()
  }
  await abrirPainel(p)
  await buscar(p, 'Novo Burger')
  const seloNovo = await p.getByTestId('selo-situacao').first().innerText()
  ok('na lista, a loja nova vira "Ativo até …"', /^Ativo até/.test(seloNovo), seloNovo)

  secao('6. Menu ⋮: validade, bloquear, desbloquear, remover, excluir (com auditoria)')
  await buscar(p, 'TESTE SA Alfa')
  await linhaDe(p, LA).getByTestId('loja-menu').click()
  const mm = await p.evaluate(medirPopup, 'loja-menu-lista')
  ok('menu ⋮ por cima de tudo e dentro da tela', mm.existe && mm.noBody && mm.z === '9999' && mm.dentro && mm.porCima, texto(mm))
  await p.getByTestId('acao-validade').click()
  const dataV = new Date(Date.now() + 90 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  await p.getByTestId('modal-validade').getByTestId('validade-com').check()
  await p.getByTestId('modal-validade').getByTestId('validade-data').fill(dataV)
  await p.getByTestId('validade-salvar').click()
  ok('alterar validade sem precisar bloquear antes', await ate(async () => { const r = await um(`select acesso_expira_em from usuarios where id=$1`, [donoA]); return !!r.acesso_expira_em && new Date(r.acesso_expira_em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) === dataV }))
  await esperar(800)
  await linhaDe(p, LA).getByTestId('loja-menu').click()
  await p.getByTestId('acao-bloquear').click()
  ok('bloquear pede confirmação', await p.getByTestId('modal-confirmar').isVisible())
  await p.getByTestId('confirmar-acao').click()
  ok('bloqueado: conta sem acesso e selo "Sem acesso"', await ate(async () => !(await um(`select autorizado from usuarios where id=$1`, [donoA])).autorizado) && await ate(async () => (await linhaDe(p, LA).getByTestId('selo-situacao').innerText().catch(() => '')) === 'Sem acesso'))
  ok('bloqueio na auditoria da plataforma e na da loja', Number((await um(`select count(*) n from auditoria_plataforma where acao='plataforma.bloqueou' and restaurante_id=$1`, [LA])).n) === 1 && Number((await um(`select count(*) n from eventos_auditoria where acao='plataforma.bloqueou' and restaurante_id=$1`, [LA])).n) === 1)
  await linhaDe(p, LA).getByTestId('loja-menu').click()
  await p.getByTestId('acao-desbloquear').click()
  await p.getByTestId('modal-validade').getByTestId('validade-sem').check()
  await p.getByTestId('validade-salvar').click()
  ok('desbloquear sem validade', await ate(async () => { const r = await um(`select autorizado, acesso_expira_em from usuarios where id=$1`, [donoA]); return r.autorizado && !r.acesso_expira_em }))
  await buscar(p, `pre.rem.${SUF}`)
  await p.locator('[data-testid="linha-loja"]').first().getByTestId('loja-menu').click()
  await p.getByTestId('acao-remover').click(); await p.getByTestId('confirmar-acao').click()
  ok('remover pré-cadastro', await ate(async () => !(await um(`select 1 from usuarios where id=$1`, [preRemover]))))
  await buscar(p, 'TESTE SA Excluir')
  await linhaDe(p, LC).getByTestId('loja-menu').click()
  await p.getByTestId('acao-excluir').click()
  await p.getByTestId('excluir-nome').fill('outro nome')
  ok('excluir exige digitar o nome da loja', await p.getByTestId('excluir-confirmar').isDisabled())
  await p.getByTestId('excluir-nome').fill('TESTE SA Excluir')
  await p.getByTestId('excluir-confirmar').click()
  ok('excluir dados apaga loja e conta, com auditoria', await ate(async () => !(await um(`select 1 from restaurantes where id=$1`, [LC]))) && !(await um(`select 1 from usuarios where id=$1`, [donoC])) && Number((await um(`select count(*) n from auditoria_plataforma where acao='plataforma.excluiu_dados'`)).n) >= 1)
  const bDepois = await um(`select acesso_expira_em, autorizado from usuarios where id=$1`, [donoB])
  ok('conta antiga com validade intacta no fim', new Date(bDepois.acesso_expira_em).toISOString() === VALIDADE_ANTIGA && bDepois.autorizado)
  await ctx.close()

  secao('7. Celular (360, 390, 414), tablet e desktop')
  for (const [nome, vp, extra] of [['360', { width: 360, height: 740 }, { isMobile: true, hasTouch: true }], ['390', { width: 390, height: 844 }, { isMobile: true, hasTouch: true }], ['414', { width: 414, height: 896 }, { isMobile: true, hasTouch: true }], ['tablet 1024', { width: 1024, height: 768 }, { hasTouch: true }], ['desktop 1920', { width: 1920, height: 1000 }, {}]]) {
    const { ctx: c3, p: m3 } = await logar(b, SA.login, vp, extra)
    await abrirPainel(m3)
    const g = await m3.evaluate(() => {
      const h = document.querySelector('[data-testid="topo-plataforma"]').getBoundingClientRect()
      const cards = [...document.querySelectorAll('[data-testid="resumo-plataforma"] > *')].map((e) => Math.round(e.getBoundingClientRect().top))
      return { rolagem: document.documentElement.scrollWidth > innerWidth + 1, alturaTopo: Math.round(h.height), colunasResumo: cards.filter((t) => t === cards[0]).length }
    })
    const celular = vp.width < 768
    ok(`${nome}: sem rolagem lateral, topo numa linha`, !g.rolagem && g.alturaTopo <= 57, texto(g))
    if (celular) {
      ok(`${nome}: resumo em 2 colunas e lista de cartões`, g.colunasResumo === 2 && (await m3.getByTestId('cartao-loja').count()) > 0 && !(await m3.getByTestId('tabela-lojas').isVisible()))
      const fab = await m3.getByTestId('cadastrar-cliente').evaluate((e) => getComputedStyle(e).position)
      ok(`${nome}: "+ Cadastrar cliente" fixo`, fab === 'fixed')
      ok(`${nome}: busca pela lupa`, !(await m3.getByTestId('busca-plataforma').isVisible()) && (await m3.getByTestId('busca-lupa').tap(), await m3.getByTestId('busca-plataforma').isVisible()))
      await m3.getByTestId('busca-plataforma').fill('TESTE SA Alfa'); await esperar(300)
      const cartao = m3.locator(`[data-testid="cartao-loja"][data-chave="${LA}"]`)
      ok(`${nome}: cartão com loja, status, responsável, faturamento, pedidos, sublogins e ⋮`, /TESTE SA Alfa/.test(await cartao.innerText()) && await cartao.getByTestId('selo-situacao').isVisible() && await cartao.getByTestId('sublogins-botao').isVisible() && await cartao.getByTestId('loja-menu').isVisible() && /R\$ 80,00/.test(await cartao.innerText()))
      const chips = await m3.evaluate(() => { const g = document.querySelector('[role="group"][aria-label="Filtrar por status"]'); return { rola: getComputedStyle(g).overflowX, cabe: g.getBoundingClientRect().right <= innerWidth + 0.5 } })
      ok(`${nome}: filtros em chips roláveis`, chips.rola === 'auto' && chips.cabe, texto(chips))
      if (PRINTS && nome === '390') await m3.screenshot({ path: join(PRINTS, 'depois-celular.png'), fullPage: true })
      await cartao.getByTestId('sublogins-botao').tap()
      const mod = await m3.getByTestId('modal-sublogins').evaluate((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })
      ok(`${nome}: modal em tela cheia com "← Voltar"`, mod.w === vp.width && mod.h === vp.height && await m3.getByTestId('modal-voltar').isVisible(), texto(mod))
      if (PRINTS && nome === '390') await m3.screenshot({ path: join(PRINTS, 'depois-sublogins-celular.png') })
      await m3.getByTestId('modal-voltar').tap()
      await cartao.getByTestId('loja-menu').tap()
      const mn = await m3.evaluate(medirPopup, 'loja-menu-lista')
      ok(`${nome}: menu ⋮ por cima e dentro da tela`, mn.existe && mn.dentro && mn.porCima, texto(mn))
      await m3.keyboard.press('Escape')
      await m3.getByTestId('cadastrar-cliente').tap()
      ok(`${nome}: modal de cadastro em tela cheia`, await m3.getByTestId('modal-cadastrar').evaluate((e, w) => Math.round(e.getBoundingClientRect().width) === w, vp.width))
      if (PRINTS && nome === '390') await m3.screenshot({ path: join(PRINTS, 'depois-modal-cadastrar-celular.png') })
    } else {
      ok(`${nome}: tabela visível`, await m3.getByTestId('tabela-lojas').isVisible())
      if (PRINTS && nome === 'tablet 1024') await m3.screenshot({ path: join(PRINTS, 'depois-tablet.png') })
    }
    await c3.close()
  }
} catch (e) {
  ok('fluxo sem erro', false, String(e).slice(0, 400))
} finally {
  await b.close()
  // Limpeza: tudo que este teste criou.
  if (cfgAntes) await db.query(`update config_plataforma set cadastro_automatico=$1, cadastro_automatico_dias=$2 where id=1`, [cfgAntes.cadastro_automatico, cfgAntes.cadastro_automatico_dias])
  else await db.query(`delete from config_plataforma where id=1`)
  await db.query(`delete from auditoria_plataforma where restaurante_id = any($1) or usuario_id = any($2) or alvo like 'TESTE SA%' or alvo like '%@teste-sa.local'`, [lojasCriadas, authCriados])
  await db.query(`delete from usuarios where id = any($1)`, [authCriados])
  await db.query(`delete from restaurantes where id = any($1)`, [lojasCriadas])
  for (const id of authCriados) await admin.auth.admin.deleteUser(id).catch(() => {})
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
