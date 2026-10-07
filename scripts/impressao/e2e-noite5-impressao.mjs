/**
 * E2E — impressão da noite 5 (item 6). Stack LOCAL, loja de demonstração (cantina-demo).
 *   a) modo misto: a API não deixa mais ESCOLHER "Somente Caixa"; loja antiga que já está nele
 *      continua igual; a tela mostra "Modo misto" e, com o antigo desligado, em vermelho;
 *   b) envio automático: impressora aceita "auto"; o Assistente informa o caminho usado e o
 *      painel mostra; caminho inválido/sem credencial recusado;
 *   c) pareamento sem código: convite de 24 h no link menuzia://, uso único, vencido recusado;
 *      o código de 8 letras continua valendo; o instalador "já conectado" só com o beta.10;
 *   compatibilidade: Assistente beta.9 (sem convite/caminho) continua pareando por código e
 *   recebendo o perfil; "auto" para ele = driver (printer.js antigo trata valor desconhecido
 *   como driver).
 *
 *   node scripts/impressao/e2e-noite5-impressao.mjs [prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? '.shots/noite5-impressao'
mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const antes = await um(`select impressao_beta_liberado, impressao_beta_modo, impressao_ativar_assistente, impressao_agente_visto_em, impressao_cozinha_por_funcao from restaurantes where id=$1`, [loja])
for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes']) {
  await db.query(`delete from ${t} where restaurante_id=$1`, [loja])
}
await db.query(`update restaurantes set impressao_beta_liberado=true, impressao_beta_modo='teste', impressao_cozinha_por_funcao=false where id=$1`, [loja])

const agente = (credencial, url, corpo, versao = '0.2.0-beta.10') => fetch(`${BASE}${url}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credencial}`, 'X-Agente-Versao': versao }, body: JSON.stringify(corpo),
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))
const parear = (corpo) => fetch(`${BASE}/api/agente/parear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'gerente.local'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  const api = (url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
    const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) }
  }, { url, metodo, corpo })

  secao('c) pareamento sem código')
  const c1 = await api('/api/admin/impressao/convite', 'POST')
  const convite = c1.json?.link?.match(/^menuzia:\/\/parear\?c=([A-Z0-9]{24})$/)?.[1]
  ok('painel gera o link menuzia://parear com convite de 24 caracteres', c1.status === 201 && !!convite, JSON.stringify(c1))
  const horas = c1.json?.expiraEm ? (new Date(c1.json.expiraEm).getTime() - Date.now()) / 3_600_000 : 0
  ok('convite vale 24 h', horas > 23.9 && horas <= 24, String(horas))
  const pc1 = await parear({ convite, nome: 'PC Convite', versao: '0.2.0-beta.10' })
  ok('Assistente troca o convite pela credencial (sem código)', pc1.status === 201 && /^mza_ag_/.test(pc1.json?.credencial ?? ''), JSON.stringify(pc1.json).slice(0, 120))
  const cred = pc1.json?.credencial
  ok('convite é de uso único (segunda vez recusada)', (await parear({ convite, nome: 'PC Outro', versao: '0.2.0-beta.10' })).status >= 400)
  const c2 = await api('/api/admin/impressao/convite', 'POST')
  const convite2 = c2.json?.link?.split('c=')[1]
  await db.query(`update impressao_pareamentos set expira_em = now() - interval '1 minute' where restaurante_id=$1 and usado_em is null`, [loja])
  ok('convite vencido recusado', (await parear({ convite: convite2, nome: 'PC Vencido', versao: '0.2.0-beta.10' })).status >= 400)
  const cod = await api('/api/admin/impressao/pareamento', 'POST')
  const pc2 = await parear({ codigo: cod.json?.codigo, nome: 'PC Beta9', versao: '0.2.0-beta.9' })
  ok('código de 8 letras continua valendo (Assistente beta.9)', pc2.status === 201 && !!pc2.json?.credencial, JSON.stringify(pc2.json).slice(0, 120))
  const inst = await api('/api/admin/impressao/instalador', 'POST')
  ok('instalador "já conectado" só com o link do beta.10 (hoje 409)', inst.status === 409 && inst.json?.codigo === 'versao_sem_convite', JSON.stringify(inst))
  const aud = await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao='impressao.convite_gerado'`, [loja])
  ok('convite gerado fica na auditoria (sem o valor)', aud.n >= 2)
  const vaz = await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and dados::text like $2`, [loja, `%${convite}%`])
  ok('o convite nunca vai para a auditoria', vaz.n === 0)

  secao('b) envio automático e caminho usado')
  const desc = await agente(cred, '/api/agente/impressoras', { impressoras: ['POS-80C', 'Microsoft Print to PDF'], diagnosticos: { 'POS-80C': { driver: 'POS-80C', porta: 'USB001' } } })
  ok('Assistente informa as impressoras', desc.status === 200, JSON.stringify(desc))
  const painel = async () => (await api('/api/admin/impressao/painel')).json
  const pos = (await painel()).dispositivos.find((d) => d.nomeSistema === 'POS-80C')
  ok('impressora nova começa no driver (padrão de sempre)', pos?.envio === 'driver' && pos.envioCaminho === null, JSON.stringify(pos).slice(0, 200))
  const pa = await api(`/api/admin/impressao/dispositivos/${pos.id}`, 'PATCH', { envio: 'auto' })
  ok('gerente escolhe "Automático"', pa.status === 200, JSON.stringify(pa))
  ok('envio inválido recusado', (await api(`/api/admin/impressao/dispositivos/${pos.id}`, 'PATCH', { envio: 'xpto' })).status === 400)
  const visto = (await painel()).dispositivos.find((d) => d.id === pos.id)
  ok('painel mostra o envio automático', visto?.envio === 'auto')
  const cam = await agente(cred, '/api/agente/caminho', { nomeSistema: 'POS-80C', caminho: 'raw_fila', obs: 'automático: driver de térmica (POS-80C)' })
  ok('Assistente informa o caminho usado', cam.status === 200, JSON.stringify(cam))
  const depois = (await painel()).dispositivos.find((d) => d.id === pos.id)
  ok('painel mostra "direto pela fila" com o motivo e a hora', depois?.envioCaminho === 'raw_fila' && /térmica/.test(depois.envioCaminhoObs ?? '') && !!depois.envioCaminhoEm, JSON.stringify(depois).slice(0, 300))
  ok('caminho inválido recusado', (await agente(cred, '/api/agente/caminho', { nomeSistema: 'POS-80C', caminho: 'auto' })).status === 400)
  const semCred = await fetch(`${BASE}/api/agente/caminho`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nomeSistema: 'POS-80C', caminho: 'driver' }) })
  ok('sem credencial: 401', semCred.status === 401)
  // Outro computador não mexe na impressora deste.
  await agente(pc2.json.credencial, '/api/agente/caminho', { nomeSistema: 'POS-80C', caminho: 'driver' })
  ok('outro computador não altera o caminho desta impressora', (await um(`select envio_caminho from impressao_dispositivos where id=$1`, [pos.id])).envio_caminho === 'raw_fila')
  // Perfil que o Assistente recebe com o trabalho: 'auto' segue como 'auto' (beta.10 decide; beta.9 = driver).
  await api('/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: pos.id, confirmarCompartilhada: true })
  await api(`/api/admin/impressao/dispositivos/${pos.id}`, 'POST', { acao: 'teste', chave: crypto.randomUUID() })
  const trab = await fetch(`${BASE}/api/agente/trabalhos`, { headers: { Authorization: `Bearer ${cred}`, 'X-Agente-Versao': '0.2.0-beta.10' } }).then((r) => r.json()).catch(() => null)
  const t = (trab?.trabalhos ?? [])[0]
  ok('trabalho chega ao Assistente com envio "auto"', t?.envio === 'auto', JSON.stringify(trab).slice(0, 200))

  secao('a) modo misto')
  const recusa = await api('/api/admin/impressao/modo', 'PUT', { modo: 'caixa' })
  ok('escolher o modo misto ("Somente Caixa") é recusado', recusa.status === 400 && recusa.json?.codigo === 'modo_misto_descontinuado', JSON.stringify(recusa))
  await q(`select public.impressao_modo_definir($1, 'caixa', null, 'Loja antiga (e2e)')`, [loja])
  ok('loja antiga no modo misto: repetir o modo continua aceito', (await api('/api/admin/impressao/modo', 'PUT', { modo: 'caixa' })).status === 200)
  await db.query(`update restaurantes set impressao_ativar_assistente=false where id=$1`, [loja])
  await p.goto(`${BASE}/admin/impressao`, { waitUntil: 'load' })
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 4000 }).catch(() => {})
  const aviso = p.getByTestId('aviso-so-caixa')
  await aviso.waitFor({ timeout: 15000 }).catch(() => {})
  const texto = (await aviso.innerText().catch(() => '')) || ''
  ok('tela diz "Modo misto" com todas as letras', /Modo misto/.test(texto) && /comanda da cozinha/i.test(texto), texto)
  ok('antigo desativado: aviso diz que a comanda não está saindo', /desativado/.test(texto) && /não está saindo/.test(texto), texto)
  ok('botão "Passar a comanda para o novo"', await p.getByTestId('passar-comanda').isVisible().catch(() => false))
  await aviso.scrollIntoViewIfNeeded().catch(() => {})
  await p.screenshot({ path: join(PRINTS, 'modo-misto-1366.png') })
  // Computador conectado aparece pelo nome no bloco do computador.
  const bloco = await p.getByTestId('bloco-computador').innerText().catch(() => '')
  ok('bloco do computador lista o computador conectado', /PC Convite|PC Beta9/.test(bloco), bloco.slice(0, 200))
  await ctx.close()
} catch (e) {
  ok('execução sem exceção', false, String(e?.stack ?? e).slice(0, 500))
} finally {
  await browser.close()
  for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes']) {
    await db.query(`delete from ${t} where restaurante_id=$1`, [loja]).catch(() => {})
  }
  await db.query(`update restaurantes set impressao_beta_liberado=$2, impressao_beta_modo=$3, impressao_ativar_assistente=$4, impressao_agente_visto_em=$5, impressao_cozinha_por_funcao=$6 where id=$1`,
    [loja, antes.impressao_beta_liberado, antes.impressao_beta_modo, antes.impressao_ativar_assistente, antes.impressao_agente_visto_em, antes.impressao_cozinha_por_funcao])
  await db.end()
}
const passou = res.filter(Boolean).length
console.log(`\n${passou === res.length ? '✅' : '❌'} ${passou}/${res.length} verificações passaram`)
process.exit(passou === res.length ? 0 : 1)
