/**
 * Teste MÍNIMO pela fila real do Windows — Assistente Beta (build TESTE LOCAL) + impressora
 * virtual "Microsoft Print to PDF" (porta PORTPROMPT: a pessoa salva cada arquivo).
 * Servidor e banco LOCAIS, loja de demonstração; nada em produção.
 *
 *   node scripts/seguranca/spooler-beta-local.mjs preparar <pasta>   # loja, logo, código
 *   (pareamento do Beta aberto: scripts/impressao/parear-beta-uia.ps1 -Codigo …)
 *   node scripts/seguranca/spooler-beta-local.mjs rodar <pasta>      # os 4 trabalhos
 *   node scripts/seguranca/spooler-beta-local.mjs limpar <pasta>
 *
 * Os 4 trabalhos: página de calibração, Recibo/Extrato de teste (80 mm), ficha de cozinha de
 * um pedido controlado e Recibo/Extrato real dessa conta. Para cada um: fila do Windows
 * (fila-windows-monitor.ps1), estado no servidor, PDF criado, aberto e comparado.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import pg from 'pg'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const require = createRequire(import.meta.url)
const [, , fase, pastaArg] = process.argv
const PASTA = resolve(pastaArg ?? 'spooler-beta-local')
mkdirSync(PASTA, { recursive: true })
const BASE = 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const IMPRESSORA = 'Microsoft Print to PDF'
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const estadoArq = join(PASTA, 'estado.json')
const guardar = (o) => writeFileSync(estadoArq, JSON.stringify({ ...(existsSync(estadoArq) ? JSON.parse(readFileSync(estadoArq, 'utf8')) : {}), ...o }, null, 1))
const lerEstado = () => JSON.parse(readFileSync(estadoArq, 'utf8'))
const res = []
const ok = (n, p, d) => { res.push(p); console.log(`   ${p ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const uuid = () => crypto.randomUUID()

const browser = await chromium.launch()
async function logar(u) {
  const p = await (await browser.newContext()).newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', u)
  await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((x) => x.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  return p
}
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  let json = null; try { json = await r.json() } catch { /* */ }
  return { status: r.status, json }
}, { url: `${BASE}${url}`, metodo, corpo })

// PDFs novos onde a pessoa costuma salvar.
const PASTAS_PDF = ['Downloads', 'Documents', 'Desktop', 'OneDrive/Documentos', 'OneDrive/Área de Trabalho', 'OneDrive/Desktop'].map((d) => join(homedir(), d)).filter(existsSync)
const pdfsDesde = (t) => PASTAS_PDF.flatMap((d) => readdirSync(d).filter((f) => f.toLowerCase().endsWith('.pdf')).map((f) => join(d, f))).filter((f) => statSync(f).mtimeMs > t)

try {
  if (fase === 'preparar') {
    for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes', 'impressao_reservas']) await db.query(`delete from ${t} where restaurante_id=$1`, [loja])
    await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza teste spooler', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
    await db.query('update pedidos set impresso=true, reimprimir=false where restaurante_id=$1', [loja])
    const antes = await um('select logo_url, impressao_agente_token, impressao_beta_liberado, impressao_beta_modo from restaurantes where id=$1', [loja])
    guardar({ antes })
    await db.query(`update restaurantes set pdv_v2=true, impressao_automatica=true, impressao_cozinha_por_funcao=false, impressao_agente_token=null,
      impressao_beta_liberado=true, impressao_beta_modo='teste', impressao_cozinha_transferida_em=null where id=$1`, [loja])
    // Logo fictícia da fixture (WebP com transparência — o caminho real: navegador → Storage → Beta).
    const st = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } }).storage.from('cardapio')
    const caminho = `${loja}/perfil/logo-spooler-teste.webp`
    await st.upload(caminho, readFileSync('printer-agent/test/logos/vertical.webp'), { contentType: 'image/webp', upsert: true })
    await db.query('update restaurantes set logo_url=$2 where id=$1', [loja, `${API_URL}/storage/v1/object/public/cardapio/${caminho}`])
    const pGer = await logar('gerente.local')
    await pGer.goto(`${BASE}/admin/impressao`, { waitUntil: 'domcontentloaded' })
    let pronta = false
    for (let i = 0; i < 40 && !pronta; i++) { pronta = !!(await api(pGer, '/api/admin/impressao/logo')).json?.pronta; if (!pronta) await esperar(500) }
    ok('logo de impressão preparada pela página (navegador)', pronta)
    const c = await api(pGer, '/api/admin/impressao/pareamento', 'POST')
    ok('código de pareamento gerado (loja liberada, "Somente teste")', c.status === 201, c.json?.codigo)
    writeFileSync(join(PASTA, 'codigo.txt'), c.json.codigo)
    console.log(`CODIGO=${c.json.codigo}`)
  }

  if (fase === 'rodar') {
    const pGer = await logar('gerente.local')
    const pAt = await logar('atendente.local')
    const disp = await um(`select d.id, d.nome_sistema, d.diagnostico, a.nome agente from impressao_dispositivos d join impressao_agentes a on a.id=d.agente_id
      where d.restaurante_id=$1 and d.nome_sistema=$2 and a.revogado_em is null`, [loja, IMPRESSORA])
    ok('Beta pareado encontrou a impressora virtual do Windows', !!disp, disp ? `${disp.agente} · ${disp.nome_sistema} · driver ${disp.diagnostico?.driver} · ${disp.diagnostico?.dpiX} dpi · papel ${disp.diagnostico?.papelNome}` : '')
    await api(pGer, `/api/admin/impressao/dispositivos/${disp.id}`, 'PATCH', { larguraMm: 80, apelido: 'PDF virtual' })
    const monitor = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/impressao/fila-windows-monitor.ps1', '-Saida', join(PASTA, 'fila.jsonl'), '-Segundos', '2400'], { stdio: 'ignore' })
    const trabalhos = []
    // Um trabalho de cada vez: espera o servidor registrar e a pessoa salvar o PDF.
    async function umTrabalho(rotulo, disparar, confirmar) {
      console.log(`\n── ${rotulo} ──\n   >>> Uma janela "Salvar" vai abrir: salve o PDF (qualquer nome) em Downloads, Documentos ou Área de Trabalho.`)
      const t0 = Date.now()
      const ref = await disparar()
      let pdfs = []
      let confirmado = false
      for (let i = 0; i < 360 && !(confirmado && pdfs.length); i++) {
        confirmado = confirmado || (await confirmar(ref))
        pdfs = pdfsDesde(t0).filter((f) => statSync(f).size > 0)
        if (!(confirmado && pdfs.length)) await esperar(1000)
      }
      await esperar(1500)
      pdfs = pdfsDesde(t0)
      trabalhos.push({ rotulo, ref, t0, t1: Date.now(), pdfs, confirmado })
      ok(`${rotulo}: servidor confirmou (Windows aceitou)`, confirmado)
      ok(`${rotulo}: um PDF salvo`, pdfs.length === 1, pdfs.join(' , '))
      guardar({ trabalhos })
      return ref
    }
    const estado = (id) => um('select estado from impressao_trabalhos where id=$1', [id])
    await umTrabalho('1. Página de calibração', async () => (await api(pGer, `/api/admin/impressao/dispositivos/${disp.id}`, 'POST', { acao: 'calibracao', chave: uuid() })).json.id,
      async (id) => (await estado(id))?.estado === 'enviado_spooler')
    await umTrabalho('2. Recibo/Extrato de teste (80 mm)', async () => (await api(pGer, `/api/admin/impressao/dispositivos/${disp.id}`, 'POST', { acao: 'recibo_teste', chave: uuid() })).json.id,
      async (id) => (await estado(id))?.estado === 'enviado_spooler')
    // Uma impressora só: Cozinha e Caixa nela, com a confirmação explícita do sistema.
    ok('Caixa → PDF virtual', (await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: disp.id })).status === 200)
    const semConf = await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'cozinha', dispositivoId: disp.id })
    ok('Cozinha na mesma impressora sem confirmar: recusado', semConf.json?.codigo === 'confirmar_compartilhada')
    ok('Cozinha → PDF virtual, com confirmação explícita', (await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'cozinha', dispositivoId: disp.id, confirmarCompartilhada: true })).status === 200)
    const modo = await api(pGer, '/api/admin/impressao/modo', 'PUT', { modo: 'cozinha_caixa' })
    ok('modo "Cozinha e Caixa" (local)', modo.status === 200, modo.json?.error)
    const AGUA = await um('select id from itens_cardapio where restaurante_id=$1 and nome=$2', [loja, 'Água com Gás'])
    const conta = (await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'CONTA CONTROLADA TESTE LOCAL', chave: uuid() })).json.id
    guardar({ conta })
    const pedido = await umTrabalho('3. Ficha de cozinha do pedido controlado', async () =>
      (await api(pAt, '/api/admin/pdv/lancamento', 'POST', { comandaId: conta, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 2, complementos: [] }] })).json.id,
    async (id) => (await um('select impresso from pedidos where id=$1', [id]))?.impresso === true)
    await umTrabalho('4. Recibo/Extrato real da conta controlada', async () => (await api(pAt, `/api/admin/comandas/${conta}/pre-conta`, 'POST', { chave: uuid() })).json.id,
      async (id) => (await estado(id))?.estado === 'enviado_spooler')
    writeFileSync(join(PASTA, 'fila.jsonl.PARAR'), '')
    await esperar(1000)
    monitor.kill()

    console.log('\n── Duplicidade ──')
    ok('cada trabalho do Beta existe uma vez no servidor', Number((await um('select count(*) n from impressao_trabalhos where restaurante_id=$1', [loja])).n) === 3)
    ok('ficha da cozinha: pedido impresso, sem reserva sobrando', (await um('select impresso from pedidos where id=$1', [pedido])).impresso === true &&
      Number((await um('select count(*) n from impressao_reservas where pedido_id=$1', [pedido])).n) === 0)
    const todos = trabalhos.flatMap((t) => t.pdfs)
    ok('exatamente 4 PDFs, um por trabalho, nenhum a mais', todos.length === 4 && new Set(todos).size === 4, todos.join(' | '))
    // Fila do Windows: cada trabalho entrou e saiu.
    const fila = readFileSync(join(PASTA, 'fila.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l.replace(/^﻿/, '')))
    const ids = new Map()
    for (const f of fila) for (const j of [].concat(f.trabalhos ?? [])) if (j && j.id !== undefined) ids.set(j.id, j)
    ok(`fila do Windows: ${ids.size} trabalhos passaram pela fila`, ids.size === 4, [...ids.values()].map((j) => `#${j.id} ${j.documento} (${j.estado})`).join(' | '))
    ok('fila do Windows vazia no fim (todos saíram)', [].concat(fila.at(-1)?.trabalhos ?? []).filter(Boolean).length === 0)
    guardar({ trabalhos, fila: [...ids.values()] })
  }

  if (fase === 'limpar') {
    const e = lerEstado()
    await db.query(`update restaurantes set impressao_beta_modo='teste', impressao_cozinha_por_funcao=false, impressao_cozinha_transferida_em=null,
      impressao_beta_liberado=$2, logo_url=$3, impressao_agente_token=$4 where id=$1`, [loja, e.antes.impressao_beta_liberado, e.antes.logo_url, e.antes.impressao_agente_token])
    if (e.conta) await db.query(`update comandas set status='cancelada', cancelada_motivo='fim do teste spooler', fechada_em=now() where id=$1 and status='aberta'`, [e.conta])
    for (const t of ['impressao_funcoes', 'impressao_reservas']) await db.query(`delete from ${t} where restaurante_id=$1`, [loja])
    await db.query(`update impressao_agentes set revogado_em=now() where restaurante_id=$1 and revogado_em is null`, [loja])
    const st = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } }).storage.from('cardapio')
    const imp = (await st.list(`${loja}/impressao`)).data?.map((f) => `${loja}/impressao/${f.name}`) ?? []
    await st.remove([`${loja}/perfil/logo-spooler-teste.webp`, ...imp])
    ok('loja de demonstração restaurada', true)
  }
} finally {
  await browser.close()
  await db.end()
}
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações`)
process.exit(falhas ? 1 : 0)
