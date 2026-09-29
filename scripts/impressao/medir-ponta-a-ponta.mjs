/**
 * Mede a impressão de PONTA A PONTA — clique → API → trabalho criado → Assistente pega →
 * desenho → envio → confirmação → tela vê — com o Assistente Beta de verdade (main.js) num
 * agente virtual (scripts/impressao/agente-virtual.cjs), servidor e banco LOCAIS. Nada
 * imprime: o "envio" é virtual (o custo do envio real está em medir-etapas.mjs).
 *
 *   RODADA=antes  AGENTE_COMMIT=b5cbc80  node scripts/impressao/medir-ponta-a-ponta.mjs
 *   RODADA=depois                        node scripts/impressao/medir-ponta-a-ponta.mjs
 *
 * "antes" roda o código do Assistente do commit indicado (pergunta a cada 3 s / 5 s) contra
 * o MESMO servidor; "depois", o código atual (espera longa). 10× cada tipo, quente e frio
 * (Assistente recém-aberto). Saída: tabela + scripts/impressao/medicoes/ponta-<rodada>.json
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const RODADA = process.env.RODADA === 'antes' ? 'antes' : 'depois'
const N = Number(process.env.N) || 10
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const ART = join(tmpdir(), `menuzia-medir-ponta-${RODADA}`)
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const isolamento = createRequire(import.meta.url)('./isolamento-teste.cjs')
isolamento.exigirIsolamento({ temp: ART, pastas: [ART], rotulo: 'medir ponta a ponta' })
rmSync(ART, { recursive: true, force: true })
mkdirSync(ART, { recursive: true })

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const uuid = () => crypto.randomUUID()
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]

// Código do Assistente: o atual ou o do commit "antes".
let SRC = join(process.cwd(), 'printer-agent', 'src')
if (RODADA === 'antes') {
  const commit = process.env.AGENTE_COMMIT || 'b5cbc80'
  SRC = join(ART, 'assistente-antes', 'src')
  mkdirSync(join(SRC, 'renderer'), { recursive: true })
  mkdirSync(join(SRC, 'fonts'), { recursive: true })
  for (const f of execFileSync('git', ['ls-tree', '--name-only', '-r', commit, '--', 'printer-agent/src']).toString().trim().split('\n')) {
    writeFileSync(join(ART, 'assistente-antes', f.replace(/^printer-agent\//, '')), execFileSync('git', ['show', `${commit}:${f}`]))
  }
}

// ── loja de demonstração em "Cozinha e Caixa" com um Beta pareado ────────────
const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes', 'impressao_reservas']) await db.query(`delete from ${t} where restaurante_id=$1`, [loja])
await db.query(`update comandas set status='cancelada', cancelada_motivo='medir impressao', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
await db.query(`update restaurantes set pdv_v2=true, impressao_automatica=true, impressao_cozinha_por_funcao=false, impressao_beta_liberado=true, impressao_beta_modo='teste', impressao_cozinha_transferida_em=null where id=$1`, [loja])
await db.query('update pedidos set impresso=true, reimprimir=false where restaurante_id=$1', [loja])

const diag = { 'Caixa Beta': { nome: 'Caixa Beta', driver: 'POS-80C', dpiX: 203, papelLarguraMm: 80, pontosImprimiveis: 576 }, 'Cozinha Beta': { nome: 'Cozinha Beta', driver: 'POS-80C', dpiX: 203, papelLarguraMm: 80, pontosImprimiveis: 576 } }
let agente = null
function iniciarAgente() {
  const dir = join(ART, 'agente', 'dados')
  const saida = join(ART, 'agente', 'saida')
  mkdirSync(saida, { recursive: true })
  const proc = spawn(process.execPath, ['scripts/impressao/agente-virtual.cjs'], {
    env: { ...process.env, BASE, AGENTE_DIR: dir, AGENTE_SAIDA: saida, AGENTE_IMPRESSORAS: 'Caixa Beta|Cozinha Beta', RENDER: '1', TEMP: saida, TMP: saida,
      AGENTE_SRC: SRC, AGENTE_VARIANTE: 'beta', AGENTE_VERSAO: RODADA === 'antes' ? '0.2.0-beta.6' : '0.2.0-beta.7', AGENTE_DIAG: JSON.stringify(diag) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let buf = ''
  let pronto = false
  const esperando = []
  proc.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1)
      if (l.startsWith('<<PRONTO>>')) pronto = true
      else if (l.startsWith('<<RESP>> ')) esperando.shift()?.(JSON.parse(l.slice(9)))
    }
  })
  proc.stderr.on('data', () => {})
  const temposArq = join(saida, 'menuzia-beta-tempos.jsonl')
  return {
    proc,
    pronto: () => pronto,
    cmd: (o) => new Promise((r) => { esperando.push(r); proc.stdin.write(JSON.stringify(o) + '\n') }),
    tempos: () => (existsSync(temposArq) ? readFileSync(temposArq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    parar: () => new Promise((r) => { if (proc.exitCode !== null) return r(); proc.once('exit', r); proc.kill() }),
  }
}
async function aguardar(fn, ms = 30000, passo = 25) {
  const fim = Date.now() + ms
  while (Date.now() < fim) { const v = await fn(); if (v) return v; await esperar(passo) }
  return null
}

const browser = await chromium.launch()
const ctx = await browser.newContext()
const pagina = await ctx.newPage()
await pagina.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await pagina.fill('input[name="email"]', 'gerente.local')
await pagina.fill('input[name="password"]', SENHA)
await Promise.all([pagina.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), pagina.click('button[type="submit"]')])
const api = (url, metodo = 'GET', corpo) => pagina.evaluate(async ({ url, metodo, corpo }) => {
  const t = performance.now()
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  let json = null
  try { json = await r.json() } catch { /* sem corpo */ }
  return { status: r.status, json, ms: performance.now() - t }
}, { url: `${BASE}${url}`, metodo, corpo })

agente = iniciarAgente()
await aguardar(() => agente.pronto(), 20000, 200)
const codigo = (await api('/api/admin/impressao/pareamento', 'POST')).json.codigo
await agente.cmd({ cmd: 'parear', codigo, nome: 'PC Medir' })
const disp = await aguardar(async () => {
  const r = await q('select id, nome_sistema from impressao_dispositivos where restaurante_id=$1', [loja])
  return r.length === 2 ? Object.fromEntries(r.map((d) => [d.nome_sistema, d.id])) : null
}, 30000, 200)
await api('/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: disp['Caixa Beta'] })
await api('/api/admin/impressao/funcoes', 'PUT', { funcao: 'cozinha', dispositivoId: disp['Cozinha Beta'] })
const modo = await api('/api/admin/impressao/modo', 'PUT', { modo: 'cozinha_caixa' })
if (modo.status !== 200) { console.error('não foi possível ligar "Cozinha e Caixa"', modo.json); process.exit(1) }
const AGUA = await um('select id from itens_cardapio where restaurante_id=$1 and nome=$2', [loja, 'Água com Gás'])
const balcao = (await api('/api/admin/balcao/comandas', 'POST', { nome: 'Cliente Medir', chave: uuid() })).json.id
await esperar(3000)

// Intervalo com que a tela confere o estado (PDV): antes 2 s; depois 0,7 s nos primeiros 15 s.
const intervaloTela = (msDesdeClique) => (RODADA === 'antes' ? 2000 : msDesdeClique < 15000 ? 700 : 2000)
function telaVe(msFinal) {
  let t = 0
  while (t < msFinal) t += intervaloTela(t)
  return t
}

/** Uma impressão de trabalho (pré-conta ou teste): tempos por etapa. */
async function medirTrabalho(tipo) {
  const t0 = Date.now()
  const r = tipo === 'pre_conta'
    ? await api(`/api/admin/comandas/${balcao}/pre-conta`, 'POST', { chave: uuid(), reimpressao: true })
    : await api(`/api/admin/impressao/dispositivos/${disp['Caixa Beta']}`, 'POST', { acao: tipo === 'teste' ? 'recibo_teste' : 'cozinha_teste', chave: uuid() })
  const tApi = Date.now() - t0
  const id = r.json?.id ?? (await um(`select id from impressao_trabalhos where restaurante_id=$1 order by criado_em desc limit 1`, [loja]))?.id
  const fim = await aguardar(async () => {
    const j = await um(`select estado, criado_em, reservado_ate, enviado_em, tempos from impressao_trabalhos where id=$1`, [id])
    return j && j.estado !== 'pendente' && j.estado !== 'reservado' ? j : null
  }, 30000)
  const tFinal = Date.now() - t0
  if (!fim) return { erro: 'não terminou em 30 s', apiMs: tApi }
  const pegou = new Date(fim.reservado_ate ?? fim.enviado_em).getTime() - 60_000 - new Date(fim.criado_em).getTime()
  return {
    apiMs: tApi,
    esperaMs: Math.max(0, pegou),
    logoMs: fim.tempos?.logoMs ?? null,
    desenhoMs: fim.tempos?.desenhoMs ?? null,
    envioMs: fim.tempos?.envioMs ?? null,
    confirmacaoMs: null,
    totalMs: tFinal,
    telaMs: telaVe(tFinal),
    estado: fim.estado,
  }
}

/** Comanda automática de um pedido novo (lançamento no PDV). */
async function medirComanda() {
  const antes = agente.tempos().length
  const t0 = Date.now()
  const r = await api('/api/admin/pdv/lancamento', 'POST', { comandaId: balcao, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }] })
  const tApi = Date.now() - t0
  const pedidoId = r.json?.id
  const ok = await aguardar(async () => (await um('select impresso from pedidos where id=$1', [pedidoId]))?.impresso === true, 30000)
  const tFinal = Date.now() - t0
  if (!ok) return { erro: 'não imprimiu em 30 s', apiMs: tApi }
  const t = agente.tempos().slice(antes).find((x) => x.id === pedidoId) ?? {}
  return { apiMs: tApi, esperaMs: null, logoMs: t.logoMs ?? null, desenhoMs: t.desenhoMs ?? null, envioMs: t.envioMs ?? null, totalMs: tFinal, telaMs: tFinal }
}

const resultado = {}
const tipos = { comanda: medirComanda, pre_conta: () => medirTrabalho('pre_conta'), teste: () => medirTrabalho('teste') }
try {
  for (const [tipo, fn] of Object.entries(tipos)) {
    for (const cond of ['quente', 'frio']) {
      const xs = []
      for (let i = 0; i < N; i++) {
        if (cond === 'frio') {
          await agente.parar()
          agente = iniciarAgente()
          await aguardar(() => agente.pronto(), 20000, 50)
        } else {
          await esperar(300 + Math.random() * 2500) // clique em momento qualquer do ciclo
        }
        xs.push(await fn())
      }
      resultado[`${tipo}/${cond}`] = xs
      const ok = xs.filter((x) => !x.erro)
      const est = (k) => { const v = ok.map((x) => x[k]).filter((n) => typeof n === 'number'); return v.length ? `${Math.round(v.reduce((a, b) => a + b, 0) / v.length)}/${Math.round(Math.max(...v))}` : '—' }
      console.log(`${RODADA.padEnd(6)} ${tipo.padEnd(9)} ${cond.padEnd(6)} n=${ok.length}/${xs.length}  API ${est('apiMs')}  espera ${est('esperaMs')}  logo ${est('logoMs')}  desenho ${est('desenhoMs')}  total ${est('totalMs')}  tela ${est('telaMs')}  (média/máx ms)`)
    }
  }
} finally {
  await agente?.parar()
  await browser.close()
  await db.query(`update restaurantes set impressao_beta_modo='teste' where id=$1`, [loja])
  await db.end()
}
mkdirSync('scripts/impressao/medicoes', { recursive: true })
writeFileSync(`scripts/impressao/medicoes/ponta-${RODADA}.json`, JSON.stringify({ em: new Date().toISOString(), N, resultado }, null, 2))
