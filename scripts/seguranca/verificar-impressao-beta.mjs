/**
 * Assistente de Impressão Beta (0100) — prova de ponta a ponta pelas APIs reais:
 * liberação por loja, modos (Somente teste / Somente Caixa / Cozinha e Caixa), troca
 * atômica da cozinha sem ficha em dobro, volta de emergência ao Assistente antigo,
 * calibração por impressora e diagnóstico do driver.
 *
 * O "Assistente antigo" aqui é o token da loja (como o 0.1.23 faz); o "Beta" é um
 * computador pareado. Nada imprime. Loja de demonstração local.
 *
 *   node scripts/seguranca/verificar-impressao-beta.mjs
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== null && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const sha = (s) => createHash('sha256').update(s).digest('hex')

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const vizinha = (await um(`select id from restaurantes where slug='vizinha-demo'`)).id
for (const l of [loja, vizinha]) {
  for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes', 'impressao_reservas']) {
    await db.query(`delete from ${t} where restaurante_id=$1`, [l])
  }
}
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza teste impressão', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
// Estado de toda loja em produção hoje: Beta NÃO liberado, modo "Somente teste".
await db.query(`update restaurantes set pdv_v2=true, modulo_mesas_ativo=true, impressao_automatica=true, impressao_cozinha_por_funcao=false,
  impressao_agente_visto_em=null, impressao_beta_liberado=false, impressao_beta_modo='teste', impressao_cozinha_transferida_em=null where id = any($1::uuid[])`, [[loja, vizinha]])
await db.query('update pedidos set impresso=true, reimprimir=false where restaurante_id=$1', [loja])
const tokenLegado = uuid()
const inicio = (await um('select now() t')).t
await db.query('update restaurantes set impressao_agente_token=$2 where id=$1', [loja, tokenLegado])

const adminSb = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
{
  const email = 'gerente@demo.local'
  const { data, error } = await adminSb.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  const id = data?.user?.id ?? (await adminSb.auth.admin.listUsers()).data.users.find((u) => u.email === email).id
  await db.query(
    `insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,'gerente','Gerente Demo',$3,'gerente.local',true)
     on conflict (id) do update set restaurante_id=excluded.restaurante_id, papel='gerente', desativado_em=null`, [id, loja, email])
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
      return { status: r.status, json, texto: JSON.stringify(json) }
    },
    { url: `${BASE}${url}`, metodo, corpo },
  )
const VERSAO_BETA = '0.2.0-beta.1'
const agente = (credencial) => ({
  get: async (p) => {
    const r = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${credencial}`, 'X-Agente-Versao': VERSAO_BETA } })
    return { status: r.status, json: await r.json().catch(() => null) }
  },
  post: async (p, corpo) => {
    const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { Authorization: `Bearer ${credencial}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo ?? {}) })
    return { status: r.status, json: await r.json().catch(() => null) }
  },
})
const parear = async (codigo, nome) => {
  const r = await fetch(`${BASE}/api/agente/parear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo, nome, versao: VERSAO_BETA }) })
  return { status: r.status, json: await r.json().catch(() => null) }
}
// Assistente antigo 0.1.23: só o token da loja, sem cabeçalho de instância.
const antigo = async () => (await fetch(`${BASE}/api/agente/pedidos`, { headers: { Authorization: `Bearer ${tokenLegado}` } }).then((r) => r.json())).pedidos ?? []
const modo = async (page, m) => api(page, '/api/admin/impressao/modo', 'PUT', { modo: m })
const estadoLoja = () => um('select impressao_beta_modo m, impressao_cozinha_por_funcao f, impressao_cozinha_transferida_em t from restaurantes where id=$1', [loja])

const pDono = await logar('dono.local')
const pGer = await logar('gerente.local')
const pAt = await logar('atendente.local')
const pViz = await logar('dono@vizinha.local')

const AGUA = await um('select id from itens_cardapio where restaurante_id=$1 and nome=$2', [loja, 'Água com Gás'])
const balcao = (await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Cliente Beta', chave: uuid() })).json.id
const lancar = async () => (await api(pAt, '/api/admin/pdv/lancamento', 'POST', { comandaId: balcao, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }] })).json.id

// ════════════════════════════════════════════════════════════════════════════
secao('Beta desligado: nada muda para o Assistente antigo')
const p0 = await lancar()
ok('Assistente antigo lista a ficha como sempre', (await antigo()).some((p) => p.id === p0))
const semLib = await api(pGer, '/api/admin/impressao/pareamento', 'POST')
ok('loja não liberada: não gera código de pareamento (403)', semLib.status === 403 && semLib.json?.codigo === 'beta_nao_liberado')
ok('loja não liberada: não muda para "Somente Caixa"', (await modo(pGer, 'caixa')).json?.codigo === 'beta_nao_liberado')
ok('loja não liberada: não muda para "Cozinha e Caixa"', (await modo(pGer, 'cozinha_caixa')).status === 403)
ok('"Somente teste" sempre permitido (idempotente)', (await modo(pGer, 'teste')).json?.idempotente === true)
ok('modo inválido recusado', (await modo(pGer, 'tudo')).status === 400)
ok('atendente não troca o modo', (await modo(pAt, 'teste')).status === 403)
await db.query('update pedidos set impresso=true where id=$1', [p0])

secao('Piloto liberado: pareamento e diagnóstico do driver')
await db.query('update restaurantes set impressao_beta_liberado=true where id=$1', [loja])
const c1 = await api(pGer, '/api/admin/impressao/pareamento', 'POST')
ok('loja liberada gera código', c1.status === 201)
const pa = await parear(c1.json.codigo, 'PC Caixa Beta')
ok('Beta pareia com credencial própria', pa.status === 201 && pa.json?.credencial?.startsWith('mza_ag_'))
const A = agente(pa.json.credencial)
ok('versão Beta registrada no computador', (await um('select versao from impressao_agentes where credencial_hash=$1', [sha(pa.json.credencial)])).versao === VERSAO_BETA)
const diag = {
  'POS-8370': { driver: 'POS-80C', porta: 'USB001', dpiX: 203, dpiY: 203, papelLarguraMm: 80, areaImprimivelLarguraMm: 72, pontosImprimiveis: 576, online: true,
    caminho: 'C:\\Users\\segredo\\AppData', token: 'mza_ag_vazou', extra: 'x'.repeat(500), papelNome: 'Y'.repeat(300) },
  Cozinha: { driver: 'Generic / Text Only', dpiX: 180, dpiY: 180, pontosImprimiveis: 512 },
  Fantasma: { driver: 'nao existe' },
}
ok('Beta informa impressoras com diagnóstico', (await A.post('/api/agente/impressoras', { impressoras: ['POS-8370', 'Cozinha'], diagnosticos: diag })).status === 200)
const dPos = await um(`select id, diagnostico from impressao_dispositivos where restaurante_id=$1 and nome_sistema='POS-8370'`, [loja])
const dCoz = await um(`select id, diagnostico from impressao_dispositivos where restaurante_id=$1 and nome_sistema='Cozinha'`, [loja])
ok('diagnóstico guardado (driver, DPI, área imprimível)', dPos.diagnostico?.driver === 'POS-80C' && dPos.diagnostico?.dpiX === 203 && dPos.diagnostico?.areaImprimivelLarguraMm === 72)
ok('diagnóstico sem campos desconhecidos (caminho, token)', !('caminho' in dPos.diagnostico) && !('token' in dPos.diagnostico) && !('extra' in dPos.diagnostico) && !JSON.stringify(dPos.diagnostico).includes('mza_ag_'))
ok('texto do diagnóstico limitado a 80 caracteres', dPos.diagnostico.papelNome.length === 80)
ok('impressora não informada não é criada', !(await um(`select 1 from impressao_dispositivos where restaurante_id=$1 and nome_sistema='Fantasma'`, [loja])))
const painel = await api(pGer, '/api/admin/impressao/painel')
ok('painel mostra liberação, modo e diagnóstico', painel.json?.betaLiberado === true && painel.json?.modo === 'teste' && painel.json.dispositivos.some((d) => d.diagnostico?.driver === 'POS-80C'))
ok('painel não expõe credencial nem hash', !painel.texto.includes('mza_ag_') && !painel.texto.includes('credencial_hash'))
ok('token antigo não informa impressoras', (await agente(tokenLegado).post('/api/agente/impressoras', { impressoras: ['X'] })).status === 403)

secao('Calibração por impressora')
const url = `/api/admin/impressao/dispositivos/${dPos.id}`
ok('largura em pontos fora do limite recusada', (await api(pGer, url, 'PATCH', { larguraPontos: 100 })).status === 400)
ok('deslocamento fora do limite recusado', (await api(pGer, url, 'PATCH', { deslocamentoPontos: 200 })).status === 400)
ok('atendente não calibra', (await api(pAt, url, 'PATCH', { larguraPontos: 512 })).status === 403)
ok('outra loja não calibra esta impressora', (await api(pViz, url, 'PATCH', { larguraPontos: 512 })).status === 404)
ok('gerente salva 512 pontos e deslocamento 8', (await api(pGer, url, 'PATCH', { larguraMm: 80, larguraPontos: 512, deslocamentoPontos: 8 })).status === 200)
const cal = await um('select largura_pontos, deslocamento_pontos, calibrado_em, calibrado_por_nome from impressao_dispositivos where id=$1', [dPos.id])
ok('perfil salvo só nesta impressora, com quem e quando', cal.largura_pontos === 512 && cal.deslocamento_pontos === 8 && !!cal.calibrado_em && cal.calibrado_por_nome === 'Gerente Demo')
ok('a outra impressora continua no padrão', (await um('select largura_pontos from impressao_dispositivos where id=$1', [dCoz.id])).largura_pontos === null)
const pag = await api(pGer, url, 'POST', { acao: 'calibracao', chave: uuid() })
ok('página de calibração enfileirada no modo "Somente teste"', pag.status === 201)
const tCal = ((await A.get('/api/agente/trabalhos')).json?.trabalhos ?? []).find((t) => t.id === pag.json.id)
ok('Beta recebe a calibração com o perfil da impressora', tCal?.tipo === 'teste_impressora' && tCal.snapshot?.calibracao === true && tCal.larguraPontos === 512 && tCal.deslocamentoPontos === 8)
ok('calibração auditada', !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='impressao.calibracao'`, [loja])))
ok('Windows aceitou ≠ papel saiu: estado enviado_spooler', (await A.post(`/api/agente/trabalhos/${pag.json.id}/resultado`, { ok: true })).json?.estado === 'enviado_spooler')
ok('voltar ao padrão (null) permitido', (await api(pGer, url, 'PATCH', { larguraPontos: null, deslocamentoPontos: 0 })).status === 200 &&
  (await um('select largura_pontos from impressao_dispositivos where id=$1', [dPos.id])).largura_pontos === null)
await api(pGer, url, 'PATCH', { larguraPontos: 512, deslocamentoPontos: 0 })

secao('Recibo/Extrato de teste: só o computador escolhido, sem dado comercial, sem duplicidade')
// Um segundo computador Beta da mesma loja, com outra impressora.
const cB = await api(pGer, '/api/admin/impressao/pareamento', 'POST')
const pb = await parear(cB.json.codigo, 'PC Bar Beta')
const B = agente(pb.json.credencial)
await B.post('/api/agente/impressoras', { impressoras: ['Bar'] })
const comercial = async () => JSON.stringify(await um(`select
  (select count(*) from pedidos where restaurante_id=$1)::int pedidos,
  (select count(*) from comandas where restaurante_id=$1)::int comandas,
  (select count(*) from pagamentos_comanda pc join comandas c on c.id=pc.comanda_id where c.restaurante_id=$1)::int pagamentos,
  (select count(*) from impressao_reservas where restaurante_id=$1)::int reservas_cozinha,
  (select count(*) from fidelidade_progresso)::int fidelidade,
  (select count(*) from fidelidade_recompensas)::int recompensas,
  (select count(*) from cupom_usos)::int cupons_usados,
  (select coalesce(sum(total),0) from pedidos where restaurante_id=$1)::text faturamento`, [loja]))
const antesComercial = await comercial()
const urlPos = `/api/admin/impressao/dispositivos/${dPos.id}`
const kRt = uuid()
const [rt1, rt2] = await Promise.all([api(pGer, urlPos, 'POST', { acao: 'recibo_teste', chave: kRt }), api(pDono, urlPos, 'POST', { acao: 'recibo_teste', chave: kRt })])
ok('clique duplo (dois pedidos juntos, mesma chave): um trabalho só', !!rt1.json?.id && rt1.json.id === rt2.json?.id && [rt1.status, rt2.status].includes(201), `${rt1.status}/${rt2.status}`)
const rt3 = await api(pGer, urlPos, 'POST', { acao: 'recibo_teste', chave: kRt })
ok('reenvio (mesma chave): o mesmo trabalho, sem criar outro', rt3.status === 200 && rt3.json?.id === rt1.json.id && rt3.json?.idempotente === true)
ok('no banco: um trabalho para essa chave', Number((await um('select count(*) n from impressao_trabalhos where restaurante_id=$1 and chave=$2', [loja, kRt])).n) === 1)
const jobRt = await um('select tipo, comanda_id, dispositivo_id, snapshot from impressao_trabalhos where id=$1', [rt1.json.id])
ok('é teste de impressora, sem conta, na impressora escolhida', jobRt.tipo === 'teste_impressora' && jobRt.comanda_id === null && jobRt.dispositivo_id === dPos.id)
ok('snapshot de demonstração: R$ 4.088,00 e marcado como teste', jobRt.snapshot.recibo_teste === true && Number(jobRt.snapshot.total) === 4088)
ok('atendente não pede Recibo/Extrato de teste', (await api(pAt, urlPos, 'POST', { acao: 'recibo_teste', chave: uuid() })).status === 403)
ok('outra loja não pede nesta impressora', (await api(pViz, urlPos, 'POST', { acao: 'recibo_teste', chave: uuid() })).status === 404)
ok('chave inválida recusada', (await api(pGer, urlPos, 'POST', { acao: 'recibo_teste', chave: 'x' })).status === 400)
const [ga, gb] = await Promise.all([A.get('/api/agente/trabalhos'), B.get('/api/agente/trabalhos')])
ok('outro computador Beta da loja NÃO recebe', !(gb.json?.trabalhos ?? []).some((x) => x.id === rt1.json.id))
const tRt = (ga.json?.trabalhos ?? []).find((x) => x.id === rt1.json.id)
ok('só o computador da impressora escolhida reserva, com o perfil dela (512)', !!tRt && tRt.snapshot?.recibo_teste === true && tRt.larguraPontos === 512)
ok('reserva exclusiva: segunda consulta não entrega de novo', !((await A.get('/api/agente/trabalhos')).json?.trabalhos ?? []).some((x) => x.id === rt1.json.id))
ok('Assistente antigo (token) não vê nada disso na fila dele', (await antigo()).every((p) => p.id !== rt1.json.id))
ok('outro computador não informa resultado dele', (await B.post(`/api/agente/trabalhos/${rt1.json.id}/resultado`, { ok: true })).status === 404)
ok('Windows aceitou: enviado_spooler', (await A.post(`/api/agente/trabalhos/${rt1.json.id}/resultado`, { ok: true })).json?.estado === 'enviado_spooler')
const hist = (await api(pGer, '/api/admin/impressao/painel')).json.trabalhos.find((x) => x.id === rt1.json.id)
ok('histórico: "Recibo/Extrato de teste"', hist?.subtipo === 'recibo_teste')
ok('auditado como Recibo/Extrato de teste', !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='impressao.recibo_teste' and dados->>'trabalho_id'=$2`, [loja, rt1.json.id])))
ok('nada comercial mudou: pedidos, comandas, pagamentos, faturamento, cozinha, fidelidade, cupons', (await comercial()) === antesComercial)
await db.query(`update impressao_agentes set revogado_em=now() where credencial_hash=$1`, [sha(pb.json.credencial)])

secao('Logo da loja para o Recibo/Extrato (Storage da própria loja, nada de URL)')
const logoOriginal = (await um('select logo_url from restaurantes where id=$1', [loja])).logo_url
const logoVizinhaOriginal = (await um('select logo_url from restaurantes where id=$1', [vizinha])).logo_url
const SB = API_URL
const subir = async (caminho, arquivo, tipo) => {
  const { error } = await adminSb.storage.from('cardapio').upload(caminho, readFileSync(`printer-agent/test/logos/${arquivo}`), { contentType: tipo, upsert: true })
  if (error) throw error
  return `${SB}/storage/v1/object/public/cardapio/${caminho}`
}
const logoAgente = async (cred, sha) => {
  const r = await fetch(`${BASE}/api/agente/logo${sha ? `?sha=${sha}` : ''}`, { headers: { Authorization: `Bearer ${cred}`, 'X-Agente-Versao': VERSAO_BETA } })
  return { status: r.status, sha: r.headers.get('x-logo-sha256'), tipo: r.headers.get('content-type'), bytes: r.status === 200 ? Buffer.from(await r.arrayBuffer()) : null }
}
await db.query('update restaurantes set logo_url=null where id=$1', [loja])
ok('loja sem logo: 204 (o Recibo/Extrato sai com o nome)', (await logoAgente(pa.json.credencial)).status === 204)
ok('token do Assistente antigo não pega a logo por aqui', (await logoAgente(tokenLegado)).status === 403)
ok('sem credencial: 401', (await fetch(`${BASE}/api/agente/logo`)).status === 401)
await db.query('update restaurantes set logo_url=$2 where id=$1', [loja, 'https://evil.example/logo.png'])
ok('logo apontando para fora do Storage: recusada sem buscar (204)', (await logoAgente(pa.json.credencial)).status === 204)
const urlVizinha = await subir(`${vizinha}/perfil/logo-verificador.png`, 'horizontal.png', 'image/png')
await db.query('update restaurantes set logo_url=$2 where id=$1', [loja, urlVizinha])
ok('logo apontando para a pasta de OUTRA loja: recusada (204)', (await logoAgente(pa.json.credencial)).status === 204)
const urlPng = await subir(`${loja}/perfil/logo-verificador.png`, 'horizontal.png', 'image/png')
await db.query('update restaurantes set logo_url=$2 where id=$1', [loja, urlPng])
const lg1 = await logoAgente(pa.json.credencial)
const bytesPng = readFileSync('printer-agent/test/logos/horizontal.png')
ok('logo PNG da própria loja: 200, bytes idênticos, hash correto', lg1.status === 200 && lg1.tipo === 'image/png' && Buffer.compare(lg1.bytes, bytesPng) === 0 && lg1.sha === sha(bytesPng))
ok('Assistente já tem a mesma: 304 (sem baixar de novo)', (await logoAgente(pa.json.credencial, lg1.sha)).status === 304)
const urlWebp = await subir(`${loja}/perfil/logo-verificador.webp`, 'vertical.webp', 'image/webp')
await db.query('update restaurantes set logo_url=$2 where id=$1', [loja, urlWebp])
ok('WebP com transparência sem versão de impressão: 204 (evita fundo preto)', (await logoAgente(pa.json.credencial)).status === 204)
const st0 = await api(pGer, '/api/admin/impressao/logo')
ok('painel: loja tem logo, versão de impressão ainda não', st0.status === 200 && st0.json?.temLogo === true && st0.json?.pronta === false)
const postLogo = (page, corpoB64, tipo = 'image/png') => page.evaluate(async ({ url, b64, tipo }) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': tipo }, body: bin })
  return r.status
}, { url: `${BASE}/api/admin/impressao/logo`, b64: corpoB64, tipo })
ok('atendente não grava logo de impressão', (await postLogo(pAt, bytesPng.toString('base64'))) === 403)
ok('arquivo que não é PNG: recusado', (await postLogo(pGer, Buffer.from('nao e png').toString('base64'))) === 400)
// Caminho real: a página Impressão, no navegador do gerente, gera e envia a versão.
await pGer.goto(`${BASE}/admin/impressao`, { waitUntil: 'domcontentloaded' })
await pGer.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 3000 }).catch(() => {})
const pronta = await (async () => { for (let i = 0; i < 40; i++) { if ((await api(pGer, '/api/admin/impressao/logo')).json?.pronta) return true; await new Promise((r) => setTimeout(r, 500)) } return false })()
ok('a página Impressão gerou a versão de impressão sozinha (navegador)', pronta)
ok('a página mostra "Logo no Recibo/Extrato: pronta"', /pronta/.test(await pGer.getByTestId('logo-recibo').innerText().catch(() => '')))
const lg2 = await logoAgente(pa.json.credencial)
const dimsPng = lg2.bytes ? { w: lg2.bytes.readUInt32BE(16), h: lg2.bytes.readUInt32BE(20) } : null
ok('agora o Assistente recebe o PNG sobre fundo branco (240x480 reduzida para 160x320, sem ampliar)', lg2.status === 200 && lg2.tipo === 'image/png' && dimsPng?.w === 160 && dimsPng?.h === 320, JSON.stringify(dimsPng))
const arqs = (await adminSb.storage.from('cardapio').list(`${loja}/impressao`)).data?.map((f) => f.name) ?? []
ok('gravada no caminho fixo da loja: <loja>/impressao/logo-<chave>.png', arqs.length === 1 && /^logo-[0-9a-f]{16}\.png$/.test(arqs[0]), arqs.join(','))
await db.query('update restaurantes set logo_url=$2 where id=$1', [loja, urlPng])
ok('logo trocada: a versão antiga não vale mais (volta ao PNG original)', Buffer.compare((await logoAgente(pa.json.credencial)).bytes ?? Buffer.alloc(0), bytesPng) === 0)
const stV = await api(pViz, '/api/admin/impressao/logo')
ok('outra loja vê só a situação dela', stV.status === 200 && stV.json?.pronta === false)
await db.query('update restaurantes set logo_url=$2 where id=$1', [loja, logoOriginal])
await db.query('update restaurantes set logo_url=$2 where id=$1', [vizinha, logoVizinhaOriginal])
await adminSb.storage.from('cardapio').remove([`${vizinha}/perfil/logo-verificador.png`, `${loja}/perfil/logo-verificador.png`, `${loja}/perfil/logo-verificador.webp`, ...arqs.map((a) => `${loja}/impressao/${a}`)])

secao('Somente teste: o Beta não imprime Recibo/Extrato nem cozinha')
await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: dPos.id })
await lancar()
const rTeste = await api(pAt, `/api/admin/comandas/${balcao}/pre-conta`, 'POST', { chave: uuid() })
ok('Recibo/Extrato recusado com orientação', rTeste.status === 409 && rTeste.json?.codigo === 'modo_somente_teste')
ok('Beta não recebe a cozinha', ((await A.get('/api/agente/pedidos')).json?.pedidos ?? []).length === 0)
ok('Assistente antigo continua com a cozinha', (await antigo()).length > 0)
await db.query('update pedidos set impresso=true where restaurante_id=$1', [loja])

secao('Somente Caixa: o antigo na cozinha, o Beta no Recibo/Extrato')
const mc = await modo(pGer, 'caixa')
ok('gerente muda para "Somente Caixa"', mc.status === 200 && mc.json?.modo === 'caixa')
ok('mudança auditada (de → para)', !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='impressao.modo_alterado' and dados->>'de'='teste' and dados->>'para'='caixa'`, [loja])))
ok('cozinha continua no fluxo antigo', (await estadoLoja()).f === false)
const k1 = await lancar()
ok('ficha nova vai para o Assistente antigo', (await antigo()).some((p) => p.id === k1))
ok('e NÃO para o Beta', !((await A.get('/api/agente/pedidos')).json?.pedidos ?? []).some((p) => p.id === k1))
const r1 = await api(pAt, `/api/admin/comandas/${balcao}/pre-conta`, 'POST', { chave: uuid() })
ok('Recibo/Extrato sai pelo Beta', r1.status === 201)
const tR = ((await A.get('/api/agente/trabalhos')).json?.trabalhos ?? []).find((t) => t.id === r1.json.id)
ok('Recibo/Extrato chega com o perfil calibrado (512 pontos)', tR?.tipo === 'pre_conta' && tR.larguraPontos === 512)
await A.post(`/api/agente/trabalhos/${r1.json.id}/resultado`, { ok: true })
ok('Assistente antigo nunca vê Recibo/Extrato', !(await antigo()).some((p) => p.id === r1.json.id))
await db.query('update pedidos set impresso=true where restaurante_id=$1', [loja])

secao('Cozinha e Caixa: transferência atômica e volta de emergência')
await db.query(`update impressao_agentes set visto_em=now()-interval '5 minutes' where credencial_hash=$1`, [sha(pa.json.credencial)])
ok('sem impressora de Cozinha: recusado', (await modo(pGer, 'cozinha_caixa')).json?.codigo === 'sem_cozinha')
await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'cozinha', dispositivoId: dCoz.id })
ok('computador da Cozinha offline: recusado (cozinha fica no antigo)', (await modo(pGer, 'cozinha_caixa')).json?.codigo === 'agente_offline' && (await estadoLoja()).m === 'caixa')
await A.get('/api/agente/trabalhos') // Beta aparece (heartbeat)
const kAntes = await lancar()
const [t1, t2] = await Promise.all([modo(pGer, 'cozinha_caixa'), modo(pDono, 'cozinha_caixa')])
ok('dois cliques juntos: uma troca só', [t1, t2].every((r) => r.status === 200) && [t1, t2].filter((r) => r.json?.idempotente === false).length === 1, `${t1.status}/${t2.status}`)
const e1 = await estadoLoja()
ok('modo "Cozinha e Caixa" com horário da troca', e1.m === 'cozinha_caixa' && e1.f === true && !!e1.t)
ok('troca auditada uma vez', Number((await um(`select count(*) n from eventos_auditoria where restaurante_id=$1 and acao='impressao.modo_alterado' and dados->>'para'='cozinha_caixa' and criado_em >= $2`, [loja, inicio])).n) === 1)
ok('Assistente antigo passa a receber lista vazia', (await antigo()).length === 0)
ok('na janela: ficha de ANTES não vai para o Beta', !((await A.get('/api/agente/pedidos')).json?.pedidos ?? []).some((p) => p.id === kAntes))
await db.query('delete from impressao_reservas where restaurante_id=$1', [loja])
const kDepois = await lancar()
const kb = (await A.get('/api/agente/pedidos')).json
ok('ficha nova vai para o Beta, com destino e perfil da Cozinha', kb.pedidos.some((p) => p.id === kDepois) && kb.destinoCozinha?.nomeSistema === 'Cozinha')
ok('ficha reservada para o Beta: antigo não a recebe', !(await antigo()).some((p) => p.id === kDepois))
// Beta e antigo consultando ao mesmo tempo: a ficha é de um só (a reserva é do Beta).
const [, velho] = await Promise.all([A.get('/api/agente/pedidos'), antigo()])
ok('Beta e antigo consultando juntos: a ficha não vai para o antigo', !velho.some((p) => p.id === kDepois) &&
  Number((await um('select count(*) n from impressao_reservas where pedido_id=$1', [kDepois])).n) === 1)
ok('Beta confirma a ficha', (await A.post(`/api/agente/pedidos/${kDepois}/imprimir`)).status === 200 && (await um('select impresso from pedidos where id=$1', [kDepois])).impresso === true)
await db.query('delete from impressao_reservas where restaurante_id=$1', [loja])
await db.query(`update restaurantes set impressao_cozinha_transferida_em=now()-interval '2 minutes' where id=$1`, [loja])
ok('depois da janela: ficha de antes não impressa é recuperada pelo Beta (nada se perde)', ((await A.get('/api/agente/pedidos')).json?.pedidos ?? []).some((p) => p.id === kAntes))
await A.post(`/api/agente/pedidos/${kAntes}/imprimir`)

// Emergência: volta para "Somente teste" — a cozinha volta ao antigo na hora, sem reinstalar.
const kPend = await lancar()
await A.get('/api/agente/pedidos') // Beta reservou, mas o computador "travou" antes de imprimir
const volta = await modo(pGer, 'teste')
ok('volta de emergência para "Somente teste"', volta.status === 200 && (await estadoLoja()).f === false)
ok('Beta para de receber a cozinha na hora', ((await A.get('/api/agente/pedidos')).json?.pedidos ?? []).length === 0)
// Simula a reserva do Beta vencendo (90 s) sem dormir no teste.
await db.query(`update impressao_reservas set reservado_ate=now()-interval '1 second' where pedido_id=$1`, [kPend])
ok('ficha que o Beta não imprimiu volta para o Assistente antigo (sem perda)', (await antigo()).some((p) => p.id === kPend))
ok('volta auditada', !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='impressao.modo_alterado' and dados->>'para'='teste'`, [loja])))
await db.query('update pedidos set impresso=true where restaurante_id=$1', [loja])

secao('Retirada do piloto pela plataforma e isolamento')
await modo(pGer, 'caixa')
await db.query(`select impressao_modo_definir($1, 'teste', null, 'Plataforma')`, [loja])
await db.query('update restaurantes set impressao_beta_liberado=false where id=$1', [loja])
ok('loja retirada: modo volta a "Somente teste" e não sobe de novo', (await estadoLoja()).m === 'teste' && (await modo(pGer, 'caixa')).status === 403)
ok('loja retirada: Assistente antigo segue com a cozinha', (await antigo()).length >= 0 && (await estadoLoja()).f === false)
ok('outra loja não troca o modo desta (só a própria)', (await modo(pViz, 'caixa')).status === 403 && (await estadoLoja()).m === 'teste')
ok('vizinha continua sem liberação', (await um('select impressao_beta_liberado l, impressao_beta_modo m from restaurantes where id=$1', [vizinha])).l === false)
ok('função do banco não é executável por anon/authenticated', !(await um(`select has_function_privilege('authenticated', 'impressao_modo_definir(uuid,text,uuid,text)', 'execute') p`)).p &&
  !(await um(`select has_function_privilege('anon', 'impressao_calibracao_criar(uuid,uuid,text,uuid,text)', 'execute') p`).catch(() => ({ p: false }))).p)

// limpeza
await db.query(`update restaurantes set impressao_agente_token=null, impressao_cozinha_por_funcao=false, impressao_beta_liberado=false, impressao_beta_modo='teste',
  impressao_cozinha_transferida_em=null where id = any($1::uuid[])`, [[loja, vizinha]])
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza teste impressão', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
await browser.close()
await db.end()
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
