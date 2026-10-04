/**
 * E2E — Financeiro Fase 6 (2026-10-04): dashboard (cada card contra o livro-caixa), gráfico único, alertas
 * (cada um disparando), regras de PIN no fechamento, abertura rápida do caixa, aprovação pelo celular,
 * relatório de risco, permissões e antifraude.
 * Lojas PRÓPRIAS `fin6-e2e` / `fin6-e2e-viz` (o livro-caixa é imutável: os testes não sujam lojas de outras suítes).
 * O servidor local precisa de VIGIA_RELOGIO_TESTE=1 (relógio adiantado nos alertas "há X horas").
 *
 *   CRON_SECRET=<o do servidor> node scripts/seguranca/e2e-financeiro-fase6.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const sb = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const SENHA = 'demo-local-123456'
const PIN = { dono: '615283', gerente: '482913' }
const res = [], antifraude = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const af = (n, c, d = '') => { antifraude.push([n, !!c]); ok(`antifraude: ${n}`, c, d) }
const secao = (t) => console.log(`\n── ${t} ──`)
const texto = (v) => JSON.stringify(v)
const uuid = () => crypto.randomUUID()
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const CRON = process.env.CRON_SECRET ?? ''

// ── semente ──────────────────────────────────────────────────────────────────────────────────
async function loja(slug, nome) {
  return (await um(`insert into restaurantes (nome, slug, status_loja, telefone) values ($1,$2,'aberto_manual','27999990000')
    on conflict (slug) do update set nome=excluded.nome returning id`, [nome, slug])).id
}
async function usuario(email, login, papel, nome, restaurante) {
  const { data, error } = await sb.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  let uid = data?.user?.id
  if (!uid) {
    const { data: l } = await sb.auth.admin.listUsers({ perPage: 1000 })
    uid = l.users.find((u) => u.email === email).id
    await sb.auth.admin.updateUserById(uid, { password: SENHA, ban_duration: 'none' })
  }
  await db.query(`insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,$3::papel_usuario,$4,$5,$6,true)
    on conflict (id) do update set restaurante_id=excluded.restaurante_id, papel=excluded.papel, nome=excluded.nome, autorizado=true, desativado_em=null, situacao=null, acessos=null, cargo=null,
      usuario=excluded.usuario, pin_falhas=0, pin_bloqueado_ate=null`, [uid, restaurante, papel, nome, email, login])
  return uid
}
const L = await loja('fin6-e2e', 'Lanchonete Fase 6')
const V = await loja('fin6-e2e-viz', 'Vizinha Fase 6')
await db.query(`update restaurantes set financeiro_ativo=true, pdv_v2=true, usa_logistica=true, aceita_retirada=true, status_loja='aberto_manual', horario_funcionamento=null where id = any($1)`, [[L, V]])
const U = {
  dono: await usuario('dono@fin6.local', 'dono.fin6', 'dono', 'Dono Seis', L),
  gerente: await usuario('gerente@fin6.local', 'gerente.fin6', 'gerente', 'Gerente Seis', L),
  caixa: await usuario('caixa@fin6.local', 'caixa.fin6', 'atendente', 'Caixa Seis', L),
  garcom: await usuario('garcom@fin6.local', 'garcom.fin6', 'garcom', 'Garçom Seis', L),
  vizDono: await usuario('dono@fin6viz.local', 'dono.fin6viz', 'dono', 'Dono Vizinho', V),
}
await db.query(`insert into fin_config (restaurante_id) values ($1), ($2) on conflict do nothing`, [L, V])
await db.query(`update fin_config set limite_saida_centavos=10000, tolerancia_fechamento_centavos=200, limite_comandas_fechamento_centavos=10000, max_acoes_sensiveis_turno=10,
  horas_caixa_aberto=14, horas_motoboy_pendente=3, minutos_caixa_sem_abrir=30, limite_desconto_pct=10, limite_desconto_centavos=2000, alerta_whatsapp=null where restaurante_id=$1`, [L])
let grupo = await um(`select id from grupos_cardapio where restaurante_id=$1 limit 1`, [L])
if (!grupo) grupo = await um(`insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1,'TESTE Lanches',0) returning id`, [L])
const item = async (nome, preco) => (await um(`select id from itens_cardapio where restaurante_id=$1 and nome=$2`, [L, nome]))?.id
  ?? (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, status, tipo_item) values ($1,$2,$3,$4,'disponivel','simples') returning id`, [L, grupo.id, nome, preco])).id
const PRATO = await item('TESTE Prato F6', 30)
const CARO = await item('TESTE Banquete F6', 160)
let ent = await um(`select id from entregadores where restaurante_id=$1 and nome='TESTE Moto F6'`, [L])
if (!ent) ent = await um(`insert into entregadores (restaurante_id, nome) values ($1,'TESTE Moto F6') returning id`, [L])

const browser = await chromium.launch()
async function dispensarSetup(p, ms = 5000) {
  const b = p.getByRole('button', { name: 'OK, entendi' })
  try { await b.waitFor({ state: 'visible', timeout: ms }); await b.click(); await b.waitFor({ state: 'detached', timeout: 3000 }) } catch {}
}
async function logar(login, opcoes = { viewport: { width: 1366, height: 860 } }, { dispensar = true } = {}) {
  const ctx = await browser.newContext({ ...opcoes, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  if (dispensar) await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
  return { ctx, p }
}
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  let j = null; try { j = await r.json() } catch { /* */ }
  return { s: r.status, j }
}, { url: `${BASE}${url}`, metodo, corpo })
const semSessao = (url, metodo = 'GET', corpo, headers = {}) => fetch(`${BASE}${url}`, { method: metodo, headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: corpo ? JSON.stringify(corpo) : undefined }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))
const caixa = (p, corpo) => api(p, '/api/admin/financeiro/caixa', 'POST', corpo)
const turnoAtual = () => um(`select * from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [L])
const saldo = async (carteira) => Number((await um(`select coalesce(sum(valor_centavos),0)::bigint s from fin_lancamentos where restaurante_id=$1 and turno_id=$2 and carteira=$3`, [L, (await turnoAtual())?.id, carteira])).s)
const vigia = (agora) => semSessao('/api/cron/financeiro-vigia', 'POST', undefined, { 'x-cron-secret': CRON, ...(agora ? { 'x-vigia-agora': agora } : {}) })
const alertas = (tipo) => q(`select tipo, gravidade, mensagem, dados, criado_em from fin_alertas where restaurante_id=$1 and tipo=$2 order by criado_em desc`, [L, tipo])
const pedirRemoto = (p, acao, valorCentavos) => api(p, '/api/admin/financeiro/aprovacoes-remotas', 'POST', { acao, valorCentavos, motivo: 'TESTE pedido pelo celular' })
const decidir = (p, id, decisao, pin) => api(p, '/api/admin/financeiro/aprovacoes-remotas', 'PATCH', { id, decisao, pin })

/** Fecha o turno aberto (se houver) sem pendências, como o dono (sem PIN; justifica se precisar). */
async function zerarCaixa(p) {
  const t = await turnoAtual()
  if (!t) return
  const r = await caixa(p, { acao: 'fechar', contadoDinheiroCentavos: Math.max(0, await saldo('gaveta')), contadoCartaoCentavos: Math.max(0, await saldo('cartao')), aceitarPendencias: true, justificativa: 'TESTE fechamento entre cenários do e2e' })
  if (r.s !== 200) throw new Error(`zerarCaixa: ${r.s} ${texto(r.j)}`)
}

let dono, ger, cx, gar
try {
  secao('Preparação')
  dono = await logar('dono.fin6'); ger = await logar('gerente.fin6'); gar = await logar('garcom.fin6')
  ok('PIN do dono e do gerente', (await api(dono.p, '/api/sessao/pin', 'POST', { senha: SENHA, pin: PIN.dono })).s === 200 && (await api(ger.p, '/api/sessao/pin', 'POST', { senha: SENHA, pin: PIN.gerente })).s === 200)
  await zerarCaixa(dono.p)

  secao('Abertura rápida do caixa ao entrar')
  // Pergunta flutuante (components/ui/flutuante.tsx): não cobre o topo; "Agora não" vale até o próximo login.
  const pergunta = (p) => p.getByTestId('abertura-rapida')
  const cxA = await logar('caixa.fin6', undefined, { dispensar: false })
  await pergunta(cxA.p).waitFor({ timeout: 10000 }).catch(() => {})
  ok('quem pode abrir e entra com o caixa fechado: "Abrir o caixa agora?"', await pergunta(cxA.p).isVisible())
  const caixaPergunta = await pergunta(cxA.p).boundingBox()
  const conta = await cxA.p.getByLabel('Minha conta').boundingBox()
  ok('não cobre a barra do topo (fica logo abaixo dela)', !!caixaPergunta && !!conta && caixaPergunta.y >= conta.y + conta.height, texto([caixaPergunta?.y, conta && conta.y + conta.height]))
  ok('não trava a tela: é um flutuante na camada máxima, sem fundo escuro', await cxA.p.evaluate(() => {
    const el = document.querySelector('[data-testid="abertura-rapida"]')
    return !!el && el.hasAttribute('data-flutuante') && Number(getComputedStyle(el).zIndex) >= 9999 && el.getBoundingClientRect().width <= 320
  }))
  if (PRINTS) await cxA.p.screenshot({ path: join(PRINTS, 'abertura-rapida-desktop.png') })
  await cxA.p.getByTestId('abertura-rapida-depois').click()
  await pergunta(cxA.p).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  await cxA.p.goto(`${BASE}/admin/financeiro?secao=caixa`, { waitUntil: 'networkidle' })
  await cxA.p.waitForTimeout(2500)
  ok('"Agora não" vale até o próximo login (não volta ao trocar de tela)', !(await pergunta(cxA.p).isVisible().catch(() => false)))
  await cxA.ctx.close()
  const cxM = await logar('caixa.fin6', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { dispensar: false })
  await pergunta(cxM.p).waitFor({ timeout: 10000 }).catch(() => {})
  ok('no celular também aparece, abaixo do topo', await pergunta(cxM.p).isVisible() && ((await pergunta(cxM.p).boundingBox())?.y ?? 0) >= 50)
  if (PRINTS) await cxM.p.screenshot({ path: join(PRINTS, 'abertura-rapida-celular.png') })
  await cxM.ctx.close()
  cx = await logar('caixa.fin6', undefined, { dispensar: false })
  const modal = pergunta(cx.p)
  await modal.waitFor({ timeout: 10000 }).catch(() => {})
  ok('no login seguinte a pergunta volta', await modal.isVisible())
  await cx.p.getByTestId('abertura-rapida-fundo').fill('100,00')
  await cx.p.getByTestId('abertura-rapida-abrir').click()
  await modal.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  await dispensarSetup(cx.p, 2500)
  const t1 = await turnoAtual()
  ok('abriu com o fundo, em nome de quem entrou (sessão)', t1?.valor_inicial_centavos == 10000 && t1?.aberto_por_nome === 'Caixa Seis', texto(t1 && [t1.valor_inicial_centavos, t1.aberto_por_nome]))
  const cx2 = await logar('caixa.fin6', undefined, { dispensar: false })
  await cx2.p.waitForTimeout(2500)
  ok('caixa já aberto: não pergunta de novo', !(await cx2.p.getByTestId('abertura-rapida').isVisible().catch(() => false)))
  await cx2.ctx.close()
  const gar2 = await logar('garcom.fin6', undefined, { dispensar: false })
  await gar2.p.waitForTimeout(2000)
  ok('garçom (sem permissão de abrir) nunca vê a pergunta', !(await gar2.p.getByTestId('abertura-rapida').isVisible().catch(() => false)))
  await gar2.ctx.close()

  secao('Regras de PIN no fechamento (provisórias)')
  const divAntes = (await alertas('caixa_divergente')).length
  const fechar = (p, corpo) => caixa(p, { acao: 'fechar', ...corpo })
  const abrir = (p, fundo = 10000) => caixa(p, { acao: 'abrir', fundoCentavos: fundo })
  let esp = await saldo('gaveta')
  ok('tudo batendo: fecha sem justificativa nem PIN', (await fechar(cx.p, { contadoDinheiroCentavos: esp, contadoCartaoCentavos: 0 })).s === 200)
  await abrir(cx.p); esp = await saldo('gaveta')
  const d1 = await fechar(cx.p, { contadoDinheiroCentavos: esp - 150, contadoCartaoCentavos: 0 })
  ok('diferença de R$ 1,50 (até a tolerância de R$ 2,00): pede justificativa', d1.s === 409 && d1.j.codigo === 'divergencia' && d1.j.motivos?.[0] === 'diferenca_dinheiro', texto(d1.j?.motivos))
  const d1b = await fechar(cx.p, { contadoDinheiroCentavos: esp - 150, contadoCartaoCentavos: 0, justificativa: 'TESTE faltou troco de moeda' })
  ok('com justificativa: fecha SEM PIN', d1b.s === 200, `${d1b.s} ${d1b.j?.error ?? ''}`)
  ok('até a tolerância não alerta o dono como divergência grave', (await alertas('caixa_divergente')).length === divAntes)
  await abrir(cx.p); esp = await saldo('gaveta')
  const d2 = await fechar(cx.p, { contadoDinheiroCentavos: esp - 500, contadoCartaoCentavos: 0, justificativa: 'TESTE faltou dinheiro no fim' })
  ok('acima da tolerância: pede PIN (e diz o que pedir pelo celular)', d2.s === 409 && d2.j.codigo === 'aprovacao_necessaria' && d2.j.pedidoRemoto?.acao === 'fechar_caixa_divergente' && d2.j.pedidoRemoto?.valorCentavos === -500, texto(d2.j?.pedidoRemoto))
  const d2b = await fechar(cx.p, { contadoDinheiroCentavos: esp - 500, contadoCartaoCentavos: 0, justificativa: 'TESTE faltou dinheiro no fim', aprovacao: { aprovadorId: U.gerente, pin: PIN.gerente } })
  ok('com o PIN do gerente: fecha, e o dono recebe alerta de divergência', d2b.s === 200 && (await alertas('caixa_divergente')).length === divAntes + 1 && (await um(`select fechamento_aprovado_por_nome n from caixa_turnos where restaurante_id=$1 order by fechado_em desc limit 1`, [L])).n === 'Gerente Seis')
  await abrir(cx.p); esp = await saldo('gaveta')
  const m1 = await fechar(cx.p, { contadoDinheiroCentavos: esp, contadoCartaoCentavos: 100, justificativa: 'TESTE maquininha arredondou' })
  ok('maquininha com diferença pequena: só justificativa', m1.s === 200, `${m1.s} ${m1.j?.codigo ?? ''}`)
  await abrir(cx.p); esp = await saldo('gaveta')
  const m2 = await fechar(cx.p, { contadoDinheiroCentavos: esp, contadoCartaoCentavos: 300, justificativa: 'TESTE maquininha não bate' })
  ok('maquininha acima da tolerância: PIN', m2.s === 409 && m2.j.codigo === 'aprovacao_necessaria' && m2.j.motivos?.includes('diferenca_cartao_acima'), texto(m2.j?.motivos))
  ok('dono fecha a mesma diferença sem PIN (só justifica)', (await fechar(dono.p, { contadoDinheiroCentavos: esp, contadoCartaoCentavos: 300, justificativa: 'TESTE maquininha não bate' })).s === 200)

  // Mesa/comanda aberta: até R$ 100,00 → justificativa; acima → PIN.
  await abrir(cx.p)
  const b1 = await api(cx.p, '/api/admin/balcao/comandas', 'POST', { nome: 'TESTE Comanda F6', chave: uuid(), modalidade: 'retirada' })
  const l1 = await api(cx.p, '/api/admin/pdv/lancamento', 'POST', { pagamento: { escolha: 'dinheiro' }, comandaId: b1.j?.id, chave: uuid(), itens: [{ itemId: PRATO, quantidade: 1, complementos: [] }] })
  ok('comanda aberta com R$ 30,00', b1.s === 201 && l1.s === 201, `${b1.s} ${l1.s} ${l1.j?.error ?? ''}`)
  esp = await saldo('gaveta')
  const c1 = await fechar(cx.p, { contadoDinheiroCentavos: esp, contadoCartaoCentavos: 0 })
  ok('fechar com comanda aberta: mostra a pendência', c1.s === 409 && c1.j.codigo === 'pendencias' && c1.j.pendencias?.contasAbertas >= 1 && c1.j.pendencias?.contasAbertasCentavos === 3000, texto(c1.j?.pendencias && [c1.j.pendencias.contasAbertas, c1.j.pendencias.contasAbertasCentavos]))
  const c2 = await fechar(cx.p, { contadoDinheiroCentavos: esp, contadoCartaoCentavos: 0, aceitarPendencias: true })
  ok('passar para o próximo turno exige justificativa', c2.s === 409 && c2.j.codigo === 'justificativa_necessaria' && c2.j.motivos?.includes('comandas_abertas'), texto(c2.j?.motivos))
  const c3 = await fechar(cx.p, { contadoDinheiroCentavos: esp, contadoCartaoCentavos: 0, aceitarPendencias: true, justificativa: 'TESTE cliente ainda na mesa' })
  ok('até R$ 100,00 em aberto: fecha com justificativa, sem PIN, e o dono é avisado', c3.s === 200 && (await alertas('comanda_passou_turno')).length >= 1, `${c3.s} ${c3.j?.codigo ?? ''}`)
  await abrir(cx.p)
  await api(cx.p, '/api/admin/pdv/lancamento', 'POST', { pagamento: { escolha: 'dinheiro' }, comandaId: b1.j?.id, chave: uuid(), itens: [{ itemId: CARO, quantidade: 1, complementos: [] }] })
  esp = await saldo('gaveta')
  const c4 = await fechar(cx.p, { contadoDinheiroCentavos: esp, contadoCartaoCentavos: 0, aceitarPendencias: true, justificativa: 'TESTE mesa grande ainda comendo' })
  ok('acima de R$ 100,00 em aberto: PIN', c4.s === 409 && c4.j.codigo === 'aprovacao_necessaria' && c4.j.motivos?.includes('comandas_abertas_acima'), texto(c4.j?.motivos))
  ok('com PIN: fecha', (await fechar(cx.p, { contadoDinheiroCentavos: esp, contadoCartaoCentavos: 0, aceitarPendencias: true, justificativa: 'TESTE mesa grande ainda comendo', aprovacao: { aprovadorId: U.gerente, pin: PIN.gerente } })).s === 200)
  await api(dono.p, `/api/admin/comandas/${b1.j?.id}`, 'POST', { acao: 'cancelar_conta', motivo: 'TESTE limpeza da comanda do e2e' })

  // Pix a conferir: não trava, vai para a lista do dono.
  await abrir(cx.p)
  const tPix = await turnoAtual()
  await sb.from('fin_lancamentos').insert([{ restaurante_id: L, grupo_id: uuid(), linha: 1, turno_id: tPix.id, carteira: 'pix_conferir', tipo: 'recebimento', valor_centavos: 4500, forma: 'pix', origem: 'online', usuario_nome: 'TESTE', chave_idempotencia: `e2e6-pix-${uuid().slice(0, 8)}` }])
  esp = await saldo('gaveta')
  const px = await fechar(cx.p, { contadoDinheiroCentavos: esp, contadoCartaoCentavos: 0 })
  ok('Pix a conferir não trava o fechamento (sem PIN, sem justificativa)', px.s === 200, `${px.s} ${px.j?.codigo ?? ''}`)
  ok('…e vai para a lista do dono (alerta)', (await alertas('pix_a_conferir')).length >= 1)

  // Motoboy sem acerto: PIN.
  await abrir(cx.p)
  const tMo = await turnoAtual()
  const gMo = uuid()
  await sb.from('fin_lancamentos').insert([
    { restaurante_id: L, grupo_id: gMo, linha: 1, turno_id: tMo.id, carteira: 'gaveta', tipo: 'troco_motoboy', valor_centavos: -2000, forma: 'dinheiro', origem: 'manual', usuario_nome: 'TESTE', chave_idempotencia: `e2e6-mo-${gMo.slice(0, 8)}` },
    { restaurante_id: L, grupo_id: gMo, linha: 2, turno_id: tMo.id, carteira: 'motoboy', entregador_id: ent.id, tipo: 'troco_motoboy', valor_centavos: 2000, forma: 'dinheiro', origem: 'manual', usuario_nome: 'TESTE', chave_idempotencia: `e2e6-mo-${gMo.slice(0, 8)}` },
  ])
  esp = await saldo('gaveta')
  // Teste novo (2026-10-05): pendência SEM justificativa e SEM PIN continua bloqueada (o caixa não fecha).
  const mo0 = await fechar(cx.p, { contadoDinheiroCentavos: esp, contadoCartaoCentavos: 0, aceitarPendencias: true })
  ok('fechar com pendência SEM justificativa → bloqueado, caixa continua aberto', mo0.s === 409 && mo0.j.codigo === 'justificativa_necessaria' && (await turnoAtual())?.id === tMo.id, `${mo0.s} ${mo0.j?.codigo}`)
  const mo1 = await fechar(cx.p, { contadoDinheiroCentavos: esp, contadoCartaoCentavos: 0, aceitarPendencias: true, justificativa: 'TESTE motoboy ainda na rua' })
  ok('motoboy sem acerto: PIN (mesmo justificando)', mo1.s === 409 && mo1.j.codigo === 'aprovacao_necessaria' && mo1.j.motivos?.includes('motoboy_sem_acerto'), texto(mo1.j?.motivos))
  ok('…com justificativa mas SEM PIN acima do limite → bloqueado, caixa continua aberto', (await turnoAtual())?.id === tMo.id)

  secao('Vigia: alertas por varredura')
  const em = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
  ok('cron da vigia sem o segredo → 401', (await semSessao('/api/cron/financeiro-vigia', 'POST')).s === 401)
  const v1 = await vigia(em(4))
  ok('motoboy com dinheiro há mais de 3 h → alerta', v1.s === 200 && (await alertas('motoboy_pendente')).some((a) => /TESTE Moto F6/.test(a.mensagem)), texto(v1.j))
  const v2 = await vigia(em(15))
  ok('caixa esquecido aberto há mais de 14 h → alerta', v2.s === 200 && (await alertas('caixa_aberto_demais')).length >= 1)
  const nAntes = (await q(`select 1 from fin_alertas where restaurante_id=$1`, [L])).length
  await vigia(em(15))
  ok('varrer de novo não repete alerta (dedupe)', (await q(`select 1 from fin_alertas where restaurante_id=$1`, [L])).length === nAntes)
  // Acerto do motoboy (devolve à gaveta) e fecha o caixa como o dono.
  const gAc = uuid()
  await sb.from('fin_lancamentos').insert([
    { restaurante_id: L, grupo_id: gAc, linha: 1, turno_id: tMo.id, carteira: 'motoboy', entregador_id: ent.id, tipo: 'acerto_motoboy', valor_centavos: -2000, forma: 'dinheiro', origem: 'manual', usuario_nome: 'TESTE', chave_idempotencia: `e2e6-ac-${gAc.slice(0, 8)}` },
    { restaurante_id: L, grupo_id: gAc, linha: 2, turno_id: tMo.id, carteira: 'gaveta', tipo: 'acerto_motoboy', valor_centavos: 2000, forma: 'dinheiro', origem: 'manual', usuario_nome: 'TESTE', chave_idempotencia: `e2e6-ac-${gAc.slice(0, 8)}` },
  ])
  await zerarCaixa(dono.p)

  // Caixa sem abrir no horário: grade com a loja aberta desde 1 h antes de "agora".
  const agoraSP = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
  const diaSem = new Date(`${hoje}T12:00:00Z`).getUTCDay()
  const hm = (min) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String((((min % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`
  const minAgora = Number(agoraSP.slice(0, 2)) * 60 + Number(agoraSP.slice(3, 5))
  const grade = { [String(diaSem)]: [{ abre: hm(minAgora - 60), fecha: hm(minAgora + 120) }] }
  if (minAgora >= 60 && minAgora <= 1320) {
    await db.query(`update restaurantes set status_loja='automatico', horario_funcionamento=$2 where id=$1`, [L, JSON.stringify(grade)])
    await vigia()
    ok('loja aberta há 60 min e ninguém abriu o caixa → alerta', (await alertas('caixa_sem_abrir')).length >= 1)
    await db.query(`update restaurantes set status_loja='aberto_manual', horario_funcionamento=null where id=$1`, [L])
  } else ok('(caixa sem abrir: fora da janela do relógio — coberto pelo teste unitário)', true)

  // Desconto alto, sangria alta, cancelamento depois de pago, ações sensíveis demais.
  await abrir(cx.p)
  const b2 = await api(cx.p, '/api/admin/balcao/comandas', 'POST', { nome: 'TESTE Desconto F6', chave: uuid(), modalidade: 'retirada' })
  await api(cx.p, '/api/admin/pdv/lancamento', 'POST', { pagamento: { escolha: 'dinheiro' }, comandaId: b2.j?.id, chave: uuid(), itens: [{ itemId: CARO, quantidade: 1, complementos: [] }] })
  const desc = await api(dono.p, `/api/admin/comandas/${b2.j?.id}`, 'POST', { acao: 'ajustar_valores', descontoTipo: 'percentual', descontoPercentual: 25, motivo: 'TESTE desconto grande' })
  ok('desconto de 25% aplicado (pelo dono)', desc.s === 200, `${desc.s} ${desc.j?.error ?? ''}`)
  const s1 = await caixa(ger.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 15000, motivo: 'TESTE cofre', chave: `e2e6-s1-${uuid().slice(0, 8)}`, aprovacao: { aprovadorId: U.dono, pin: PIN.dono } })
  ok('sangria de R$ 150,00 aprovada pelo dono', s1.s === 200, `${s1.s} ${s1.j?.error ?? ''}`)
  const pv = await semSessao('/api/loja/fin6-e2e/pedido', 'POST', { tipo: 'retirada', cliente: { nome: 'TESTE F6', telefone: '27999990066' }, pagamento: 'pix', trocoPara: null, endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' }, itens: [{ itemId: PRATO, quantidade: 1, observacao: '', complementos: [] }] })
  const recebeuPix = await um(`select count(*)::int n from fin_lancamentos where pedido_id=$1 and tipo='recebimento'`, [pv.j?.id])
  if (pv.s === 201 && !recebeuPix.n) {
    await sb.from('fin_lancamentos').insert([{ restaurante_id: L, grupo_id: uuid(), linha: 1, turno_id: (await turnoAtual()).id, carteira: 'pix_conferir', tipo: 'recebimento', valor_centavos: 3000, forma: 'pix', origem: 'online', pedido_id: pv.j.id, usuario_nome: 'TESTE', chave_idempotencia: `e2e6-pv-${uuid().slice(0, 8)}` }])
  }
  await db.query(`update pedidos set status='cancelado', cancelado_em=now(), cancelado_motivo='TESTE cancelado depois de pago' where id=$1`, [pv.j?.id])
  await db.query(`update fin_config set max_acoes_sensiveis_turno=1 where restaurante_id=$1`, [L])
  await caixa(ger.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 1000, motivo: 'TESTE cofre 2', chave: `e2e6-s2-${uuid().slice(0, 8)}` })
  const vv = await vigia()
  ok('desconto alto (25% > 10%) → alerta', (await alertas('desconto_alto')).some((a) => a.dados?.comanda === b2.j?.id), texto(vv.j))
  ok('sangria alta (R$ 150 > R$ 100) → alerta, mesmo aprovada', (await alertas('sangria_alta')).length >= 1)
  ok('cancelamento depois de pago → alerta GRAVE', (await alertas('cancelamento_apos_pagamento')).some((a) => a.gravidade === 'grave' && a.dados?.pedido === pv.j?.id))
  ok('muitas ações sensíveis por um funcionário no turno → alerta', (await alertas('acoes_sensiveis')).some((a) => /Gerente Seis/.test(a.mensagem)))
  await db.query(`update fin_config set max_acoes_sensiveis_turno=10 where restaurante_id=$1`, [L])
  await api(dono.p, `/api/admin/comandas/${b2.j?.id}`, 'POST', { acao: 'cancelar_conta', motivo: 'TESTE limpeza da comanda do desconto' })
  const man = await semSessao('/api/loja/fin6-e2e/pedido', 'POST', { tipo: 'retirada', cliente: { nome: 'TESTE F6 manip', telefone: '27999990067' }, pagamento: 'pix', trocoPara: null, endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' }, total: 1, itens: [{ itemId: PRATO, quantidade: 1, observacao: '', complementos: [], preco: 0.01 }] })
  const pm = await um(`select total from pedidos where id=$1`, [man.j?.id])
  af('valor manipulado no corpo (preço R$ 0,01) → pedido sai com o preço do cardápio', man.s === 201 && Number(pm?.total) === 30, `${man.s} ${pm?.total}`)
  await new Promise((r) => setTimeout(r, 800))
  ok('…e o dono recebe o alerta "valor manipulado"', (await alertas('valor_manipulado')).length >= 1)
  await db.query(`update pedidos set status='cancelado', cancelado_em=now(), cancelado_motivo='TESTE' where id=$1`, [man.j?.id])
  ok('divergência no fechamento e caixa reaberto continuam imediatos (Fase 2)', (await alertas('caixa_divergente')).length >= 1)

  secao('Aprovação pelo celular')
  // Operador de caixa com sangria liberada pela Equipe (sem "aprovar"): acima do limite, precisa de outra pessoa.
  await db.query(`update usuarios set acessos=$2 where id=$1`, [U.caixa, JSON.stringify({ areas: ['financeiro', 'pdv', 'pedidos'], sensiveis: ['caixa_abrir', 'fechar_caixa', 'receber_pagamento', 'sangria', 'despesa'] })])
  const sg = await caixa(cx.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 12000, motivo: 'TESTE sangria pelo celular', chave: `e2e6-r1-${uuid().slice(0, 8)}` })
  ok('sangria acima do limite: o servidor diz o que pedir pelo celular', sg.s === 409 && sg.j.pedidoRemoto?.acao === 'sangria' && sg.j.pedidoRemoto?.valorCentavos === 12000)
  const pr = await pedirRemoto(cx.p, 'sangria', 12000)
  ok('caixa pede a aprovação', pr.s === 201 && !!pr.j.id)
  af('quem pediu não lista nem decide pedidos (sem "aprovar")', (await api(cx.p, '/api/admin/financeiro/aprovacoes-remotas')).s === 403 && (await decidir(cx.p, pr.j.id, 'aprovar', '123456')).s === 403)
  const lista = await api(ger.p, '/api/admin/financeiro/aprovacoes-remotas')
  ok('gerente vê o pedido no painel', lista.s === 200 && lista.j.pedidos.some((x) => x.id === pr.j.id && x.solicitante_nome === 'Caixa Seis'))
  af('PIN errado do aprovador → recusado', (await decidir(ger.p, pr.j.id, 'aprovar', '000000')).s === 403)
  ok('gerente aprova com o PIN dele', (await decidir(ger.p, pr.j.id, 'aprovar', PIN.gerente)).s === 200)
  const sgOk = await caixa(cx.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 12000, motivo: 'TESTE sangria pelo celular', chave: `e2e6-r2-${uuid().slice(0, 8)}`, aprovacao: { remotaId: pr.j.id } })
  const lan = await um(`select aprovado_por_nome from fin_lancamentos where restaurante_id=$1 and tipo='sangria' order by id desc limit 1`, [L])
  ok('a sangria passa com a aprovação remota (aprovador no livro-caixa)', sgOk.s === 200 && lan.aprovado_por_nome === 'Gerente Seis', `${sgOk.s} ${sgOk.j?.error ?? ''}`)
  af('aprovação remota só vale UMA vez', (await caixa(cx.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 12000, motivo: 'TESTE de novo', chave: `e2e6-r3-${uuid().slice(0, 8)}`, aprovacao: { remotaId: pr.j.id } })).j?.codigo === 'usada')
  const pr2 = await pedirRemoto(cx.p, 'sangria', 12000)
  await decidir(dono.p, pr2.j.id, 'aprovar', PIN.dono)
  af('aprovada para R$ 120,00 não serve para R$ 160,00', (await caixa(cx.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 16000, motivo: 'TESTE valor trocado', chave: `e2e6-r4-${uuid().slice(0, 8)}`, aprovacao: { remotaId: pr2.j.id } })).j?.codigo === 'outro_valor')
  af('aprovada para sangria não serve para despesa', (await caixa(cx.p, { acao: 'movimento', movimento: 'despesa', valorCentavos: 12000, motivo: 'TESTE ação trocada', chave: `e2e6-r5-${uuid().slice(0, 8)}`, aprovacao: { remotaId: pr2.j.id } })).j?.codigo === 'outra_acao')
  af('outra pessoa não usa a aprovação de quem pediu', (await caixa(ger.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 12000, motivo: 'TESTE roubar aprovação', chave: `e2e6-r6-${uuid().slice(0, 8)}`, aprovacao: { remotaId: pr2.j.id } })).s === 404)
  const pg3 = await pedirRemoto(ger.p, 'sangria', 13000)
  af('ninguém aprova o próprio pedido', (await decidir(ger.p, pg3.j.id, 'aprovar', PIN.gerente)).s === 403)
  ok('dono recusa com o PIN dele', (await decidir(dono.p, pg3.j.id, 'recusar', PIN.dono)).s === 200)
  af('pedido recusado não libera nada', (await caixa(ger.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 13000, motivo: 'TESTE recusado', chave: `e2e6-r7-${uuid().slice(0, 8)}`, aprovacao: { remotaId: pg3.j.id } })).j?.codigo === 'nao_aprovado')
  const pr4 = await pedirRemoto(cx.p, 'despesa', 11000)
  await db.query(`update fin_aprovacao_pedidos set expira_em=now() - interval '1 minute' where id=$1`, [pr4.j.id])
  af('pedido expirado (10 min) não pode ser aprovado', (await decidir(ger.p, pr4.j.id, 'aprovar', PIN.gerente)).j?.codigo === 'expirado')
  const vizPed = (await um(`insert into fin_aprovacao_pedidos (restaurante_id, acao, valor_centavos, solicitante_id, solicitante_nome) values ($1,'sangria',100,$2,'TESTE viz') returning id`, [V, U.vizDono])).id
  af('pedido de OUTRA loja → 404', (await decidir(ger.p, vizPed, 'aprovar', PIN.gerente)).s === 404)
  af('pedido de aprovação não se apaga (até com o acesso do servidor)', !!(await sb.from('fin_aprovacao_pedidos').delete().eq('id', pr.j.id)).error)
  const audA = await q(`select acao from eventos_auditoria where restaurante_id=$1 and acao in ('fin.pediu_aprovacao','fin.aprovou','fin.recusou_aprovacao') and criado_em > now() - interval '20 minutes'`, [L])
  ok('tudo auditado (pedido, aprovação, recusa)', ['fin.pediu_aprovacao', 'fin.aprovou', 'fin.recusou_aprovacao'].every((a) => audA.some((x) => x.acao === a)))

  // Pela tela: caixa pede no computador, gerente aprova no celular.
  await cx.p.goto(`${BASE}/admin/financeiro?secao=movimentacoes`, { waitUntil: 'networkidle' })
  await dispensarSetup(cx.p, 2500)
  await cx.p.getByTestId('mov-sangria').click().catch(async () => { await cx.p.getByText('Sangria', { exact: true }).first().click() })
  await cx.p.getByTestId('mov-valor').fill('140,00')
  await cx.p.getByTestId('mov-motivo').fill('TESTE sangria pela tela')
  await cx.p.getByTestId('mov-confirmar').click()
  await cx.p.getByTestId('aprovacao-pedir-celular').click()
  await cx.p.getByTestId('aprovacao-remota-esperando').waitFor({ timeout: 8000 })
  if (PRINTS) await cx.p.screenshot({ path: join(PRINTS, 'aprovacao-pedido-desktop.png') })
  const cel = await logar('gerente.fin6', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await cel.p.goto(`${BASE}/admin/financeiro?secao=caixa`, { waitUntil: 'networkidle' })
  await dispensarSetup(cel.p, 2500)
  await cel.p.getByTestId('faixa-aprovacoes').waitFor({ timeout: 15000 })
  ok('celular do gerente: faixa "pede aprovação" por cima da tela', await cel.p.getByTestId('faixa-aprovacoes').isVisible())
  if (PRINTS) await cel.p.screenshot({ path: join(PRINTS, 'aprovacao-faixa-celular.png') })
  await cel.p.getByTestId('faixa-aprovacoes').tap()
  await cel.p.getByTestId('janela-aprovar-remoto').waitFor()
  if (PRINTS) await cel.p.screenshot({ path: join(PRINTS, 'aprovacao-pin-celular.png') })
  for (const dgt of PIN.gerente) await cel.p.getByTestId('janela-aprovar-remoto').getByTestId(`pin-${dgt}`).tap()
  await cel.p.getByTestId('janela-aprovar-remoto').waitFor({ state: 'detached', timeout: 10000 })
  await cx.p.getByTestId('janela-movimento').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  const lanTela = await um(`select valor_centavos::int v, aprovado_por_nome from fin_lancamentos where restaurante_id=$1 and tipo='sangria' and carteira='gaveta' order by id desc limit 1`, [L])
  ok('aprovou no celular → a sangria da tela entrou sozinha', lanTela.v === -14000 && lanTela.aprovado_por_nome === 'Gerente Seis', texto(lanTela))
  await cel.ctx.close()

  await db.query(`update usuarios set acessos=null where id=$1`, [U.caixa])
  secao('Dashboard: cada card contra o livro-caixa')
  const de = hoje, ate = hoje
  const dash = await api(dono.p, `/api/admin/financeiro/dashboard?de=${de}&ate=${ate}&grupo=dia`)
  const C = dash.j?.cards
  const lim = `criado_em >= ($2::date::timestamp at time zone 'America/Sao_Paulo') and criado_em < (($2::date + 1)::timestamp at time zone 'America/Sao_Paulo')`
  const sql1 = async (expr, extra = '') => Number((await um(`select ${expr} v from fin_lancamentos where restaurante_id=$1 and ${lim} ${extra}`, [L, hoje])).v ?? 0)
  const fat = await sql1(`coalesce(sum(valor_centavos),0)`, `and tipo in ('recebimento','troco','estorno') and carteira not in ('empresa','resultado')`)
  // Venda = pedido/comanda com saldo positivo no período (pago e estornado inteiro não conta — 0145).
  const vendas = Number((await um(`select count(*) v from (select coalesce(comanda_id, pedido_id) k from fin_lancamentos where restaurante_id=$1 and ${lim} and tipo in ('recebimento','troco','estorno') and carteira not in ('empresa','resultado') and coalesce(comanda_id, pedido_id) is not null group by 1 having sum(valor_centavos) > 0) q`, [L, hoje])).v)
  ok('faturamento bruto = soma do livro-caixa', dash.s === 200 && C.faturamentoBrutoCentavos === fat, `${C?.faturamentoBrutoCentavos} × ${fat}`)
  ok('ticket médio = faturamento ÷ vendas', C.vendas === vendas && C.ticketMedioCentavos === (vendas ? Math.round(fat / vendas) : null), `${C.ticketMedioCentavos}`)
  const aReceber = await sql1(`coalesce(sum(valor_centavos),0)`, `and tipo in ('recebimento','troco','estorno') and carteira='a_receber'`)
  const aConf = Number((await um(`select coalesce(sum(l.valor_centavos),0) v from fin_lancamentos l where l.restaurante_id=$1 and ${lim.replace(/criado_em/g, 'l.criado_em')} and l.carteira='pix_conferir' and l.tipo='recebimento' and l.valor_centavos>0
    and not exists (select 1 from fin_lancamentos r where r.referencia_id=l.id and r.carteira='pix_conferir')`, [L, hoje])).v)
  ok('pagos × não pagos × a conferir (somam o faturamento)', C.naoPagosCentavos === aReceber && C.aConferirCentavos === aConf && C.pagosCentavos === fat - aReceber - aConf, texto([C.pagosCentavos, C.naoPagosCentavos, C.aConferirCentavos]))
  ok('sangrias = saídas da gaveta por sangria/retirada', C.sangriasCentavos === -(await sql1(`coalesce(sum(valor_centavos),0)`, `and carteira='gaveta' and tipo in ('sangria','retirada')`)), String(C.sangriasCentavos))
  ok('divergências = soma das diferenças de caixa; caixas divergentes contados', C.divergenciasCentavos === await sql1(`coalesce(sum(abs(valor_centavos)),0)`, `and carteira='gaveta' and tipo='ajuste'`) && C.turnosDivergentes >= 2)
  ok('diferenças de caixa = sobras − faltas do resultado, com o detalhe por turno (0145)', C.diferencasCaixaCentavos === await sql1(`coalesce(sum(valor_centavos),0)`, `and carteira='resultado' and tipo='ajuste'`) && dash.j.diferencasPorTurno.reduce((t, x) => t + x.diferencaCentavos, 0) === C.diferencasCaixaCentavos)
  ok('dinheiro com motoboy agora = saldo da carteira do motoboy', C.motoboyAgoraCentavos === Number((await um(`select coalesce(sum(valor_centavos),0) v from fin_lancamentos where restaurante_id=$1 and carteira='motoboy'`, [L])).v))
  ok('despesas = resultado (sem compras de insumo nem diferenças de caixa — 0145)', C.despesasCentavos === -(await sql1(`coalesce(sum(valor_centavos),0)`, `and carteira='resultado' and tipo not in ('conta_receber','compra','ajuste') and coalesce(dados->>'categoria_grupo','') not in ('insumo','fora')`)))
  const soma = (o) => Object.values(o ?? {}).reduce((s, v) => s + Number(v), 0)
  ok('vendas por origem e por forma somam o faturamento', soma(dash.j.porOrigem) === fat && soma(dash.j.porForma) === fat)
  const dreR = await api(dono.p, `/api/admin/financeiro/contas/dre?de=${de}&ate=${ate}`)
  ok('CMV, lucro bruto e lucro líquido = os do DRE', C.cmvCentavos === dreR.j.atual.cmvCentavos && C.lucroBrutoCentavos === dreR.j.atual.lucroBrutoCentavos && C.lucroLiquidoCentavos === dreR.j.atual.lucroLiquidoCentavos)
  // Mesma base do faturamento (0145): itens só das vendas que estão no livro-caixa do período.
  const top = (await um(`select public.fin_vendas_base($1, $2::date, $2::date, 'dia') b`, [L, hoje])).b.itens.sort((a, b) => b.qtd - a.qtd)[0]
  ok('item mais vendido', dash.j.itens.maisVendido?.nome === top?.nome, `${dash.j.itens.maisVendido?.nome} × ${top?.nome}`)
  ok('série diária com o dia de hoje = faturamento', dash.j.serie.length === 1 && dash.j.serie[0].faturamentoCentavos === fat)
  const semana = await api(dono.p, `/api/admin/financeiro/dashboard?de=${de}&ate=${ate}&grupo=semana`)
  const mes = await api(dono.p, `/api/admin/financeiro/dashboard?de=${de}&ate=${ate}&grupo=mes`)
  ok('evolução semanal e mensal (mesmo total)', semana.j.serie.reduce((s, x) => s + x.faturamentoCentavos, 0) === fat && mes.j.serie.reduce((s, x) => s + x.faturamentoCentavos, 0) === fat)
  af('caixa (sem "ver valores") não abre o dashboard', (await api(cx.p, '/api/admin/financeiro/dashboard')).s === 403)
  af('garçom não abre o dashboard', [403, 404].includes((await api(gar.p, '/api/admin/financeiro/dashboard')).s))

  // Tela + gráfico com as cores exatas.
  await dono.p.goto(`${BASE}/admin/financeiro?secao=dashboard`, { waitUntil: 'networkidle' })
  await dispensarSetup(dono.p, 2500)
  await dono.p.getByTestId('dash-cards').waitFor({ timeout: 15000 })
  // Redesign 4b: o período fica num filtro no padrão Meta (calendário + lista).
  await dono.p.getByTestId('dash-atalho-filtro').click()
  await dono.p.getByTestId('dash-atalho-7d').click()
  await dono.p.getByTestId('dash-grafico').waitFor()
  const cores = await dono.p.evaluate(() => {
    const svg = document.querySelector('[data-testid="dash-grafico"] svg')
    const tr = (sel, a) => [...svg.querySelectorAll(sel)].map((e) => e.getAttribute(a))
    return { linhas: tr('path[fill="none"]', 'stroke'), barras: tr('rect:not([data-coluna-hover])', 'fill'), grade: tr('line', 'stroke'), stops: [...svg.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color')), texto: tr('text', 'fill') }
  })
  ok('cores do gráfico: série 1 #1877F2, série 2 #32CDCD, barras #83C8C0, grade #EEEEEE, eixos #465A69',
    cores.linhas.includes('#1877F2') && cores.linhas.includes('#32CDCD') && cores.barras.every((c) => c === '#83C8C0') && cores.grade.includes('#EEEEEE') && cores.texto.every((c) => c === '#465A69'), texto(cores.linhas))
  ok('áreas em degradê #EDF5FE→#DFF2FB e #EFFBFB→#CCF2F2', ['#EDF5FE', '#DFF2FB', '#EFFBFB', '#CCF2F2'].every((c) => cores.stops.includes(c)))
  const box = await dono.p.getByTestId('dash-grafico').locator('svg').boundingBox()
  await dono.p.mouse.move(box.x + box.width - 20, box.y + box.height / 2)
  const tip = dono.p.getByTestId('dash-grafico-tooltip')
  await tip.waitFor({ timeout: 5000 })
  const tipTxt = await tip.innerText()
  const hover = await dono.p.evaluate(() => {
    const svg = document.querySelector('[data-testid="dash-grafico"] svg')
    return { vertical: [...svg.querySelectorAll('line')].some((l) => l.getAttribute('stroke') === '#BABDC2'), bolinhas: [...svg.querySelectorAll('circle')].map((c) => [c.getAttribute('fill'), c.getAttribute('stroke')]) }
  })
  ok('hover: linha vertical #BABDC2, bolinhas brancas com a borda da série, tooltip com seções e período', hover.vertical && hover.bolinhas.length >= 1 && hover.bolinhas.every(([f]) => f === '#FFFFFF') && /Vendas/.test(tipTxt) && /de out\.|de set\.|de nov\.|de \w+\. de 20/.test(tipTxt), tipTxt.replace(/\n/g, ' | '))
  ok('legenda abaixo, em negrito, com quadradinho', /Faturamento/.test(await dono.p.getByTestId('dash-grafico-legenda').innerText()))
  ok('medidor do CMV (trilho #EFF1F3)', await dono.p.evaluate(() => [...document.querySelectorAll('[data-testid="dash-medidor-cmv"] circle')].some((p) => p.getAttribute('stroke') === '#EFF1F3')) || !(await dono.p.getByTestId('dash-medidor-cmv').count()))
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'dashboard-desktop.png'), fullPage: true })

  secao('Relatório de risco por funcionário')
  // Ações sensíveis de mentira na auditoria (append-only): o caixa cancela muito mais que a equipe.
  const ev = (uid, nome, papel, acao, n) => Array.from({ length: n }, () => ({ restaurante_id: L, ator: 'usuario', usuario_id: uid, usuario_nome: nome, papel, acao, entidade: 'pedido', dados: { motivo: 'TESTE risco' } }))
  const { error: eEv } = await sb.from('eventos_auditoria').insert([
    ...ev(U.caixa, 'Caixa Seis', 'atendente', 'conta.cancelou_item', 9), ...ev(U.garcom, 'Garçom Seis', 'garcom', 'conta.cancelou_item', 2),
    ...ev(U.gerente, 'Gerente Seis', 'gerente', 'conta.cancelou_item', 1), ...ev(U.garcom, 'Garçom Seis', 'garcom', 'conta.reimprimiu', 1),
  ])
  ok('eventos de teste gravados', !eEv, eEv?.message ?? '')
  const rk = await api(dono.p, `/api/admin/financeiro/risco?de=${hoje}&ate=${hoje}`)
  const lc = rk.j?.linhas?.find((l) => l.nome === 'Caixa Seis')
  ok('caixa com 9 cancelamentos destacado (acima de 2× o normal da equipe)', rk.s === 200 && lc?.valores.cancelamentos >= 9 && lc.foraDoPadrao.includes('cancelamentos'), texto(lc && [lc.valores, lc.foraDoPadrao]))
  ok('garçom com 2 cancelamentos não é destacado', !(rk.j.linhas.find((l) => l.nome === 'Garçom Seis')?.foraDoPadrao ?? []).includes('cancelamentos'))
  ok('divergências de caixa entram por quem fechou', rk.j.linhas.some((l) => l.valores.divergencias > 0))
  ok('gerente também vê', (await api(ger.p, `/api/admin/financeiro/risco?de=${hoje}&ate=${hoje}`)).s === 200)
  af('caixa e garçom não veem o relatório de risco', (await api(cx.p, '/api/admin/financeiro/risco')).s === 403 && [403, 404].includes((await api(gar.p, '/api/admin/financeiro/risco')).s))
  await db.query(`update usuarios set acessos=$2 where id=$1`, [U.caixa, JSON.stringify({ areas: ['financeiro'], sensiveis: ['auditoria_ver', 'financeiro'] })])
  af('mesmo com "ver auditoria" marcado, quem não é dono/gerente não vê o risco', (await api(cx.p, '/api/admin/financeiro/risco')).s === 403)
  await db.query(`update usuarios set acessos=null where id=$1`, [U.caixa])
  await dono.p.goto(`${BASE}/admin/financeiro?secao=risco`, { waitUntil: 'networkidle' })
  await dono.p.getByTestId('risco-atalho-hoje').click()
  await dono.p.locator('[data-testid="risco-linha"][data-nome="Caixa Seis"]').waitFor({ timeout: 15000 })
  ok('tela: "Fora do padrão" na linha do caixa', (await dono.p.locator('[data-testid="risco-linha"][data-nome="Caixa Seis"] [data-testid="risco-selo"]').count()) === 1)
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'risco-desktop.png') })

  secao('Regras configuráveis por loja')
  af('gerente não muda as regras (só o dono)', (await api(ger.p, '/api/admin/financeiro/config', 'PUT', { toleranciaFechamentoCentavos: 99999 })).s === 403)
  const cf = await api(dono.p, '/api/admin/financeiro/config', 'PUT', { toleranciaFechamentoCentavos: 1000 })
  ok('dono muda a tolerância para R$ 10,00 (auditado)', cf.s === 200 && cf.j.config.toleranciaFechamentoCentavos === 1000 && !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='fin.config_alterada' limit 1`, [L])))
  await zerarCaixa(dono.p); await abrir(cx.p); esp = await saldo('gaveta')
  ok('com a tolerância nova, R$ 5,00 de diferença fecha só com justificativa', (await fechar(cx.p, { contadoDinheiroCentavos: esp - 500, contadoCartaoCentavos: 0, justificativa: 'TESTE tolerância da loja' })).s === 200)
  af('regra com valor fora da faixa → 400', (await api(dono.p, '/api/admin/financeiro/config', 'PUT', { minutosCaixaSemAbrir: 1 })).s === 400)
  await api(dono.p, '/api/admin/financeiro/config', 'PUT', { toleranciaFechamentoCentavos: 200 })
  await dono.p.goto(`${BASE}/admin/financeiro?secao=regras`, { waitUntil: 'networkidle' })
  await dono.p.getByTestId('secao-regras').waitFor({ timeout: 10000 })
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'regras-desktop.png') })

  secao('Celular')
  const dc = await logar('dono.fin6', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await dc.p.goto(`${BASE}/admin/financeiro?secao=dashboard`, { waitUntil: 'networkidle' })
  await dispensarSetup(dc.p, 2500)
  await dc.p.getByTestId('dash-cards').waitFor({ timeout: 15000 })
  ok('dashboard no celular sem rolagem lateral', await dc.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  if (PRINTS) await dc.p.screenshot({ path: join(PRINTS, 'dashboard-celular.png'), fullPage: true })
  await dc.p.goto(`${BASE}/admin/financeiro?secao=risco`, { waitUntil: 'networkidle' })
  await dc.p.getByTestId('risco-cartoes').waitFor({ timeout: 10000 })
  if (PRINTS) await dc.p.screenshot({ path: join(PRINTS, 'risco-celular.png') })
  await dc.ctx.close()
} catch (e) {
  ok('fluxo sem erro', false, String(e?.stack ?? e).slice(0, 700))
} finally {
  // Limpeza: comandas TESTE canceladas pelo sistema; caixa fechado; regras de volta.
  const abertas = await q(`select id from comandas where restaurante_id=$1 and status='aberta'`, [L]).catch(() => [])
  for (const k of abertas) if (dono) await api(dono.p, `/api/admin/comandas/${k.id}`, 'POST', { acao: 'cancelar_conta', motivo: 'TESTE limpeza do e2e da Fase 6' }).catch(() => {})
  if (dono) await zerarCaixa(dono.p).catch(() => {})
  await db.query(`update fin_config set tolerancia_fechamento_centavos=200, max_acoes_sensiveis_turno=10 where restaurante_id=$1`, [L]).catch(() => {})
  await db.query(`update usuarios set acessos=null where id=$1`, [U.caixa]).catch(() => {})
  await browser.close()
  await db.end()
}
const falhas = res.filter((x) => !x).length
if (antifraude.length) { console.log('\nAntifraude:'); for (const [n, c] of antifraude) console.log(`  ${c ? 'OK ' : 'FALHOU'}  ${n}`) }
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
