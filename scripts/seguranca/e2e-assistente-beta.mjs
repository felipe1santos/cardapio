/**
 * E2E do Assistente Beta CONVIVENDO com o Assistente antigo 0.1.23.
 *
 * Dois agentes virtuais (scripts/impressao/agente-virtual.cjs) no mesmo "computador":
 *   · ANTIGO: o main.js/recibo.js/print.ps1 EXTRAÍDOS DA TAG printer-agent-v0.1.23,
 *     com o token da loja — exatamente o que está instalado nas lojas;
 *   · BETA: o código atual como "Assistente Menuzia Beta 0.2.0-beta.1", pareado por código.
 * Servidor e banco locais; nenhuma impressora física (cada impressão vira registro + PNG).
 *
 * Prova os três modos, a troca e a volta da cozinha, sem ficha em dobro nem perdida,
 * calibração por impressora e Recibo/Extrato pago e pendente.
 *
 *   ARTEFATOS=<pasta> node scripts/seguranca/e2e-assistente-beta.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { medirPngs } from '../impressao/medir-png.mjs'
import pg from 'pg'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const ART = process.env.ARTEFATOS ?? join(tmpdir(), 'menuzia-e2e-assistente-beta')
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE)
// Isolamento: nada do Assistente REAL deste computador (log, configuração, instalação).
// Aborta ANTES de apagar a pasta de artefatos se ela cair no lugar real.
const isolamento = createRequire(import.meta.url)('../impressao/isolamento-teste.cjs')
try {
  isolamento.exigirIsolamento({ temp: ART, pastas: [ART], rotulo: 'e2e Assistente Beta' })
} catch (e) {
  console.error(e.message)
  process.exit(3)
}
const fotoReaisAntes = isolamento.fotografarReais()
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
async function aguardar(fn, ms = 30000, passo = 500) {
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    const v = await fn()
    if (v) return v
    await esperar(passo)
  }
  return null
}

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes', 'impressao_reservas']) {
  await db.query(`delete from ${t} where restaurante_id=$1`, [loja])
}
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza e2e beta', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
const tokenLegado = uuid()
const inicio = (await um('select now() t')).t
await db.query(`update restaurantes set pdv_v2=true, impressao_automatica=true, impressao_cozinha_por_funcao=false, impressao_agente_visto_em=null,
  impressao_beta_liberado=false, impressao_beta_modo='teste', impressao_cozinha_transferida_em=null, impressao_agente_token=$2 where id=$1`, [loja, tokenLegado])
await db.query('update pedidos set impresso=true, reimprimir=false where restaurante_id=$1', [loja])

// ── código do 0.1.23, direto da tag ─────────────────────────────────────────
const SRC_ANTIGO = join(ART, 'assistente-0.1.23', 'src')
mkdirSync(join(SRC_ANTIGO, 'renderer'), { recursive: true })
for (const f of execFileSync('git', ['ls-tree', '--name-only', '-r', 'printer-agent-v0.1.23', '--', 'printer-agent/src']).toString().trim().split('\n')) {
  writeFileSync(join(ART, 'assistente-0.1.23', f.replace(/^printer-agent\//, '')), execFileSync('git', ['show', `printer-agent-v0.1.23:${f}`]))
}

// ── agentes virtuais ────────────────────────────────────────────────────────
const processos = []
function iniciarAgente(nome, impressoras, envExtra = {}) {
  const dir = join(ART, nome, 'dados')
  const saida = join(ART, nome, 'saida')
  mkdirSync(saida, { recursive: true })
  // %TEMP% do agente = pasta dele: o log do 0.1.23 real deste computador não é tocado.
  const proc = spawn(process.execPath, ['scripts/impressao/agente-virtual.cjs'], {
    env: { ...process.env, BASE, AGENTE_DIR: dir, AGENTE_SAIDA: saida, AGENTE_IMPRESSORAS: impressoras.join('|'), RENDER: '1', TEMP: saida, TMP: saida, ...envExtra },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  processos.push(proc)
  const esperando = []
  const logs = []
  let buf = ''
  let pronto = false
  proc.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (l.startsWith('<<PRONTO>>')) pronto = true
      else if (l.startsWith('<<RESP>> ')) esperando.shift()?.(JSON.parse(l.slice(9)))
      else if (l.startsWith('[agente]')) logs.push(l)
    }
  })
  proc.stderr.on('data', (d) => logs.push(`[stderr] ${d}`))
  const lerJsonl = (arq) => (existsSync(join(saida, arq)) ? readFileSync(join(saida, arq), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  return {
    nome,
    logs,
    proc,
    pronto: () => pronto,
    cmd: (o) => new Promise((r) => { esperando.push(r); proc.stdin.write(JSON.stringify(o) + '\n') }),
    impressos: () => lerJsonl('impressos.jsonl'),
    roteamento: () => lerJsonl('roteamento.jsonl'),
    fichas: () => lerJsonl('roteamento.jsonl').filter((r) => r.tipo === 'ficha_cozinha' && r.resultado === 'impresso_confirmado').map((r) => r.job_id),
    parar: () => new Promise((r) => { if (proc.exitCode !== null) return r(); proc.once('exit', r); proc.kill() }),
  }
}

const browser = await chromium.launch()
async function logar(usuario) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')])
  return page
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

let falhouFeio = null
let logoOriginal
// Trava de segurança: nenhum passo pode prender o teste (e os agentes) para sempre.
const limite = setTimeout(() => { console.error('TEMPO ESGOTADO'); for (const p of processos) p.kill(); process.exit(2) }, 8 * 60_000)
limite.unref()
const criados = []
try {
  const pGer = await logar('gerente.local')
  const pAt = await logar('atendente.local')
  const AGUA = await um('select id from itens_cardapio where restaurante_id=$1 and nome=$2', [loja, 'Água com Gás'])
  const balcao = (await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Cliente E2E Beta', chave: uuid() })).json.id
  const lancar = async () => {
    const id = (await api(pAt, '/api/admin/pdv/lancamento', 'POST', { comandaId: balcao, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }] })).json.id
    criados.push(id)
    return id
  }
  const modo = async (m) => api(pGer, '/api/admin/impressao/modo', 'PUT', { modo: m })

  secao('Assistente antigo 0.1.23 (código da tag) imprimindo como sempre')
  const ANTIGO = iniciarAgente('antigo-0.1.23', ['Cozinha Antiga'], { AGENTE_SRC: SRC_ANTIGO, AGENTE_VERSAO: '0.1.23' })
  await aguardar(() => ANTIGO.pronto(), 15000, 200)
  await ANTIGO.cmd({ cmd: 'config', patch: { token: tokenLegado, impressoraWindows: 'Cozinha Antiga', intervaloSegundos: 2 } })
  const a1 = await lancar()
  ok('0.1.23 imprime a ficha na impressora dele', !!(await aguardar(() => ANTIGO.fichas().includes(a1))))

  secao('Beta instalado junto, liberado e pareado — começa em "Somente teste"')
  await db.query('update restaurantes set impressao_beta_liberado=true where id=$1', [loja])
  const diag = {
    'POS-8370': { nome: 'POS-8370', driver: 'POS-80C', porta: 'USB001', dpiX: 203, dpiY: 203, papelLarguraMm: 80, areaImprimivelLarguraMm: 64, margemEsquerdaMm: 0, margemDireitaMm: 16, pontosImprimiveis: 512, online: true },
    'Cozinha Beta': { nome: 'Cozinha Beta', driver: 'Generic / Text Only', dpiX: 203, dpiY: 203, papelLarguraMm: 80, pontosImprimiveis: 576 },
  }
  const BETA = iniciarAgente('beta-0.2.0', ['POS-8370', 'Cozinha Beta'], { AGENTE_VARIANTE: 'beta', AGENTE_VERSAO: '0.2.0-beta.1', AGENTE_DIAG: JSON.stringify(diag) })
  await aguardar(() => BETA.pronto(), 15000, 200)
  const codigo = (await api(pGer, '/api/admin/impressao/pareamento', 'POST')).json.codigo
  ok('Beta pareia com código', (await BETA.cmd({ cmd: 'parear', codigo, nome: 'PC Caixa' }))?.ok === true)
  const disp = await aguardar(async () => {
    const r = await q('select id, nome_sistema, diagnostico from impressao_dispositivos where restaurante_id=$1', [loja])
    return r.length === 2 && r.every((d) => d.diagnostico) ? Object.fromEntries(r.map((d) => [d.nome_sistema, d])) : null
  })
  ok('Beta informa as 2 impressoras com diagnóstico do driver', !!disp && disp['POS-8370'].diagnostico.pontosImprimiveis === 512)
  ok('versão do Beta registrada', (await um('select versao from impressao_agentes where restaurante_id=$1', [loja]))?.versao === '0.2.0-beta.1')
  ok('config do Beta em pasta própria (sem o token da loja)', !readFileSync(join(ART, 'beta-0.2.0', 'dados', 'beta-dados', 'config.json'), 'utf8').includes(tokenLegado))

  const t1 = [await lancar(), await lancar()]
  ok('"Somente teste": fichas saem só no 0.1.23', !!(await aguardar(() => t1.every((id) => ANTIGO.fichas().includes(id)))))
  await esperar(4000)
  ok('"Somente teste": Beta não imprimiu nenhuma ficha', BETA.fichas().length === 0)

  secao('Calibração da POS-8370 (só Beta)')
  await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: disp['POS-8370'].id })
  await api(pGer, `/api/admin/impressao/dispositivos/${disp['POS-8370'].id}`, 'PATCH', { larguraMm: 80 })
  await api(pGer, `/api/admin/impressao/dispositivos/${disp['POS-8370'].id}`, 'POST', { acao: 'calibracao', chave: uuid() })
  const cal1 = await aguardar(() => BETA.impressos().find((i) => i.tipo === 'calibracao'))
  ok('página de calibração padrão: 576 pontos, com o diagnóstico do driver', !!cal1 && readFileSync(cal1.png).readUInt32BE(16) === 576 && cal1.texto.includes('POS-80C') && cal1.texto.includes('512'))
  ok('gerente salva o perfil lido na régua (512)', (await api(pGer, `/api/admin/impressao/dispositivos/${disp['POS-8370'].id}`, 'PATCH', { larguraPontos: 512 })).status === 200)
  await api(pGer, `/api/admin/impressao/dispositivos/${disp['POS-8370'].id}`, 'POST', { acao: 'calibracao', chave: uuid() })
  const cal2 = await aguardar(() => BETA.impressos().filter((i) => i.tipo === 'calibracao')[1])
  ok('segunda calibração sai em 512 pontos (bordas dentro do papel)', !!cal2 && cal2.larguraPontos === 512 && readFileSync(cal2.png).readUInt32BE(16) === 512)
  ok('Assistente antigo nunca recebe calibração', ANTIGO.impressos().every((i) => i.tipo === 'ficha_cozinha'))

  secao('"Somente Caixa": Recibo/Extrato no Beta, cozinha no 0.1.23')
  ok('muda para "Somente Caixa"', (await modo('caixa')).status === 200)
  const c1 = await lancar()
  const pend = await api(pAt, `/api/admin/comandas/${balcao}/pre-conta`, 'POST', { chave: uuid() })
  ok('Recibo/Extrato pendente pedido', pend.status === 201, pend.json?.error)
  const rPend = await aguardar(() => BETA.impressos().find((i) => i.tipo === 'pre_conta'))
  ok('Recibo/Extrato pendente sai no Beta, POS-8370 em 512 pontos', !!rPend && rPend.impressora === 'POS-8370' && rPend.larguraPontos === 512 && readFileSync(rPend.png).readUInt32BE(16) === 512)
  ok('conta real no layout do Beta: RECIBO/EXTRATO, Restante a pagar, status A receber; sem frases de teste nem marcadores', !!rPend && rPend.tipo === 'pre_conta' && ['RECIBO/EXTRATO', 'Restante a pagar', 'Status  A receber'].every((t) => rPend.texto.includes(t)) && !rPend.texto.includes('TESTE DE IMPRESSÃO'))
  const pago = (await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Cliente Pago Beta', chave: uuid() })).json.id
  // Também é ficha de cozinha: entra na conta de 'impressa exatamente uma vez'.
  criados.push((await api(pAt, '/api/admin/pdv/lancamento', 'POST', { comandaId: pago, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 2, complementos: [] }] })).json.id)
  const restante = (await api(pAt, `/api/admin/comandas/${pago}`)).json.conta.totais.restante
  await api(pAt, `/api/admin/comandas/${pago}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: restante, chave: uuid() })
  const rp = await api(pAt, `/api/admin/comandas/${pago}/pre-conta`, 'POST', { chave: uuid() })
  const rPago = await aguardar(() => BETA.impressos().filter((i) => i.tipo === 'pre_conta').find((i) => i.texto.includes('Cliente Pago Beta')))
  ok('Recibo/Extrato de conta paga: Já pago, restante R$ 0,00 e status Pago', rp.status === 201 && !!rPago && rPago.texto.includes('Já pago') && rPago.texto.includes('Restante a pagar  R$ 0,00') && rPago.texto.includes('Status  Pago'), rp.json?.error)
  ok('"Somente Caixa": ficha nova no 0.1.23', !!(await aguardar(() => ANTIGO.fichas().includes(c1))))
  ok('"Somente Caixa": nenhuma ficha no Beta', BETA.fichas().length === 0)
  ok('0.1.23 nunca recebe Recibo/Extrato', ANTIGO.impressos().every((i) => i.tipo === 'ficha_cozinha'))

  secao('Logo da loja no Recibo/Extrato do Beta (WebP transparente → navegador → Storage → Beta)')
  const storage = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } }).storage.from('cardapio')
  logoOriginal = (await um('select logo_url from restaurantes where id=$1', [loja])).logo_url
  const caminhoLogo = `${loja}/perfil/logo-e2e-beta.webp`
  await storage.upload(caminhoLogo, readFileSync('printer-agent/test/logos/vertical.webp'), { contentType: 'image/webp', upsert: true })
  await db.query('update restaurantes set logo_url=$2 where id=$1', [loja, `${API_URL}/storage/v1/object/public/cardapio/${caminhoLogo}`])
  await pGer.goto(`${BASE}/admin/impressao`, { waitUntil: 'domcontentloaded' })
  await pGer.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 3000 }).catch(() => {})
  ok('página Impressão prepara a logo de impressão no navegador', !!(await aguardar(async () => (await api(pGer, '/api/admin/impressao/logo')).json?.pronta)))

  secao('Recibo/Extrato de teste (renderizador operacional, 80 mm calibrada e 58 mm)')
  const pedidosAntes = Number((await um('select count(*) n from pedidos where restaurante_id=$1', [loja])).n)
  const kRt = uuid()
  const [e1, e2] = await Promise.all([
    api(pGer, `/api/admin/impressao/dispositivos/${disp['POS-8370'].id}`, 'POST', { acao: 'recibo_teste', chave: kRt }),
    api(pGer, `/api/admin/impressao/dispositivos/${disp['POS-8370'].id}`, 'POST', { acao: 'recibo_teste', chave: kRt }),
  ])
  ok('clique duplo: um trabalho só', !!e1.json?.id && e1.json.id === e2.json?.id)
  const rt80 = await aguardar(() => BETA.impressos().find((i) => i.tipo === 'recibo_teste'))
  await esperar(4000)
  ok('sai uma vez só, no Beta, na POS-8370, com o perfil de 512 pontos', BETA.impressos().filter((i) => i.tipo === 'recibo_teste').length === 1 &&
    !!rt80 && rt80.impressora === 'POS-8370' && rt80.larguraPontos === 512)
  ok('marcado como teste, com R$ 4.088,00', !!rt80 && ['TESTE DE IMPRESSÃO', 'SEM VALOR FISCAL', 'R$ 4.088,00', 'Taxa de entrega'].every((x) => rt80.texto.includes(x)))
  ok('layout do Beta (print-beta.ps1) com a logo da loja baixada pela rota segura', !!rt80 && /^LOGO: \d+x\d+/.test(rt80.logLogo) && /^loja-[0-9a-f]{16}\.png$/.test(rt80.logo ?? ''), `${rt80?.logLogo} · ${rt80?.logo}`)
  await api(pGer, `/api/admin/impressao/dispositivos/${disp['Cozinha Beta'].id}`, 'PATCH', { larguraMm: 58 })
  await api(pGer, `/api/admin/impressao/dispositivos/${disp['Cozinha Beta'].id}`, 'POST', { acao: 'recibo_teste', chave: uuid() })
  const rt58 = await aguardar(() => BETA.impressos().find((i) => i.tipo === 'recibo_teste' && i.paperMm === 58))
  await api(pGer, `/api/admin/impressao/dispositivos/${disp['Cozinha Beta'].id}`, 'PATCH', { larguraMm: 80 })
  const [m80, m58] = await medirPngs([rt80.png, rt58.png])
  ok('80 mm calibrada: bitmap de 512, texto e valores dentro da margem, marcadores nas duas bordas',
    m80.largura === 512 && m80.tintaTextoAte <= 512 - 15 && m80.linhasBordaEsquerda > 20 && m80.linhasBordaDireita > 20, JSON.stringify(m80))
  ok('58 mm padrão: bitmap de 384, texto e valores dentro da margem, marcadores nas duas bordas',
    m58.largura === 384 && m58.tintaTextoAte <= 384 - 11 && m58.linhasBordaEsquerda > 20 && m58.linhasBordaDireita > 20, JSON.stringify(m58))
  ok('Recibo/Extrato de teste não criou pedido', Number((await um('select count(*) n from pedidos where restaurante_id=$1', [loja])).n) === pedidosAntes)
  ok('0.1.23 nunca recebe o Recibo/Extrato de teste', ANTIGO.impressos().every((i) => i.tipo === 'ficha_cozinha'))

  secao('"Cozinha e Caixa": a cozinha passa para o Beta')
  await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'cozinha', dispositivoId: disp['Cozinha Beta'].id })
  const troca = await modo('cozinha_caixa')
  ok('troca confirmada (Beta online)', troca.status === 200 && troca.json?.modo === 'cozinha_caixa', troca.json?.error)
  const k = [await lancar(), await lancar(), await lancar()]
  ok('fichas novas saem no Beta, na impressora da Cozinha', !!(await aguardar(() => k.every((id) => BETA.fichas().includes(id)))) &&
    BETA.impressos().filter((i) => i.tipo === 'ficha_cozinha').every((i) => i.impressora === 'Cozinha Beta'))
  await esperar(4000)
  ok('0.1.23 não imprimiu nenhuma delas', !k.some((id) => ANTIGO.fichas().includes(id)))

  secao('Volta de emergência: "Somente teste"')
  ok('volta para "Somente teste"', (await modo('teste')).status === 200)
  const v = [await lancar(), await lancar()]
  ok('fichas voltam para o 0.1.23 sem reinstalar nada', !!(await aguardar(() => v.every((id) => ANTIGO.fichas().includes(id)))))
  ok('Beta não imprimiu as fichas depois da volta', !v.some((id) => BETA.fichas().includes(id)))

  secao('Beta desligado no meio do "Cozinha e Caixa": nada se perde')
  await aguardar(async () => (await um(`select visto_em > now()-interval '10 seconds' v from impressao_agentes where restaurante_id=$1`, [loja]))?.v, 15000)
  ok('volta para "Cozinha e Caixa"', (await modo('cozinha_caixa')).status === 200)
  await BETA.parar()
  const off = await lancar()
  await esperar(6000)
  ok('com o Beta desligado a ficha espera (nenhum dos dois imprime)', !ANTIGO.fichas().includes(off) && !BETA.fichas().includes(off))
  ok('volta de emergência para "Somente teste"', (await modo('teste')).status === 200)
  ok('ficha que estava esperando sai no 0.1.23', !!(await aguardar(() => ANTIGO.fichas().includes(off))))

  secao('Nenhuma ficha em dobro, nenhuma perdida')
  await esperar(3000)
  const todas = [...ANTIGO.fichas(), ...BETA.fichas()]
  const repetidas = todas.filter((id, i) => todas.indexOf(id) !== i)
  ok(`${criados.length} fichas criadas, cada uma impressa exatamente uma vez`, criados.every((id) => todas.filter((x) => x === id).length === 1) && repetidas.length === 0 && todas.length === criados.length,
    repetidas.length ? `repetidas: ${repetidas.join(',')}` : `0.1.23: ${ANTIGO.fichas().length} · Beta: ${BETA.fichas().length}`)
  ok('todas marcadas como impressas no banco', Number((await um('select count(*) n from pedidos where id = any($1::uuid[]) and impresso', [criados])).n) === criados.length)
  const auditoria = await q(`select acao, dados->>'de' de, dados->>'para' para from eventos_auditoria where restaurante_id=$1 and acao='impressao.modo_alterado' and criado_em >= $2 order by criado_em`, [loja, inicio])
  ok('cada troca de modo auditada (de → para)', auditoria.map((a) => `${a.de}>${a.para}`).join(' ') === 'teste>caixa caixa>cozinha_caixa cozinha_caixa>teste teste>cozinha_caixa cozinha_caixa>teste',
    auditoria.map((a) => `${a.de}>${a.para}`).join(' '))
  ok('log do Beta separado (menuzia-beta-print.log), nada no do antigo', existsSync(join(ART, 'beta-0.2.0', 'saida', 'menuzia-beta-print.log')) &&
    !existsSync(join(ART, 'beta-0.2.0', 'saida', 'menuzia-print.log')))
} catch (e) {
  falhouFeio = e
  console.error(e)
} finally {
  // Cada passo da limpeza com prazo: nada pode prender o teste.
  const comPrazo = (p, ms = 5000) => Promise.race([p, esperar(ms)])
  for (const p of processos) if (p.exitCode === null && p.signalCode === null) { p.kill(); await comPrazo(new Promise((r) => p.once('exit', r))) }
  ok('nenhum processo de agente ficou rodando', processos.every((p) => p.exitCode !== null || p.signalCode !== null))
  await db.query(`update restaurantes set impressao_agente_token=null, impressao_cozinha_por_funcao=false, impressao_beta_liberado=false, impressao_beta_modo='teste',
    impressao_cozinha_transferida_em=null where id=$1`, [loja])
  await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza e2e beta', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
  if (logoOriginal !== undefined) await db.query('update restaurantes set logo_url=$2 where id=$1', [loja, logoOriginal])
  await comPrazo(browser.close())
  await comPrazo(db.end())
}
const difReais = isolamento.diferencas(fotoReaisAntes, isolamento.fotografarReais())
console.log(`\n── Arquivos reais do Assistente 0.1.23 ──`)
ok('log e configuração reais intactos (hash, tamanho e data) durante todo o teste', difReais.length === 0, difReais.join(' | '))
const falhas = res.filter((r) => !r).length + (falhouFeio ? 1 : 0)
console.log(`\nArtefatos: ${ART}`)
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - res.filter((r) => !r).length}/${res.length} verificações passaram${falhouFeio ? ' (interrompido por erro)' : ''}`)
process.exit(falhas ? 1 : 0)
