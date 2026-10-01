/**
 * E2E — Clientes: botão CSV com importar e exportar (2026-10-01). Stack local, loja
 * cantina-e2e (dono.e2e) e vizinha-e2e (isolamento). Telefones fictícios 11 91234-5xxx.
 * No fim desfaz as importações TESTE e apaga o que sobrou de TESTE.
 *
 *   node scripts/seguranca/e2e-clientes-csv.mjs [prints]
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const TMP = join(tmpdir(), 'menuzia-e2e-csv')
mkdirSync(TMP, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const foto = async (p, nome, full = false) => { if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`), fullPage: full }) }
const loja = await um(`select id from restaurantes where slug='cantina-e2e'`)
const viz = await um(`select id from restaurantes where slug='vizinha-e2e'`)
const SENHA = 'demo-local-123456'
const TEL = (n) => `5511912345${String(n).padStart(3, '0')}`

// Limpa sobras de rodadas anteriores (só TESTE desta suíte).
async function limpar() {
  await db.query(`delete from clientes where restaurante_id in ($1,$2) and telefone like '5511912345%'`, [loja.id, viz.id])
  await db.query(`delete from clientes_importacoes where restaurante_id in ($1,$2) and arquivo_nome like 'teste-%'`, [loja.id, viz.id])
  await db.query(`delete from whatsapp_descadastros where restaurante_id=$1 and telefone like '5511912345%'`, [loja.id])
}
await limpar()

const arquivo = (nome, texto, codificacao = 'utf8') => { const p = join(TMP, nome); writeFileSync(p, codificacao === 'latin1' ? Buffer.from(texto, 'latin1') : Buffer.from(texto, 'utf8')); return p }

const browser = await chromium.launch()
async function logar(login, { viewport = { width: 1366, height: 860 }, canal } = {}) {
  const b = canal ? await chromium.launch({ channel: canal }) : browser
  const ctx = await b.newContext({ viewport, locale: 'pt-BR', acceptDownloads: true, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  const b2 = p.getByRole('button', { name: /OK, entendi/ }).first()
  await b2.waitFor({ timeout: 2500 }).catch(() => {})
  if (await b2.isVisible().catch(() => false)) await b2.click()
  return { ctx, p, fechar: async () => { await ctx.close(); if (canal) await b.close() } }
}
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  return { s: r.status, j: await r.json().catch(() => null) }
}, { url: `${BASE}${url}`, metodo, corpo })
const metricas = async (p) => {
  const linhas = (await p.locator('main').innerText()).split('\n').map((l) => l.trim()).filter(Boolean)
  const pega = (rot) => { const i = linhas.lastIndexOf(rot); return i >= 0 ? linhas[i + 1] : undefined }
  return { clientes: pega('Clientes'), umaVez: pega('Compraram 1x'), recorrentes: pega('Recorrentes (2+)'), ticket: pega('Ticket médio') }
}
async function abrirClientes(p) { await p.goto(`${BASE}/admin/clientes`, { waitUntil: 'networkidle' }); await p.getByTestId('clientes-card').waitFor() }
async function menu(p, item) { await p.getByTestId('botao-csv').click(); await p.getByTestId(item).click() }
async function baixar(p, acao) { const [d] = await Promise.all([p.waitForEvent('download'), acao()]); const caminho = join(TMP, d.suggestedFilename()); await d.saveAs(caminho); return { nome: d.suggestedFilename(), bytes: readFileSync(caminho) } }

/** Importa um arquivo pela tela até a conferência. */
async function ateConferencia(p, caminho) {
  await menu(p, 'menu-importar')
  await p.getByTestId('importar-input').setInputFiles(caminho)
  await p.getByTestId('importar-continuar').click()
  await p.getByTestId('importar-resumo').waitFor({ timeout: 15000 }).catch(() => {})
  await espera(900) // conferência no servidor
}
const num = async (p, id) => Number((await p.getByTestId(id).locator('[data-valor]').innerText()).replace(/\./g, ''))
async function importarAgora(p) {
  await p.getByTestId('lgpd-check').check()
  await p.getByTestId('importar-confirmar').click()
  await p.getByTestId('importar-resultado').waitFor({ timeout: 600000 })
  const r = { criados: await num(p, 'res-criados'), atualizados: await num(p, 'res-atualizados'), ignorados: await num(p, 'res-ignorados'), erros: await num(p, 'res-erros') }
  await p.getByTestId('importar-fechar').click()
  return r
}

try {
  const { p, fechar } = await logar('dono.e2e@local.test')
  await abrirClientes(p)
  const antes = await metricas(p)

  secao('1. Botão CSV e menu')
  ok('botão "CSV" no lugar do "Exportar CSV (Meta Ads)"', (await p.getByTestId('botao-csv').count()) === 1 && (await p.getByText('Exportar CSV (Meta Ads)').count()) === 0)
  await p.getByTestId('botao-csv').click()
  ok('menu com Importar e Exportar clientes', /Importar clientes/.test(await p.getByTestId('menu-csv').innerText()) && /Exportar clientes/.test(await p.getByTestId('menu-csv').innerText()))
  await foto(p, '01-menu-csv')
  await p.mouse.click(10, 10)

  secao('2. Exportar')
  await menu(p, 'menu-exportar')
  await p.getByTestId('modal-exportar').waitFor()
  await foto(p, '02-modal-exportar')
  const previa = async () => { await p.getByTestId('exportar-previa').filter({ hasNotText: 'Contando' }).waitFor({ timeout: 10000 }); return Number(((await p.getByTestId('exportar-previa').innerText()).match(/[\d.]+/) ?? ['0'])[0].replace(/\./g, '')) }
  const linhasDoArquivo = (bytes, sep = ';') => bytes.toString('utf8').replace(/^﻿/, '').split('\r\n').filter(Boolean)
  const todosBanco = (await um(`select count(distinct (case when length(regexp_replace(cliente_telefone,'\\D','','g')) in (10,11) then '55'||regexp_replace(cliente_telefone,'\\D','','g') else regexp_replace(cliente_telefone,'\\D','','g') end))::int n from pedidos where restaurante_id=$1 and status<>'cancelado'`, [loja.id])).n
  for (const at of ['7', '30', '90', 'mes', 'todos']) {
    await p.getByTestId(`periodo-${at}`).click()
    await espera(400)
    const n = await previa()
    if (n === 0) { ok(`período ${at}: prévia 0 (Exportar desabilitado)`, await p.getByTestId('exportar-confirmar').isDisabled()); continue }
    const f = await baixar(p, () => p.getByTestId('exportar-confirmar').click())
    ok(`período ${at}: prévia ${n} = linhas do arquivo`, linhasDoArquivo(f.bytes).length - 1 === n, `${f.nome} ${linhasDoArquivo(f.bytes).length - 1}`)
    if (at === 'todos') ok('"Todos" = todos os clientes com pedido', n === todosBanco, `${n} x ${todosBanco}`)
    await menu(p, 'menu-exportar')
  }
  await p.getByTestId('periodo-personalizado').click()
  ok('personalizado sem datas trava o Exportar', await p.getByTestId('exportar-confirmar').isDisabled())
  await p.getByTestId('exportar-de').fill('2020-01-01')
  await p.getByTestId('exportar-ate').fill('2030-12-31')
  const nPers = await previa()
  const fp = await baixar(p, () => p.getByTestId('exportar-confirmar').click())
  ok('personalizado: nome do arquivo clientes-<loja>-<ini>_<fim>.csv', fp.nome === 'clientes-cantina-e2e-2020-01-01_2030-12-31.csv', fp.nome)
  ok('personalizado: contagem igual ao arquivo', linhasDoArquivo(fp.bytes).length - 1 === nPers)
  const txt = fp.bytes.toString('utf8')
  ok('planilha completa: UTF-8 com BOM e ponto e vírgula', fp.bytes[0] === 0xef && fp.bytes[1] === 0xbb && fp.bytes[2] === 0xbf && txt.split('\r\n')[0].split(';').length === 10)
  ok('planilha completa: colunas em português com acento', /Última compra;Total gasto \(R\$\);Ticket médio \(R\$\);Recorrência/.test(txt))
  ok('valores e datas no formato brasileiro', /;\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2};[\d.]+,\d{2};/.test(txt))
  await menu(p, 'menu-exportar')
  await p.getByTestId('periodo-todos').click()
  const nTodos = await previa()
  await p.getByTestId('exportar-recorrentes').check()
  const nRec = await previa()
  const recBanco = (await um(`select count(*)::int n from (select regexp_replace(cliente_telefone,'\\D','','g') t from pedidos where restaurante_id=$1 and status<>'cancelado' group by 1 having count(*)>1) x`, [loja.id])).n
  ok('filtro recorrentes (2+)', nRec === recBanco, `${nRec} x ${recBanco}`)
  await p.getByTestId('exportar-uma-vez').check()
  const nUma = await previa()
  ok('filtro 1x (exclui recorrentes)', nUma === nTodos - nRec && !(await p.getByTestId('exportar-recorrentes').isChecked()), `${nUma}`)
  await p.getByTestId('exportar-uma-vez').uncheck()
  await p.getByTestId('exportar-com-telefone').check()
  ok('filtro com telefone', (await previa()) <= nTodos)
  await p.getByTestId('exportar-com-telefone').uncheck()
  await p.getByTestId('formato-meta').click()
  const fm = await baixar(p, () => p.getByTestId('exportar-confirmar').click())
  const lm = linhasDoArquivo(fm.bytes)
  ok('Meta Ads: igual ao de antes (phone,fn,ln,zip,country,gen, vírgula, BOM)', lm[0] === 'phone,fn,ln,zip,country,gen' && lm.slice(1).every((l) => /^(\d{12,13})?,[a-z ]*,[a-z ]*,\d*,br,[mf]?$/.test(l)) && fm.bytes[0] === 0xef, lm[1])
  const aud = await um(`select count(*)::int n, max(dados::text) d from eventos_auditoria where restaurante_id=$1 and acao='clientes.exportou' and criado_em > now() - interval '10 minutes'`, [loja.id])
  ok('auditoria da exportação (quem, filtros e quantidade)', aud.n >= 6 && /quantidade/.test(aud.d))

  secao('3. Importar: modelo, LGPD, resultado e métricas')
  await menu(p, 'menu-importar')
  await foto(p, '03-importar-etapa1')
  ok('modelo na tela com nome* e telefone*', /nome\*/.test(await p.getByTestId('modelo-tabela').innerText()) && /telefone\*/.test(await p.getByTestId('modelo-tabela').innerText()))
  const modelo = await baixar(p, () => p.getByTestId('baixar-modelo').click())
  ok('modelo baixado: BOM, ; e 2 linhas de exemplo', modelo.bytes[0] === 0xef && linhasDoArquivo(modelo.bytes).length === 3 && linhasDoArquivo(modelo.bytes)[0].startsWith('nome;telefone;email'))
  // Reimporta o modelo com telefones TESTE no lugar dos de exemplo.
  const mod = linhasDoArquivo(modelo.bytes).map((l, i) => (i === 1 ? l.replace('(27) 99999-8888', '(11) 91234-5001') : i === 2 ? l.replace('+55 27 98888-7777', '11 91234 5002') : l)).join('\r\n')
  const cModelo = arquivo('teste-modelo.csv', '﻿' + mod)
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByTestId('importar-area').click()])
  ok('clique na área abre o seletor de arquivos (accept .csv)', !!chooser && (await p.getByTestId('importar-input').getAttribute('accept')).includes('.csv'))
  await chooser.setFiles(cModelo)
  ok('mostra nome e tamanho com "Trocar arquivo"', /teste-modelo\.csv/.test(await p.getByTestId('importar-arquivo').innerText()) && (await p.getByTestId('trocar-arquivo').count()) === 1)
  await p.getByTestId('importar-continuar').click()
  await p.getByTestId('importar-resumo').waitFor()
  await espera(900)
  ok('conferência: 2 válidos novos, 0 erros', (await num(p, 'resumo-novos')) === 2 && (await num(p, 'resumo-erros')) === 0)
  ok('detecta ; e UTF-8 e o cabeçalho', /ponto e vírgula/.test(await p.getByTestId('importar-deteccao').innerText()) && /UTF-8/.test(await p.getByTestId('importar-deteccao').innerText()))
  ok('prévia interpretada (telefone normalizado 55+DDD+número)', /5511912345001/.test(await p.getByTestId('previa').innerText()) && /15\/03\/1990/.test(await p.getByTestId('previa').innerText()))
  ok('sem a caixa LGPD o Importar fica desabilitado', await p.getByTestId('importar-confirmar').isDisabled())
  await foto(p, '04-importar-conferencia')
  let r = await importarAgora(p)
  ok('2 clientes criados', r.criados === 2, JSON.stringify(r))
  const c1 = await um(`select nome, email, data_nascimento::text dn, endereco_uf, origem, importacao_id is not null imp from clientes where restaurante_id=$1 and telefone=$2`, [loja.id, TEL(1)])
  ok('gravado com origem "importado", e-mail, nascimento e UF', c1?.origem === 'importado' && c1.email === 'maria@email.com' && c1.dn === '1990-03-15' && c1.endereco_uf === 'ES' && c1.imp)
  await abrirClientes(p)
  const depois = await metricas(p)
  ok('tabela mostra os importados com "Importado (data)" e 0 pedidos', (await p.getByTestId('selo-importado').count()) >= 2 && /Importado \(\d{2}\/\d{2}\/\d{4}\)/.test(await p.getByTestId('clientes-rolagem').innerText()))
  ok('total de Clientes inclui os importados', Number(depois.clientes?.replace(/\D/g, '')) === Number(antes.clientes?.replace(/\D/g, '')) + 2, `${antes.clientes} → ${depois.clientes}`)
  ok('Compraram 1x, Recorrentes e Ticket médio não mudam', depois.umaVez === antes.umaVez && depois.recorrentes === antes.recorrentes && depois.ticket === antes.ticket, JSON.stringify([antes, depois]))
  await foto(p, '05-tabela-importados')

  secao('4. Excel (; + Latin-1), vírgula + UTF-8, nomes de coluna diferentes')
  const latin = arquivo('teste-excel.csv', 'Cliente;Celular;E-mail;Data de Nascimento;Cidade\r\nJosé Açaí;(11) 91234-5003;jose@x.com;01/02/1980;São Paulo\r\nConceição;11912345004;;;Mauá\r\n', 'latin1')
  await ateConferencia(p, latin)
  ok('detecta Windows-1252 e ponto e vírgula', /Windows-1252/.test(await p.getByTestId('importar-deteccao').innerText()))
  ok('acentos certos na prévia (José Açaí, Conceição)', /José Açaí/.test(await p.getByTestId('previa').innerText()) && /Conceição/.test(await p.getByTestId('previa').innerText()))
  ok('mapeamento automático: Cliente→Nome, Celular→Telefone, Data de Nascimento', (await p.getByTestId('mapa-0').inputValue()) === 'nome' && (await p.getByTestId('mapa-1').inputValue()) === 'telefone' && (await p.getByTestId('mapa-3').inputValue()) === 'data_nascimento')
  r = await importarAgora(p)
  ok('Excel importado (2 criados)', r.criados === 2, JSON.stringify(r))
  ok('cidade com acento gravada certa', (await um(`select endereco_cidade c from clientes where restaurante_id=$1 and telefone=$2`, [loja.id, TEL(3)])).c === 'São Paulo')
  const virg = arquivo('teste-virgula.csv', 'Name,WhatsApp,Bairro,Obs\n"Silva, Ana",+55 (11) 91234-5005,Centro,"cliente ""vip"""\nBeto,011912345006,,\n')
  await ateConferencia(p, virg)
  ok('detecta vírgula e UTF-8; "Silva, Ana" com vírgula dentro de aspas', /vírgula/.test(await p.getByTestId('importar-deteccao').innerText()) && /Silva, Ana/.test(await p.getByTestId('previa').innerText()))
  // Ajuste manual: a coluna "Obs" vira Observações; "Bairro" é ignorada.
  await p.getByTestId('mapa-3').selectOption('observacoes')
  await p.getByTestId('mapa-2').selectOption('')
  await foto(p, '06-mapeamento')
  ok('telefone com 0 na frente (011…) é recusado com motivo', (await num(p, 'resumo-erros')) === 1 && /Linha 3: Telefone inválido/.test(await p.getByTestId('lista-erros').innerText()))
  r = await importarAgora(p)
  const ana = await um(`select observacoes, endereco_bairro from clientes where restaurante_id=$1 and telefone=$2`, [loja.id, TEL(5)])
  ok('coluna ajustada e coluna ignorada respeitadas', ana?.observacoes === 'cliente "vip"' && !ana.endereco_bairro, JSON.stringify(ana))

  secao('5. Duplicados no arquivo e na base (3 opções), erros e download')
  const dup = (nome) => arquivo(nome, 'nome;telefone;email\r\nMaria Atualizada;11912345001;nova@email.com\r\nJosé Novo Nome;11912345003;ze@novo.com\r\nRepetido;(11) 91234-5001;\r\n;11912345099;\r\nSem Tel;;\r\n')
  await ateConferencia(p, dup('teste-dup1.csv'))
  ok('resumo: 0 novos, 2 já existem, 3 com erro (repetido, nome vazio, telefone vazio)', (await num(p, 'resumo-novos')) === 0 && (await num(p, 'resumo-existentes')) === 2 && (await num(p, 'resumo-erros')) === 3)
  const errosTxt = await p.getByTestId('lista-erros').innerText()
  ok('motivo de cada linha', /repetido no arquivo/.test(errosTxt) && /Nome vazio/.test(errosTxt) && /Telefone vazio/.test(errosTxt))
  const fe = await baixar(p, () => p.getByTestId('baixar-erros').click())
  ok('"Baixar linhas com erro (CSV)" com o motivo', /linha;motivo/.test(fe.bytes.toString('utf8')) && linhasDoArquivo(fe.bytes).length === 4)
  ok('modo padrão "Ignorar"', await p.getByTestId('modo-ignorar').isChecked())
  await foto(p, '07-duplicados')
  await p.getByTestId('lgpd-check').check()
  ok('Ignorar com 0 novos: nada a importar (botão "Importar 0" desabilitado)', (await p.getByTestId('importar-confirmar').isDisabled()) && /Importar 0/.test(await p.getByTestId('importar-confirmar').innerText()))
  ok('Ignorar: nada muda', (await um(`select email from clientes where restaurante_id=$1 and telefone=$2`, [loja.id, TEL(1)])).email === 'maria@email.com')
  await p.keyboard.press('Escape')
  await ateConferencia(p, dup('teste-dup2.csv'))
  await p.getByTestId('modo-completar').check()
  r = await importarAgora(p)
  const ze = await um(`select nome, email from clientes where restaurante_id=$1 and telefone=$2`, [loja.id, TEL(3)])
  ok('Completar: só o vazio (e-mail de quem não tinha); nome mantido', r.atualizados === 0 || (ze.nome === 'José Açaí' && ze.email === 'jose@x.com'), JSON.stringify({ r, ze }))
  const conc = await um(`select email from clientes where restaurante_id=$1 and telefone=$2`, [loja.id, TEL(1)])
  ok('Completar não sobrescreve e-mail existente', conc.email === 'maria@email.com')
  await ateConferencia(p, dup('teste-dup3.csv'))
  await p.getByTestId('modo-atualizar').check()
  r = await importarAgora(p)
  const m1 = await um(`select nome, email from clientes where restaurante_id=$1 and telefone=$2`, [loja.id, TEL(1)])
  ok('Atualizar: nome e e-mail trocados', r.atualizados === 2 && m1.nome === 'Maria Atualizada' && m1.email === 'nova@email.com', JSON.stringify({ r, m1 }))

  secao('6. Desfazer importação')
  await menu(p, 'menu-historico')
  await p.getByTestId('historico-linha').first().waitFor()
  await foto(p, '08-historico')
  ok('histórico com data, usuário, arquivo e quantidades', /teste-dup3\.csv/.test(await p.getByTestId('modal-historico').innerText()))
  await p.locator('[data-testid="historico-linha"][data-arquivo="teste-dup3.csv"]').getByTestId('historico-desfazer').click()
  await p.getByTestId('confirmar-desfazer-ok').click()
  await espera(1500)
  const m1b = await um(`select nome, email from clientes where restaurante_id=$1 and telefone=$2`, [loja.id, TEL(1)])
  ok('desfazer "Atualizar": volta ao valor anterior', m1b.nome === 'Maria da Silva' && m1b.email === 'maria@email.com', JSON.stringify(m1b))
  ok('linha marcada "Desfeita"', /Desfeita/.test(await p.locator('[data-testid="historico-linha"][data-arquivo="teste-dup3.csv"]').innerText()))
  // Cliente criado que fez pedido depois NÃO sai ao desfazer.
  await db.query(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento) values ($1,'retirada','entregue',10,10,'TESTE CSV','11912345004','pix')`, [loja.id])
  await p.locator('[data-testid="historico-linha"][data-arquivo="teste-excel.csv"]').getByTestId('historico-desfazer').click()
  await p.getByTestId('confirmar-desfazer-ok').click()
  await espera(1500)
  ok('desfazer "criados": sai quem não pediu, fica quem pediu depois', !(await um(`select 1 from clientes where restaurante_id=$1 and telefone=$2`, [loja.id, TEL(3)])) && !!(await um(`select 1 from clientes where restaurante_id=$1 and telefone=$2`, [loja.id, TEL(4)])))
  const desfazer2 = await api(p, `/api/admin/clientes/importacoes/${(await um(`select id from clientes_importacoes where restaurante_id=$1 and arquivo_nome='teste-excel.csv'`, [loja.id])).id}/desfazer`, 'POST')
  ok('desfazer duas vezes é recusado', desfazer2.s === 409)
  await p.keyboard.press('Escape')

  secao('7. Arquivo grande, limites e não-CSV')
  const grande = ['nome;telefone', ...Array.from({ length: 20000 }, (_, i) => `TESTE Grande ${i};119${String(20000000 + i).padStart(8, '0')}`)].join('\r\n')
  await ateConferencia(p, arquivo('teste-grande.csv', grande))
  ok('20.000 linhas: conferência mostra 20.000 válidos', (await num(p, 'resumo-novos')) + (await num(p, 'resumo-existentes')) === 20000)
  const t0 = Date.now()
  r = await importarAgora(p)
  ok('20.000 importados em lotes', r.criados === 20000, `${JSON.stringify(r)} em ${Math.round((Date.now() - t0) / 1000)} s`)
  const impG = await um(`select id, lotes from clientes_importacoes where restaurante_id=$1 and arquivo_nome='teste-grande.csv'`, [loja.id])
  ok('40 lotes registrados', impG.lotes.length === 40)
  await api(p, `/api/admin/clientes/importacoes/${impG.id}/desfazer`, 'POST')
  ok('desfeito (20.000 removidos)', (await um(`select count(*)::int n from clientes where restaurante_id=$1 and importacao_id=$2`, [loja.id, impG.id])).n === 0)
  await menu(p, 'menu-importar')
  await p.getByTestId('importar-input').setInputFiles(arquivo('teste-grande-demais.csv', grande + '\r\nUm a mais;11920099999'))
  ok('20.001 linhas: mensagem clara', /20\.001 linhas\. O limite é 20\.000/.test(await p.getByTestId('importar-erro-arquivo').innerText()))
  await p.getByTestId('importar-input').setInputFiles(arquivo('teste-planilha.csv', 'PK\u0003\u0004\u0000\u0000binario'))
  ok('arquivo que não é CSV (xlsx) recusado', /não é um CSV/.test(await p.getByTestId('importar-erro-arquivo').innerText()))
  await p.getByTestId('importar-input').setInputFiles(arquivo('teste.txt', 'nome;telefone'))
  ok('extensão errada recusada', /\.csv/.test(await p.getByTestId('importar-erro-arquivo').innerText()))
  await foto(p, '09-erro-arquivo')
  await p.keyboard.press('Escape')

  secao('8. Arrastar e soltar, clique duplo e internet caindo')
  await menu(p, 'menu-importar')
  const conteudo = 'nome;telefone\r\nTESTE Arrastado;11912345010\r\nTESTE Arrastado 2;11912345011\r\n'
  const dt = await p.evaluateHandle((t) => { const d = new DataTransfer(); d.items.add(new File([t], 'teste-arrastado.csv', { type: 'text/csv' })); return d }, conteudo)
  await p.getByTestId('importar-area').dispatchEvent('dragenter', { dataTransfer: dt })
  ok('destaque ao arrastar por cima', (await p.getByTestId('importar-area').getAttribute('data-arrastando')) === 'sim')
  await foto(p, '10-arrastando')
  await p.getByTestId('importar-area').dispatchEvent('drop', { dataTransfer: dt })
  await p.getByTestId('importar-arquivo').waitFor()
  ok('soltar o arquivo carrega', /teste-arrastado\.csv/.test(await p.getByTestId('importar-arquivo').innerText()))
  await p.getByTestId('importar-continuar').click()
  await p.getByTestId('importar-resumo').waitFor()
  await espera(900)
  await p.getByTestId('lgpd-check').check()
  // Primeira tentativa do lote "cai"; o reenvio usa a mesma chave.
  let derrubou = false
  await p.route('**/api/admin/clientes/importar', async (route) => {
    if (!derrubou && /"acao":"lote"/.test(route.request().postData() ?? '')) { derrubou = true; await route.fetch(); return route.abort('failed') }
    return route.continue()
  })
  await p.getByTestId('importar-confirmar').dblclick()
  await p.getByTestId('importar-resultado').waitFor({ timeout: 30000 })
  await p.unroute('**/api/admin/clientes/importar')
  ok('internet caiu depois de gravar: reenvio não duplica', derrubou && (await um(`select count(*)::int n from clientes where restaurante_id=$1 and telefone in ($2,$3)`, [loja.id, TEL(10), TEL(11)])).n === 2)
  ok('clique duplo: uma importação só', (await um(`select count(*)::int n from clientes_importacoes where restaurante_id=$1 and arquivo_nome='teste-arrastado.csv'`, [loja.id])).n === 1)
  await p.getByTestId('importar-fechar').click()

  secao('9. Descadastrados, permissões e isolamento')
  await db.query(`insert into whatsapp_descadastros (restaurante_id, telefone, telefone_chave, origem) values ($1,$2,telefone_chave($2),'cliente') on conflict do nothing`, [loja.id, TEL(12)]).catch(() => {})
  await ateConferencia(p, arquivo('teste-sair.csv', 'nome;telefone\r\nQuer Sair;11912345012\r\n'))
  ok('quem pediu para sair é avisado e continua fora', /continua fora/.test(await p.getByTestId('resumo-descadastrados').innerText()))
  await p.keyboard.press('Escape')
  await fechar()
  for (const login of ['atendente.e2e', 'garcom.e2e']) {
    const s = await logar(login)
    ok(`${login}: entrou no painel (a recusa abaixo é por permissão, não por falta de login)`, s.p.url().includes('/admin/'), s.p.url())
    await s.p.goto(`${BASE}/admin/clientes`, { waitUntil: 'networkidle' })
    await espera(800)
    if (login.startsWith('atendente')) ok('atendente vê a Base de Clientes, mas sem o botão CSV', (await s.p.getByTestId('clientes-card').count()) === 1 && (await s.p.getByTestId('botao-csv').count()) === 0)
    const ex = await api(s.p, '/api/admin/clientes/exportar', 'POST', { filtro: {}, previa: true })
    const im = await api(s.p, '/api/admin/clientes/importar', 'POST', { acao: 'lote', chave: 'teste-invasor-123', modo: 'ignorar', totalLinhas: 1, lote: 0, linhas: [{ nome: 'X', telefone: '11912345099' }] })
    const hi = await api(s.p, '/api/admin/clientes/importacoes')
    ok(`${login.split('@')[0]}: não vê o botão e a API recusa`, (await s.p.getByTestId('botao-csv').count()) === 0 && ex.s >= 400 && im.s >= 400 && hi.s >= 400, `${ex.s}/${im.s}/${hi.s}`)
    await s.fechar()
  }
  const ger = await logar('gerente.e2e')
  await abrirClientes(ger.p)
  ok('gerente vê o botão (padrão do papel)', (await ger.p.getByTestId('botao-csv').count()) === 1)
  await ger.fechar()
  const vz = await logar('dono.vizinha.e2e')
  await vz.p.goto(`${BASE}/admin/clientes`, { waitUntil: 'networkidle' })
  const hv = await api(vz.p, '/api/admin/clientes/importacoes')
  ok('outra loja não vê o histórico desta', hv.s === 200 && !(hv.j.importacoes ?? []).some((i) => /^teste-/.test(i.arquivo_nome)))
  const imV = await api(vz.p, '/api/admin/clientes/importar', 'POST', { acao: 'lote', chave: 'teste-vizinha-0001', arquivoNome: 'teste-vizinha.csv', modo: 'atualizar', totalLinhas: 1, lote: 0, linhas: [{ nome: 'Da Vizinha', telefone: '11912345001' }] })
  await api(vz.p, '/api/admin/clientes/importar', 'POST', { acao: 'concluir', chave: 'teste-vizinha-0001' })
  ok('mesmo telefone na outra loja vira OUTRO cliente (não mexe nesta)', imV.s === 200 && imV.j.criados === 1 && (await um(`select nome from clientes where restaurante_id=$1 and telefone=$2`, [loja.id, TEL(1)])).nome === 'Maria da Silva')
  await vz.fechar()

  secao('10. Edge e celular')
  const edge = await logar('dono.e2e@local.test', { canal: 'msedge' })
  await abrirClientes(edge.p)
  await menu(edge.p, 'menu-importar')
  await edge.p.getByTestId('importar-input').setInputFiles(arquivo('teste-edge.csv', 'nome;telefone\r\nTESTE Edge;11912345020\r\n'))
  await edge.p.getByTestId('importar-continuar').click()
  await edge.p.getByTestId('importar-resumo').waitFor()
  await espera(900)
  r = await importarAgora(edge.p)
  ok('Edge: importa', r.criados === 1)
  await edge.fechar()
  const cel = await logar('dono.e2e@local.test', { viewport: { width: 390, height: 844 } })
  await abrirClientes(cel.p)
  await menu(cel.p, 'menu-importar')
  const sobra = await cel.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ok('celular: modal sem rolagem lateral', sobra <= 1, String(sobra))
  await foto(cel.p, '11-celular-importar')
  await cel.p.getByTestId('importar-input').setInputFiles(arquivo('teste-celular.csv', 'nome;telefone\r\nTESTE Celular;11912345021\r\n'))
  await cel.p.getByTestId('importar-continuar').click()
  await cel.p.getByTestId('importar-resumo').waitFor()
  await espera(900)
  await foto(cel.p, '12-celular-conferencia')
  r = await importarAgora(cel.p)
  ok('celular: importa', r.criados === 1)
  await cel.p.getByTestId('botao-csv').click()
  await cel.p.getByTestId('menu-exportar').click()
  await foto(cel.p, '13-celular-exportar')
  await cel.fechar()
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_nome='TESTE CSV'`, [loja.id])
  await limpar()
  await db.query(`delete from clientes_importacoes where restaurante_id in ($1,$2) and arquivo_nome like 'teste-%'`, [loja.id, viz.id])
  await db.query(`delete from clientes where restaurante_id=$1 and nome like 'TESTE Grande%'`, [loja.id])
  rmSync(TMP, { recursive: true, force: true })
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
