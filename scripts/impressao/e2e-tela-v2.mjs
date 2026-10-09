/**
 * E2E LOCAL da tela de Impressão v2 (2026-10-07). Servidor e banco LOCAIS (cantina-demo, dono
 * local); o estado de impressão da loja é guardado e devolvido no fim. Nada imprime de verdade: o
 * computador é pareado pela API (credencial real) e "dá sinal" a cada consulta.
 *   · card 1 reflete o assistente (desconectado → "Conectado em <PC>"; aviso do antigo);
 *   · card 2: adicionar com e sem apelido, editar apelido, funções (inclusive duas na mesma),
 *     remover, "Testar impressão"; a função manda (destino da Cozinha/Entrega no Assistente);
 *     apelido no topo (resumo da impressão);
 *   · card 3: switches gravam e a prévia muda; prévia = renderizador do Assistente;
 *   · Avançado: largura, envio, calibração, computador;
 *   · modal: abas, tipo, zoom, Esc; peso ≤ 600 e contraste ≥ 4,5:1; celular 360/390/430.
 * Prints em C:\Users\felipe\Downloads\revisao-impressao-v2 (ou PRINTS=…).
 *
 *   node scripts/impressao/e2e-tela-v2.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { chromium } from 'playwright'
import { renderizarTicket, fecharRender } from './render-ticket.mjs'
import { pedidoDemonstracao } from '../../lib/impressao/demonstracao.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const DB = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE) || !/@(127\.0\.0\.1|localhost):/.test(DB)) throw new Error('só servidor e banco locais')
const PRINTS = process.env.PRINTS ?? 'C:/Users/felipe/Downloads/revisao-impressao-v2'
mkdirSync(PRINTS, { recursive: true })
const require = createRequire(import.meta.url)
const { montarComandaV3 } = require('../../printer-agent/src/v3.js')

let falhas = 0, total = 0
const ok = (n, c, d = '') => { total++; if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const db = new pg.Client(DB)
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const L = (await um("select id from restaurantes where slug = 'cantina-demo'")).id
const COLS = 'impressao_beta_modo, impressao_beta_liberado, impressao_cozinha_por_funcao, impressao_via_cozinha, impressao_qr, impressao_logo, impressao_agente_visto_em, impressao_cozinha_transferida_em'
const antes = await um(`select ${COLS} from restaurantes where id = $1`, [L])
const funcoesAntes = (await db.query('select funcao, dispositivo_id from impressao_funcoes where restaurante_id = $1', [L])).rows
const NOME_AG = 'PC Tela v2'
async function limpar() {
  await db.query('delete from impressao_trabalhos where restaurante_id = $1 and agente_id in (select id from impressao_agentes where restaurante_id = $1 and nome = $2)', [L, NOME_AG])
  await db.query('delete from impressao_funcoes where restaurante_id = $1', [L])
  await db.query('delete from impressao_dispositivos where agente_id in (select id from impressao_agentes where restaurante_id = $1 and nome = $2)', [L, NOME_AG])
  await db.query('delete from impressao_pareamentos where agente_id in (select id from impressao_agentes where restaurante_id = $1 and nome = $2)', [L, NOME_AG])
  await db.query('delete from impressao_agentes where restaurante_id = $1 and nome = $2', [L, NOME_AG])
  for (const f of funcoesAntes) await db.query('insert into impressao_funcoes (restaurante_id, funcao, dispositivo_id) values ($1, $2, $3) on conflict do nothing', [L, f.funcao, f.dispositivo_id]).catch(() => {})
}
await limpar()
// Outros computadores de testes anteriores fora do caminho (revogados) e loja no antigo.
await db.query("update impressao_agentes set revogado_em = coalesce(revogado_em, now()) where restaurante_id = $1", [L])
await db.query("update restaurantes set impressao_beta_modo = 'teste', impressao_cozinha_por_funcao = false, impressao_beta_liberado = true, impressao_via_cozinha = false, impressao_qr = true, impressao_logo = true, impressao_agente_visto_em = null where id = $1", [L])

const contraste = (a, b) => {
  const lum = (h) => { const c = h.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
const dif1bit = async (pngA, pngB) => {
  const a = await sharp(pngA).greyscale().raw().toBuffer({ resolveWithObject: true })
  const b = await sharp(pngB).greyscale().raw().toBuffer({ resolveWithObject: true })
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return { mesmo: false, txt: `${a.info.width}×${a.info.height} vs ${b.info.width}×${b.info.height}` }
  let d = 0
  for (let i = 0; i < a.data.length; i++) if ((a.data[i] < 128) !== (b.data[i] < 128)) d++
  return { mesmo: d / a.data.length < 0.002, txt: `${d} pixels diferentes` }
}

const browser = await chromium.launch()
let credencial = null
let sinal = null
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.local'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  const api = (url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
    const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) }
  }, { url, metodo, corpo })
  const agente = (url, corpo) => fetch(`${BASE}${url}`, { method: corpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credencial}`, 'X-Agente-Versao': '0.2.0-beta.10' }, body: corpo ? JSON.stringify(corpo) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))
  const abrir = async () => {
    await p.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
    await p.getByTestId('passo-1').waitFor({ timeout: 20000 })
    await p.waitForTimeout(800)
  }

  secao('estrutura')
  await abrir()
  ok('três cards em uma coluna, sem pílulas de status acima', await p.getByTestId('passo-1').isVisible() && await p.getByTestId('passo-2').isVisible() && await p.getByTestId('passo-3').isVisible() && (await p.locator('.ti-resumo').count()) === 0)
  const col = await p.evaluate(() => ['passo-1', 'passo-2', 'passo-3'].map((t) => document.querySelector(`[data-testid="${t}"]`).getBoundingClientRect()).map((r) => [Math.round(r.left), Math.round(r.width), Math.round(r.top)]))
  ok('cards com a mesma largura, um embaixo do outro', col[0][0] === col[1][0] && col[1][0] === col[2][0] && col[0][1] === col[2][1] && col[0][2] < col[1][2] && col[1][2] < col[2][2], JSON.stringify(col))
  ok('escolha "antigo × novo" saiu da tela', (await p.getByTestId('opcao-antigo').count()) === 0 && (await p.getByTestId('opcao-beta').count()) === 0)
  ok('sem o botão "Ver modelo de impressão" (pedido do dono, 09/10)', (await p.getByTestId('ver-modelo').count()) === 0 && (await p.getByTestId('modal-previa').count()) === 0)

  secao('card 1 — assistente')
  ok('sem computador: "Desconectado" em âmbar', /Desconectado/.test(await p.getByTestId('assistente-situacao').innerText()) && (await p.getByTestId('assistente-situacao').getAttribute('class')).includes('warn'))
  ok('loja no antigo: aviso amarelo discreto, modo não muda', /Sua loja usa o assistente antigo/.test(await p.getByTestId('aviso-antigo').innerText()) && (await um('select impressao_beta_modo m from restaurantes where id=$1', [L])).m === 'teste')
  ok('"Baixar instalador" no card 1', await p.getByTestId('baixar-instalador').isVisible())
  await p.screenshot({ path: join(PRINTS, '01-sem-computador-1366.png'), fullPage: true })

  // Computador pareado pelo código (como hoje) — com credencial real.
  const cod = await api('/api/admin/impressao/pareamento', 'POST')
  const par = await fetch(`${BASE}/api/agente/parear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: cod.json.codigo, nome: NOME_AG, versao: '0.2.0-beta.10' }) }).then((r) => r.json())
  credencial = par.credencial
  await agente('/api/agente/impressoras', { impressoras: ['POS-80C', 'EPSON TM-T20', 'Microsoft Print to PDF'], diagnosticos: { 'POS-80C': { driver: 'POS-80C', porta: 'USB001', papelLarguraMm: 80 }, 'EPSON TM-T20': { driver: 'EPSON TM-T20 Receipt', porta: 'IP_192.168.0.50' } } })
  sinal = setInterval(() => { agente('/api/agente/trabalhos').catch(() => {}) }, 4000)
  await abrir()
  await p.waitForFunction(() => /Conectado em/.test(document.querySelector('[data-testid="assistente-situacao"]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {})
  ok('com sinal: "● Conectado em PC Tela v2" em verde', /Conectado em PC Tela v2/.test(await p.getByTestId('assistente-situacao').innerText()) && (await p.getByTestId('assistente-situacao').getAttribute('class')).includes('ok'))
  ok('versão do assistente na linha', /versão 0\.2\.0-beta\.10/.test(await p.getByTestId('assistente-versao').innerText()), await p.getByTestId('assistente-versao').innerText())

  secao('card 2 — impressoras')
  const opcoes = await p.getByTestId('adicionar-select').locator('option').allInnerTexts()
  ok('seletor com as impressoras do Windows (virtual marcada)', opcoes.some((o) => o.startsWith('POS-80C')) && opcoes.some((o) => /Microsoft Print to PDF \(virtual\)/.test(o)), opcoes.join(' | '))
  const dPos = (await um("select id from impressao_dispositivos where restaurante_id=$1 and nome_sistema='POS-80C' and agente_id=(select id from impressao_agentes where nome=$2 and restaurante_id=$1)", [L, NOME_AG])).id
  const dEps = (await um("select id from impressao_dispositivos where restaurante_id=$1 and nome_sistema='EPSON TM-T20' and agente_id=(select id from impressao_agentes where nome=$2 and restaurante_id=$1)", [L, NOME_AG])).id
  await p.getByTestId('adicionar-select').selectOption(dPos)
  await p.getByTestId('adicionar-apelido').fill('Cozinha principal')
  await p.getByTestId('adicionar-impressora').click()
  await p.getByTestId(`impressora-${dPos}`).waitFor({ timeout: 8000 })
  const linhaPos = await p.getByTestId(`apelido-${dPos}`).innerText()
  ok('com apelido: apelido em destaque e, embaixo, nome técnico + USB + papel', /^Cozinha principal/.test(linhaPos) && /POS-80C · USB · papel 80 mm/.test(linhaPos), linhaPos)
  await p.getByTestId('adicionar-select').selectOption(dEps)
  await p.getByTestId('adicionar-impressora').click()
  await p.getByTestId(`impressora-${dEps}`).waitFor({ timeout: 8000 })
  const linhaEps = await p.getByTestId(`apelido-${dEps}`).innerText()
  ok('sem apelido: só o nome técnico (e rede)', /^EPSON TM-T20/.test(linhaEps) && /rede/.test(linhaEps) && !/EPSON TM-T20 · EPSON/.test(linhaEps), linhaEps)
  ok('situação "Conectada"', /Conectada/.test(await p.getByTestId(`situacao-${dPos}`).innerText()))
  // editar apelido
  await p.getByTestId(`apelido-${dEps}`).click()
  await p.getByTestId(`apelido-input-${dEps}`).fill('Caixa da frente')
  await p.getByTestId(`apelido-input-${dEps}`).press('Enter')
  await p.waitForTimeout(1200)
  ok('editar apelido (clique no nome) grava', (await um('select apelido from impressao_dispositivos where id=$1', [dEps])).apelido === 'Caixa da frente' && /Caixa da frente/.test(await p.getByTestId(`apelido-${dEps}`).innerText()))
  // funções
  const funcao = async (d, f) => { await p.getByTestId(`funcao-${d}`).click(); await p.getByTestId(`funcao-${d}-${f}`).click(); await p.waitForTimeout(1300) }
  await funcao(dPos, 'cozinha')
  await funcao(dEps, 'caixa')
  // 2026-10-08: na tela só "Imprimir cozinha" e "Imprimir pré-conta"; sem "Comanda de entrega" nem "Outra".
  await p.keyboard.press('Escape') // o menu continua aberto depois de marcar
  await p.waitForTimeout(300)
  await p.getByTestId(`funcao-${dEps}`).click()
  const itensMenu = await p.getByTestId(`funcao-menu-${dEps}`).innerText()
  ok('menu só com as duas funções (sem Comanda de entrega e sem Outra)', /Imprimir cozinha/.test(itensMenu) && /Imprimir pré-conta/.test(itensMenu)
    && (await p.getByTestId(`funcao-${dEps}-entrega`).count()) === 0 && (await p.getByTestId(`funcao-${dEps}-outra`).count()) === 0, itensMenu)
  await p.keyboard.press('Escape')
  // Loja que já tinha a Comanda de entrega (gravada antes): continua valendo e aparece só para desmarcar.
  await db.query("insert into impressao_funcoes (restaurante_id, funcao, dispositivo_id) values ($1, 'entrega', $2) on conflict do nothing", [L, dPos])
  await abrir()
  await p.getByTestId(`impressora-${dPos}`).waitFor({ timeout: 8000 })
  const fns = (await db.query('select funcao, dispositivo_id d from impressao_funcoes where restaurante_id=$1 order by funcao', [L])).rows
  ok('funções gravadas: Cozinha e Entrega na mesma, Caixa na outra', fns.length === 3 && fns.find((x) => x.funcao === 'cozinha')?.d === dPos && fns.find((x) => x.funcao === 'entrega')?.d === dPos && fns.find((x) => x.funcao === 'caixa')?.d === dEps, JSON.stringify(fns))
  ok('item 61: "Comanda de entrega" some da tela (seletor só com Imprimir cozinha)', /^Imprimir cozinha$/.test((await p.getByTestId(`funcao-${dPos}`).innerText()).trim()))
  ok('"Aceitar pedidos sozinho" fora da impressão', (await p.getByTestId('opcao-aceitarPedidosAutomaticamente').count()) === 0)
  ok('"Uma impressora pode ter mais de uma função." no rodapé', /Uma impressora pode ter mais de uma função/.test(await p.getByTestId('passo-2').innerText()))
  await p.getByTestId(`funcao-${dPos}`).click()
  await p.screenshot({ path: join(PRINTS, '02-menu-funcao-1366.png') })
  ok('menu de função por cima de tudo (camada máxima)', Number(await p.getByTestId(`funcao-menu-${dPos}`).evaluate((e) => getComputedStyle(e).zIndex)) >= 9999)
  await p.keyboard.press('Escape')

  secao('passa a imprimir pelo novo (a loja confirma)')
  await abrir()
  await p.getByTestId('usar-novo').click()
  await p.getByTestId('confirmar-opcao-ok').click()
  await p.waitForTimeout(1500)
  ok('"Usar o assistente novo" grava Cozinha e Caixa só depois de confirmar', (await um('select impressao_beta_modo m from restaurantes where id=$1', [L])).m === 'cozinha_caixa')
  const ped = await agente('/api/agente/pedidos')
  ok('a impressão segue a função: comanda na impressora da Cozinha', ped.json?.destinoCozinha?.nomeSistema === 'POS-80C', JSON.stringify(ped.json?.destinoCozinha))
  ok('item 61: sem "Comanda de entrega" a mais e sem "Via da cozinha" no Assistente', !ped.json?.destinoEntrega && ped.json?.config?.viaCozinha === false, JSON.stringify({ d: ped.json?.destinoEntrega, v: ped.json?.config?.viaCozinha }))

  secao('item 59: QR certo em cada comanda (fila do Assistente)')
  {
    await db.query("update restaurantes set impressao_qr = true where id = $1", [L])
    const novo = (tipo) => um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, canal, origem, observacao, endereco_rua, endereco_numero, endereco_bairro, criado_em)
      values ($1,$2,'preparando',30,30,'TESTE 59 QR','27999990059','pix','delivery','cardapio','','Rua Teste 59','1','Centro', now()) returning id`, [L, tipo])
    const pe = await novo('entrega'), pr = await novo('retirada')
    // A fila só leva pedido com item.
    for (const x of [pe, pr]) await db.query("insert into pedido_itens (pedido_id, nome, preco_unitario, quantidade) values ($1, 'TESTE item 59', 30, 1)", [x.id])
    let fila = null
    for (let i = 0; i < 6 && !(fila?.qrPorPedido?.[pe.id]); i++) { fila = (await agente('/api/agente/pedidos')).json?.cozinhaBeta ?? null; if (!fila?.qrPorPedido?.[pe.id]) await new Promise((r) => setTimeout(r, 800)) }
    const qe = fila?.qrPorPedido?.[pe.id], qrr = fila?.qrPorPedido?.[pr.id]
    ok('ENTREGA: QR da rota (/r/<código>, sem dado pessoal) com "ROTA DE ENTREGA"', qe?.origem === 'rota' && /\/r\/[A-Za-z0-9_-]{35}$/.test(qe?.url ?? '') && qe?.frase === 'ROTA DE ENTREGA' && !/TESTE|2799/.test(qe?.url ?? ''), JSON.stringify(qe && { ...qe, linhas: undefined }))
    ok('item 61: RETIRADA sem QR (nunca o do cardápio)', !qrr, JSON.stringify(qrr && { ...qrr, linhas: undefined }))
    ok('item 61: campo antigo (beta.9) vazio — nenhum QR do cardápio', fila?.qr === null, JSON.stringify(fila?.qr?.origem))
    if (qe) {
      const r = await fetch(`${BASE}${new URL(qe.url).pathname}`, { redirect: 'manual' })
      ok('item 61: QR da entrega lido por uma câmera comum → app do motoboy', r.status === 302 && new URL(r.headers.get('location')).pathname === '/motoboy', `${r.status} ${r.headers.get('location')}`)
    }
    await db.query("update restaurantes set impressao_qr = false where id = $1", [L])
    const semQr = (await agente('/api/agente/pedidos')).json?.cozinhaBeta
    if (semQr?.qrPorPedido) ok('QR do cardápio desligado: retirada sem QR, entrega mantém o QR da rota', !semQr.qrPorPedido[pr.id] && (semQr.qrPorPedido[pe.id]?.origem === 'rota' || !(pe.id in semQr.qrPorPedido)), JSON.stringify(Object.keys(semQr.qrPorPedido)))
    await db.query("update restaurantes set impressao_qr = true where id = $1", [L])
    await db.query("update pedidos set status = 'cancelado' where id = any($1::uuid[])", [[pe.id, pr.id]])
    const pv = (await api('/api/admin/impressao/previa')).json
    ok('item 61: prévia com o QR da rota; pré-conta só com Instagram; sem QR do cardápio', pv?.qrRota?.origem === 'rota' && !('qrCardapio' in (pv ?? {})) && (pv?.qr === null || pv?.qr?.origem === 'instagram'), JSON.stringify({ r: pv?.qrRota?.origem, q: pv?.qr?.origem }))
  }
  const res = await api('/api/admin/impressao/resumo')
  ok('apelido no resto do sistema: topo diz "Cozinha: Cozinha principal"', res.json?.beta && res.json.cozinha === 'Cozinha principal' && res.json.online, JSON.stringify(res.json))
  await abrir()
  await p.waitForTimeout(1500)
  const rotTopo = await p.getByTestId('topo-impressora').getAttribute('aria-label')
  ok('botão da impressora no topo com o apelido', /Cozinha principal/.test(rotTopo ?? ''), rotTopo)
  ok('"Tudo certo" em verde quando conectado com Cozinha', await p.getByTestId('tudo-certo').isVisible())

  secao('Testar impressão')
  await p.getByTestId('testar-impressao').click()
  await p.getByTestId('modal-teste').waitFor({ timeout: 8000 })
  const linhasTeste = await p.getByTestId('modal-teste').locator('[data-testid^="linha-teste-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  ok('modal só com "Testar cozinha" e "Testar pré-conta"', linhasTeste.join(',') === 'linha-teste-cozinha,linha-teste-recibo', linhasTeste.join(','))
  const txtTeste = await p.getByTestId('modal-teste').innerText()
  ok('modal com os títulos certos e "Imprimir teste"', /Testar cozinha/.test(txtTeste) && /Testar pré-conta/.test(txtTeste) && (txtTeste.match(/Imprimir teste/g) ?? []).length === 2)
  ok('nada de calibração, largura ou envio no modal (só em Avançado)', !/calibr|largura|envio/i.test(txtTeste), txtTeste.slice(0, 200))
  await p.getByTestId('linha-teste-cozinha').getByRole('button', { name: /Imprimir|Testar|Enviar/ }).first().click()
  await p.waitForTimeout(1500)
  const tr = await um("select count(*)::int n from impressao_trabalhos where restaurante_id=$1 and dispositivo_id=$2 and tipo='teste_impressora'", [L, dPos])
  ok('teste enviado para a impressora da Cozinha', tr.n >= 1)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  if (await p.getByTestId('modal-teste').isVisible().catch(() => false)) await p.getByRole('button', { name: 'Fechar' }).last().click().catch(() => {})

  secao('remover')
  await p.getByTestId(`remover-${dEps}`).click()
  await p.waitForTimeout(1500)
  const rem = await um('select na_lista, (select count(*)::int from impressao_funcoes where dispositivo_id=$1) n from impressao_dispositivos where id=$1', [dEps])
  ok('remover tira da lista e tira as funções dela', rem.na_lista === false && rem.n === 0 && (await p.getByTestId(`impressora-${dEps}`).count()) === 0, JSON.stringify(rem))
  // Regra de sempre (regras-modo): Cozinha e Caixa precisa das duas — sem a do Caixa, recua com aviso.
  ok('sem a impressora do Caixa o modo recua para a segurança, com aviso', (await um('select impressao_beta_modo m from restaurantes where id=$1', [L])).m === 'teste' && /voltou para a segurança/.test(await p.getByTestId('impressao-aviso').innerText().catch(() => '')))
  // Volta ao assistente novo: Caixa também na impressora da Cozinha (duas funções) e confirma.
  await funcao(dPos, 'caixa')
  await p.keyboard.press('Escape')
  await abrir()
  await p.getByTestId('usar-novo').click()
  await p.getByTestId('confirmar-opcao-ok').click()
  await p.waitForTimeout(1500)
  ok('Caixa na mesma impressora e de volta ao novo', (await um('select impressao_beta_modo m from restaurantes where id=$1', [L])).m === 'cozinha_caixa')
  await p.screenshot({ path: join(PRINTS, '03-com-impressoras-1366.png'), fullPage: true })

  secao('card 3 — o que aparece no papel')
  const sw = await p.getByTestId('opcoes-impressao').locator('[role="switch"]').count()
  const colunas = await p.getByTestId('opcoes-impressao').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)
  ok('switches reais em 2 colunas (item 61: sem a "Via da cozinha")', sw >= 5 && colunas === 2, `${sw} switches, ${colunas} colunas`)
  await p.getByTestId('opcao-qr').click()
  await p.waitForTimeout(800)
  ok('switch grava no banco', (await um('select impressao_qr q from restaurantes where id=$1', [L])).q === false)
  await p.getByTestId('opcao-qr').click()
  await p.waitForTimeout(600)

  secao('Avançado')
  const cor = async () => p.getByTestId('abrir-avancado').evaluate((e) => getComputedStyle(e).color)
  const corAntes = await cor()
  await p.getByTestId('abrir-avancado').hover()
  await p.waitForTimeout(250)
  ok('"Avançado" cinza e roxo no hover', corAntes !== (await cor()) && (await cor()) === 'rgb(124, 58, 237)', `${corAntes} → ${await cor()}`)
  await p.getByTestId('abrir-avancado').click()
  await p.getByTestId('modal-avancado').waitFor({ timeout: 5000 })
  ok('modal com computador, largura, envio e letra — sem "Calibrar" (08/10)', await p.getByTestId('av-computador').isVisible() && await p.getByTestId('av-largura').isVisible() && await p.getByTestId('av-envio').isVisible() && await p.getByTestId('av-letra').isVisible() && (await p.getByTestId('av-calibrar').count()) === 0 && (await p.getByTestId(`calibrar-${dPos}`).count()) === 0)
  await p.screenshot({ path: join(PRINTS, '05-avancado-1366.png') })
  await p.getByTestId(`envio-${dPos}-auto`).click()
  await p.waitForTimeout(1200)
  ok('formato de envio "Automático" grava', (await um('select envio from impressao_dispositivos where id=$1', [dPos])).envio === 'auto')
  await p.getByTestId(`largura-${dPos}-58`).click()
  await p.waitForTimeout(1200)
  ok('largura 58 mm grava e vira ajuste manual (a detecção automática não mexe mais)', await um('select largura_mm, largura_manual from impressao_dispositivos where id=$1', [dPos]).then((x) => x.largura_mm === 58 && x.largura_manual === true))
  await p.getByTestId(`largura-${dPos}-80`).click()
  await p.waitForTimeout(1000)
  await p.getByTestId('trocar-computador').click()
  await p.waitForTimeout(1200)
  ok('trocar computador gera código de pareamento', /[A-Z0-9]{4}-[A-Z0-9]{4}/.test(await p.locator('body').innerText()))
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  await p.keyboard.press('Escape')

  secao('largura automática pelo driver (08/10)')
  {
    await db.query("update impressao_dispositivos set largura_manual=false, largura_mm=80, largura_pontos=null where id=$1", [dEps])
    const r = await agente('/api/agente/impressoras', { impressoras: ['POS-80C', 'EPSON TM-T20', 'Microsoft Print to PDF'], diagnosticos: { 'EPSON TM-T20': { papelLarguraMm: 58, dpiX: 203 } } })
    const x = await um('select largura_mm, largura_pontos from impressao_dispositivos where id=$1', [dEps])
    ok('driver informa 58 mm → 58 mm / 384 pontos, sem ninguém ajustar', r.status === 200 && x.largura_mm === 58 && x.largura_pontos === 384, JSON.stringify({ s: r.status, x }))
    await db.query("update impressao_dispositivos set largura_manual=true where id=$1", [dEps])
    await agente('/api/agente/impressoras', { impressoras: ['POS-80C', 'EPSON TM-T20', 'Microsoft Print to PDF'], diagnosticos: { 'EPSON TM-T20': { papelLarguraMm: 80 } } })
    ok('com ajuste manual (suporte), a detecção não mexe', (await um('select largura_mm from impressao_dispositivos where id=$1', [dEps])).largura_mm === 58)
    await db.query("update impressao_dispositivos set largura_manual=false, largura_mm=80, largura_pontos=null where id=$1", [dEps])
  }

  secao('loja só do assistente novo (0161)')
  {
    await db.query("update restaurantes set impressao_somente_nova=true where id=$1", [L])
    await abrir()
    await p.getByTestId('abrir-avancado').click(); await p.getByTestId('modal-avancado').waitFor({ timeout: 5000 })
    ok('sem "Usar impressão antiga" nem seção do antigo', (await p.getByTestId('voltar-antigo').count()) === 0 && (await p.getByTestId('av-antigo').count()) === 0)
    await p.keyboard.press('Escape')
    const volta = await api('/api/admin/impressao/modo', 'PUT', { modo: 'teste' })
    ok('servidor recusa voltar para o antigo', volta.status === 409, `${volta.status}`)
    const tok = await api('/api/admin/impressao/token', 'POST')
    ok('servidor recusa gerar token do assistente antigo', tok.status === 409, `${tok.status}`)
    await db.query("update restaurantes set impressao_somente_nova=false where id=$1", [L])
  }

  secao('computador duplicado (mesmo PC pareado duas vezes)')
  {
    // Pareamento ANTIGO do mesmo PC (sem sinal), com a mesma impressora na lista. Limpo no fim junto com NOME_AG.
    const velho = (await um("insert into impressao_agentes (restaurante_id, nome, credencial_hash, criado_em) values ($1, $2, $3, now() - interval '2 days') returning id", [L, NOME_AG, (await import('node:crypto')).createHash('sha256').update(`teste-dup-${Date.now()}`).digest('hex')])).id
    await db.query("insert into impressao_dispositivos (restaurante_id, agente_id, nome_sistema, na_lista) values ($1, $2, 'POS-80C', true)", [L, velho])
    await abrir()
    const linhas = await p.locator('[data-testid^="impressora-"]').evaluateAll((els) => els.map((e) => e.innerText))
    ok('impressora aparece uma vez só na lista', linhas.filter((t) => /POS-80C/.test(t)).length === 1, JSON.stringify(linhas))
    ok('resumo do card 1 usa o pareamento novo', /Conectado em PC Tela v2/.test(await p.getByTestId('assistente-situacao').innerText()))
    await p.getByTestId('abrir-avancado').click()
    await p.getByTestId('modal-avancado').waitFor({ timeout: 5000 })
    ok('Avançado › Computador mostra o antigo marcado, para desconectar', /pareamento antigo/.test(await p.getByTestId(`av-agente-${velho}`).innerText()))
    await p.keyboard.press('Escape')
    await p.waitForTimeout(300)
  }

  secao('peso e contraste')
  await abrir()
  const pesos = await p.evaluate(() => Math.max(...[...document.querySelectorAll('.tela-impressao *')].filter((e) => e.offsetParent && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => Number(getComputedStyle(e).fontWeight))))
  ok(`nenhum texto acima de 600 (máximo ${pesos})`, pesos <= 600)
  const fonte = await p.getByTestId('painel-impressao').evaluate((e) => getComputedStyle(e).fontFamily)
  ok('fonte dos menus (Nunito)', /Nunito/.test(fonte), fonte)
  const pares = await p.evaluate(() => [...document.querySelectorAll('.tela-impressao .ti-btn.pri, .ti-btn.pri-roxo, .ti-sub, .ti-rot, .ti-aviso span, .ti-eyebrow, .ti-estado, .ti-nome small, .ti-avancado, .ti-tudo-certo, .ti-opt small, .ti-funcao')].filter((e) => e.offsetParent).map((e) => {
    let b = getComputedStyle(e).backgroundColor, x = e
    while (b === 'rgba(0, 0, 0, 0)' && x.parentElement) { x = x.parentElement; b = getComputedStyle(x).backgroundColor }
    return [getComputedStyle(e).color, b, e.className]
  }))
  const notas = pares.map(([c, b, k]) => [contraste(c, b), k])
  const pior = notas.sort((a, b) => a[0] - b[0])[0]
  ok(`contraste ≥ 4,5:1 (menor ${pior[0].toFixed(2)} em ${notas.length} elementos)`, pior[0] >= 4.5, String(pior[1]))

  secao('celular')
  for (const w of [360, 390, 430]) {
    const cx = await browser.newContext({ viewport: { width: w, height: 800 }, locale: 'pt-BR', storageState: await ctx.storageState() })
    const m = await cx.newPage()
    await m.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
    await m.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
    await m.getByTestId('passo-2').waitFor({ timeout: 20000 })
    await m.waitForTimeout(800)
    const r = await m.evaluate(() => ({ lateral: document.querySelector('[data-testid="impressao-rolagem"]').scrollWidth <= innerWidth + 1, cols: getComputedStyle(document.querySelector('[data-testid="opcoes-impressao"]')).gridTemplateColumns.split(' ').length }))
    ok(`${w}px: sem rolagem lateral e switches em 1 coluna`, r.lateral && r.cols === 1, JSON.stringify(r))
    if (w === 390) await m.screenshot({ path: join(PRINTS, '06-celular-390.png'), fullPage: true })
    await m.getByTestId('abrir-avancado').click()
    await m.getByTestId('modal-avancado').waitFor({ timeout: 5000 })
    const t = await m.getByTestId('modal-avancado').evaluate((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight } })
    ok(`${w}px: Avançado em tela cheia`, t.w === t.vw && t.h === t.vh, JSON.stringify(t))
    if (w === 390) await m.screenshot({ path: join(PRINTS, '07-celular-avancado-390.png') })
    await m.keyboard.press('Escape')
    await cx.close()
  }
} catch (e) {
  ok('execução sem exceção', false, String(e?.stack ?? e).slice(0, 600))
} finally {
  if (sinal) clearInterval(sinal)
  await browser.close()
  await fecharRender().catch(() => {})
  await limpar()
  await db.query(`update restaurantes set impressao_beta_modo=$2, impressao_beta_liberado=$3, impressao_cozinha_por_funcao=$4, impressao_via_cozinha=$5, impressao_qr=$6, impressao_logo=$7, impressao_agente_visto_em=$8, impressao_cozinha_transferida_em=$9 where id=$1`,
    [L, antes.impressao_beta_modo, antes.impressao_beta_liberado, antes.impressao_cozinha_por_funcao, antes.impressao_via_cozinha, antes.impressao_qr, antes.impressao_logo, antes.impressao_agente_visto_em, antes.impressao_cozinha_transferida_em])
  await db.end()
}
console.log(`\n${falhas === 0 ? '✅' : '❌'} ${total - falhas}/${total} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)
