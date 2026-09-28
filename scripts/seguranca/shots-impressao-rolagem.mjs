/**
 * Tela Impressão (UX nova, 2026-09-27) de ponta a ponta no navegador, numa loja local
 * montada como a Villa Lanches: Beta liberado, o MESMO computador pareado duas vezes (o
 * antigo sem sinal), impressoras virtuais do Windows. Nada é impresso: nenhum trabalho é
 * criado (o teste abre o pop-up e cancela).
 *
 *   · rolagem até o fim e sem rolagem horizontal em 360…1920 px
 *   · "Assistente antigo" ↔ "Usar novo Assistente"
 *   · modos reais bloqueados com o motivo; liberados quando as impressoras são válidas
 *   · pop-up de pareamento (código, tempo, detecta o computador novo)
 *   · pop-up de impressoras (pareamento antigo bloqueado, virtual marcada, salvar)
 *   · desconectar o computador usado no modo ligado → volta para "Somente teste"
 *
 *   SHOTS=<pasta> node scripts/seguranca/shots-impressao-rolagem.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SHOTS = process.env.SHOTS
if (!SHOTS) { console.error('SHOTS=<pasta>'); process.exit(2) }
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)
mkdirSync(SHOTS, { recursive: true })
const SENHA = 'demo-local-123456'
const LARGURAS = [360, 390, 412, 768, 1366, 1920]

const res = []
const ok = (n, c, d = '') => { res.push({ n, c: !!c }); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── loja como a Villa ────────────────────────────────────────────────────────
const L = (await um(`insert into restaurantes (nome, slug, status_loja) values ('Lanches Impressão E2E','imp-e2e-a','aberto_manual')
  on conflict (slug) do update set nome=excluded.nome returning id`)).id
await db.query(`delete from impressao_trabalhos where restaurante_id=$1`, [L])
await db.query(`delete from impressao_funcoes where restaurante_id=$1`, [L])
await db.query(`delete from impressao_agentes where restaurante_id=$1`, [L])
await db.query(`update restaurantes set impressao_beta_liberado=true, impressao_beta_modo='teste', impressao_cozinha_por_funcao=false, impressao_cozinha_transferida_em=null where id=$1`, [L])
const hash = () => createHash('sha256').update(randomBytes(16)).digest('hex')
const antigo = (await um(`insert into impressao_agentes (restaurante_id, nome, credencial_hash, versao, visto_em, criado_em, criado_por_nome)
  values ($1,'PC-PRINCIPAL',$2,'0.2.0-beta.1', now()-interval '30 minutes', now()-interval '1 day','dono') returning id`, [L, hash()])).id
const novo = (await um(`insert into impressao_agentes (restaurante_id, nome, credencial_hash, versao, visto_em, criado_em, criado_por_nome)
  values ($1,'PC-PRINCIPAL',$2,'0.2.0-beta.1', now(), now()-interval '25 minutes','dono') returning id`, [L, hash()])).id
const disp = {}
for (const [ag, visto] of [[antigo, "now()-interval '30 minutes'"], [novo, 'now()']]) {
  for (const nome of ['Microsoft XPS Document Writer', 'Microsoft Print to PDF', 'Fax', 'OneNote for Windows 10', 'POS-80', 'POS80-USB/COZINHA']) {
    const d = (await um(`insert into impressao_dispositivos (restaurante_id, agente_id, nome_sistema, visto_em, apelido) values ($1,$2,$3,${visto},$4) returning id`,
      [L, ag, nome, ag === antigo && nome === 'POS-80' ? 'cozinhaaa' : null])).id
    if (ag === novo) disp[nome] = d
  }
}
// O computador "novo" manda sinal (como o Beta faz a cada poucos segundos).
const sinal = setInterval(() => { db.query(`update impressao_agentes set visto_em=now() where restaurante_id=$1 and revogado_em is null and id<>$2`, [L, antigo]).catch(() => {}) }, 3000)
{
  const email = 'dono@imp-e2e.local'
  const { data, error } = await admin.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  let uid = data?.user?.id
  if (!uid) { const { data: l } = await admin.auth.admin.listUsers({ perPage: 1000 }); uid = l.users.find((u) => u.email === email).id; await admin.auth.admin.updateUserById(uid, { password: SENHA }) }
  await db.query(`insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,'dono','Dono Imp','dono@imp-e2e.local','dono.impa',true)
    on conflict (id) do update set restaurante_id=excluded.restaurante_id, papel='dono', autorizado=true, desativado_em=null`, [uid, L])
}
const modoLoja = async () => (await um(`select impressao_beta_modo m from restaurantes where id=$1`, [L])).m
const funcoesLoja = async () => Object.fromEntries((await db.query(`select funcao, dispositivo_id from impressao_funcoes where restaurante_id=$1`, [L])).rows.map((r) => [r.funcao, r.dispositivo_id]))

const browser = await chromium.launch()
async function abrir(largura) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: largura < 800 ? 780 : 900 }, locale: 'pt-BR', isMobile: largura < 800, hasTouch: largura < 800 })
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.impa')
  await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
  const b = p.getByRole('button', { name: /OK, entendi/ }).first(); await b.waitFor({ timeout: 2500 }).catch(() => {}); if (await b.isVisible().catch(() => false)) await b.click()
  await p.getByTestId('cartao-assistente').waitFor({ timeout: 15000 })
  await p.waitForTimeout(600)
  return { ctx, p }
}

try {
  for (const largura of LARGURAS) {
    const { ctx, p } = await abrir(largura)
    await p.screenshot({ path: join(SHOTS, `impressao-${largura}-topo.png`) })
    const rol = await p.evaluate(async () => {
      const c = document.querySelector('[data-testid=impressao-rolagem]')
      const antes = c.scrollTop
      c.scrollTo({ top: c.scrollHeight })
      await new Promise((r) => setTimeout(r, 300))
      const r = document.querySelector('[data-testid=ajuda-diagnostico]').getBoundingClientRect()
      return { rola: c.scrollHeight > c.clientHeight, moveu: c.scrollTop > antes, fimVisivel: r.bottom <= window.innerHeight + 1 && r.top < window.innerHeight }
    })
    ok(`${largura}px: rola até o fim ("Ajuda e diagnóstico" visível)`, rol.rola && rol.moveu && rol.fimVisivel, JSON.stringify(rol))
    const larg = await p.evaluate(() => {
      const w = window.innerWidth
      const fixo = (e) => { for (let x = e; x; x = x.parentElement) if (getComputedStyle(x).position === 'fixed') return true; return false }
      const fora = [...document.querySelectorAll('[data-testid=painel-impressao] *, header *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !fixo(e) })
      return { doc: document.documentElement.scrollWidth, w, fora: fora.slice(0, 3).map((e) => e.tagName + '.' + String(e.className).slice(0, 30)) }
    })
    ok(`${largura}px: sem rolagem horizontal; botão "Assistente antigo" visível`, larg.doc <= larg.w + 1 && larg.fora.length === 0 && await p.getByTestId('alternar-visao').isVisible(), larg.fora.join(' | '))
    await p.screenshot({ path: join(SHOTS, `impressao-${largura}-fim.png`) })
    // Pop-up de impressoras cabe na tela.
    await p.evaluate(() => document.querySelector('[data-testid=impressao-rolagem]').scrollTo({ top: 0 }))
    await p.getByTestId('escolher-impressoras').click()
    const caixa = await p.getByTestId('modal-impressoras').locator('> div').boundingBox()
    ok(`${largura}px: pop-up de impressoras cabe na tela`, !!caixa && caixa.x >= 0 && caixa.x + caixa.width <= largura + 1, JSON.stringify(caixa))
    await p.screenshot({ path: join(SHOTS, `impressao-${largura}-modal-impressoras.png`) })
    await ctx.close()
  }

  const { p } = await abrir(1366)
  // Nova ↔ antiga
  await p.getByTestId('alternar-visao').click()
  await p.getByTestId('area-assistente-antigo').waitFor({ timeout: 5000 })
  ok('"Assistente antigo" mostra a área antiga (token, opções, impressoras)', /Assistente antigo/.test(await p.getByTestId('area-assistente-antigo').innerText()) && (await p.getByTestId('cartao-assistente').count()) === 0)
  await p.screenshot({ path: join(SHOTS, 'impressao-1366-antigo.png'), fullPage: false })
  await p.reload({ waitUntil: 'networkidle' })
  ok('a escolha fica no navegador (recarregou e continua no antigo)', await p.getByTestId('area-assistente-antigo').isVisible().catch(() => false))
  await p.getByTestId('usar-novo').click()
  await p.getByTestId('cartao-assistente').waitFor({ timeout: 5000 })
  ok('"Usar novo Assistente" volta', await p.getByTestId('cartao-modo').count() === 0 && await p.getByTestId('modo-beta').isVisible())

  // Modos bloqueados sem impressora
  ok('Somente teste em uso e liberado', await p.getByTestId('modo-teste').isDisabled() && /em uso/i.test(await p.getByTestId('modo-teste').innerText()))
  ok('Somente Caixa bloqueado: "Escolha uma impressora para Recibo/Extrato"', await p.getByTestId('modo-caixa').isDisabled() && (await p.getByTestId('motivo-caixa').innerText()).includes('Escolha uma impressora para Recibo/Extrato'))
  ok('Cozinha e Caixa bloqueado sem as duas', await p.getByTestId('modo-cozinha_caixa').isDisabled())
  await p.getByTestId('ajuda-modos').click()
  ok('"?" abre a explicação dos modos', /Para voltar à segurança/.test(await p.getByTestId('modal-modos').innerText()))
  await p.getByRole('button', { name: 'Entendi' }).click()

  // Pareamento
  await p.getByTestId('gerar-codigo').click()
  await p.getByTestId('codigo-pareamento').waitFor({ timeout: 10000 })
  const cod = (await p.getByTestId('codigo-pareamento').innerText()).trim()
  ok('pop-up de pareamento: código e tempo restante', /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(cod) && /^\d\d:\d\d$/.test((await p.getByTestId('pareamento-tempo').innerText()).trim()) && /Assistente Menuzia Beta/.test(await p.getByTestId('modal-pareamento').innerText()))
  await p.screenshot({ path: join(SHOTS, 'impressao-1366-pareamento.png') })
  // O Beta pareia (aqui: o registro que o pareamento cria).
  await db.query(`insert into impressao_agentes (restaurante_id, nome, credencial_hash, versao, visto_em, criado_por_nome) values ($1,'PC-CAIXA',$2,'0.2.0-beta.1', now(),'dono')`, [L, hash()])
  await p.getByTestId('pareamento-ok').waitFor({ timeout: 10000 })
  ok('pop-up detecta o computador: "PC-CAIXA · conectado"', /PC-CAIXA · conectado/.test(await p.getByTestId('pareamento-ok').innerText()))
  await p.getByTestId('modal-pareamento').waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
  ok('e fecha sozinho', (await p.getByTestId('modal-pareamento').count()) === 0)

  // Impressoras (cartão clicável; o uso é um seletor de 4 botões)
  const usar = async (m, nome, valor) => {
    const grupo = m.getByTestId(`funcao-dispositivo-${nome}`).first()
    if (!(await grupo.isVisible().catch(() => false))) await m.getByTestId(`selecionar-${nome}`).first().click()
    await m.getByTestId(`funcao-dispositivo-${nome}-${valor || 'nenhuma'}`).first().click()
  }
  await p.getByTestId('escolher-impressoras').click()
  const modal = p.getByTestId('modal-impressoras')
  const cartaoAntigo = modal.getByTestId('impressora-POS-80').last()
  await cartaoAntigo.getByRole('button').first().click()
  ok('impressora do pareamento antigo: não pode ser escolhida', (await cartaoAntigo.getByRole('radiogroup').count()) === 0 && /pareamento antigo/.test(await cartaoAntigo.innerText()))
  ok('impressora virtual marcada', /virtual/i.test(await modal.getByTestId('impressora-Microsoft Print to PDF').first().innerText()))
  ok('aviso: nenhuma impressora definida para Cozinha nem Caixa', /Nenhuma impressora definida/.test(await modal.getByTestId('aviso-sem-funcao').innerText()))
  await usar(modal, 'POS-80', 'cozinha')
  await usar(modal, 'POS80-USB/COZINHA', 'caixa')
  await modal.getByTestId('salvar-impressoras').click()
  await p.getByTestId('modal-impressoras').waitFor({ state: 'detached', timeout: 8000 })
  const f1 = await funcoesLoja()
  ok('salvar grava Cozinha e Recibo/Extrato', f1.cozinha === disp['POS-80'] && f1.caixa === disp['POS80-USB/COZINHA'], JSON.stringify(f1))
  await p.waitForTimeout(800)
  ok('resumo: "Cozinha: POS-80" e "Recibo/Extrato: POS80-USB/COZINHA"', /POS-80/.test(await p.getByTestId('resumo-cozinha').innerText()) && /POS80-USB\/COZINHA/.test(await p.getByTestId('resumo-caixa').innerText()))
  ok('modos reais liberados', !(await p.getByTestId('modo-caixa').isDisabled()) && !(await p.getByTestId('modo-cozinha_caixa').isDisabled()))

  // Virtual vale igual à física (2026-09-27): a PDF nas duas funções pela tela, modos liberados.
  await p.getByTestId('escolher-impressoras').click()
  const mv = p.getByTestId('modal-impressoras')
  await usar(mv, 'POS-80', '')
  await usar(mv, 'POS80-USB/COZINHA', '')
  await usar(mv, 'Microsoft Print to PDF', 'ambas')
  ok('pop-up: aviso da virtual sem bloquear', /pode abrir uma janela para salvar arquivo/.test(await mv.getByTestId('impressora-Microsoft Print to PDF').first().innerText()))
  await mv.getByTestId('salvar-impressoras').click()
  await p.getByTestId('modal-impressoras').waitFor({ state: 'detached', timeout: 8000 })
  const fv = await funcoesLoja()
  ok('Microsoft Print to PDF como Cozinha e Recibo/Extrato', fv.cozinha === disp['Microsoft Print to PDF'] && fv.caixa === disp['Microsoft Print to PDF'], JSON.stringify(fv))
  await p.waitForTimeout(800)
  ok('resumo mostra a PDF nas duas', /Microsoft Print to PDF/.test(await p.getByTestId('resumo-cozinha').innerText()) && /Microsoft Print to PDF/.test(await p.getByTestId('resumo-caixa').innerText()))
  ok('Somente Caixa e Cozinha e Caixa liberados com a virtual', !(await p.getByTestId('modo-caixa').isDisabled()) && !(await p.getByTestId('modo-cozinha_caixa').isDisabled()))
  await p.screenshot({ path: join(SHOTS, 'impressao-1366-virtual.png') })
  // Volta para as térmicas (o resto do roteiro usa POS-80 / POS80-USB).
  await db.query(`update impressao_funcoes set dispositivo_id=$2 where restaurante_id=$1 and funcao='cozinha'`, [L, disp['POS-80']])
  await db.query(`update impressao_funcoes set dispositivo_id=$2 where restaurante_id=$1 and funcao='caixa'`, [L, disp['POS80-USB/COZINHA']])
  await p.waitForTimeout(6000)

  // Liga "Somente Caixa" pela tela
  await p.getByTestId('modo-caixa').click()
  await p.getByTestId('confirmar-modo-ok').click()
  await espera(1500)
  ok('"Somente Caixa" ligado pela tela', (await modoLoja()) === 'caixa')

  // Testes: botão "Testar impressão" do topo abre o pop-up (abre e fecha: nada é criado)
  await p.getByTestId('testar-impressao').click()
  const selTeste = await p.getByTestId('teste-impressora-cozinha').inputValue()
  const selRecibo = await p.getByTestId('teste-impressora-recibo').inputValue()
  ok('"Testar impressão": Cozinha e Recibo/Extrato já com as impressoras das funções', selTeste === disp['POS-80'] && selRecibo === disp['POS80-USB/COZINHA'])
  await p.keyboard.press('Escape')
  ok('Esc fecha o pop-up de testes', (await p.getByTestId('modal-teste').count()) === 0)

  // Desconectar o computador usado → volta para Somente teste
  await p.getByTestId('revogar-PC-PRINCIPAL').nth(1).click()
  await espera(2000)
  ok('desconectar o computador em uso: loja volta para "Somente teste"', (await modoLoja()) === 'teste')
  ok('e a tela avisa', /voltou para a segurança/.test(await p.getByTestId('impressao-aviso').innerText().catch(() => '')))
  await p.screenshot({ path: join(SHOTS, 'impressao-1366-apos-desconectar.png') })
  ok('Somente Caixa volta a ficar bloqueado (computador desconectado)', await p.getByTestId('modo-caixa').isDisabled() && /desconectado/.test(await p.getByTestId('motivo-caixa').innerText()))

  const t = await um(`select count(*)::int n from impressao_trabalhos where restaurante_id=$1`, [L])
  ok('nenhum trabalho de impressão criado', t.n === 0)
} catch (e) {
  ok(`execução sem exceção: ${e.message}`, false)
} finally {
  clearInterval(sinal)
  await browser.close()
  await db.end()
}
const f = res.filter((x) => !x.c)
console.log(`\n${res.length - f.length}/${res.length} verificações passaram`)
if (f.length) process.exit(1)
