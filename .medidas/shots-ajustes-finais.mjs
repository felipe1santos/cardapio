// Prints dos 3 ajustes finais de 18/10 (local, sessão do dono no Playwright, pedido de teste da MENUZIA):
//  1. coluna "Entregas & concluídos" com os cards no padrão das outras colunas
//  2. setinha do card da loja recolhe/abre o menu lateral
//  3. observação do pedido com fundo vermelho no painel
//   node .medidas/shots-ajustes-finais.mjs <perfil> [base]
import { readFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const [PERFIL, BASE = 'http://localhost:3000'] = process.argv.slice(2)
const TEL = '27992534407', ITEM = '58030688-26b9-48b5-9fe4-9b9e26592670'
const DIR = '.shots/redesign-kanban/ajustes-finais'
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const { data: loja } = await admin.from('restaurantes').select('id, status_loja').eq('slug', 'menuzia').single()
const statusOriginal = loja.status_loja
await admin.from('restaurantes').update({ status_loja: 'aberto_manual' }).eq('id', loja.id)
mkdirSync(DIR, { recursive: true })
const ctx = await chromium.launchPersistentContext(PERFIL, { headless: true, viewport: { width: 1366, height: 768 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
const p = ctx.pages()[0] ?? await ctx.newPage()
let id = null
const errosConsole = []
p.on('console', (m) => { if (m.type() === 'error') errosConsole.push(m.text().slice(0, 300)) })
p.on('pageerror', (e) => errosConsole.push('pageerror: ' + String(e.message).slice(0, 300)))
try {
  const r = await fetch(`${BASE}/api/loja/menuzia/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'entrega', cliente: { nome: 'Teste Ajustes Finais', telefone: TEL }, endereco: { rua: 'Rua Teste Kanban', numero: '10', complemento: 'TESTE - não entregar', bairro: 'Jaburuna', cep: '29102000', cidade: 'Vila Velha', referencia: '' },
    pagamento: 'dinheiro', trocoPara: null, observacao: 'Sem cebola e capricha no molho, por favor', itens: [{ itemId: ITEM, quantidade: 1, observacao: '', complementos: [] }], chavePedido: `af-${randomUUID()}` }) })
  const j = await r.json(); id = j.pedidoId ?? j.id ?? j.pedido?.id
  if (!id) console.log('criar falhou', r.status, JSON.stringify(j).slice(0, 200))
  // A rota pública só tem observação por item; a do pedido (vitrine antiga/robô) vai direto no banco para o print.
  if (id) await admin.from('pedidos').update({ observacao: 'Sem cebola e capricha no molho, por favor' }).eq('id', id)
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'domcontentloaded' })
  await p.evaluate(() => { localStorage.setItem('menuzia:kanban-col4', '1'); localStorage.setItem('menuzia:menu-recolhido', '0') })
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('[data-testid="kanban-quadro"]', { timeout: 120_000 }); await espera(2500)
  await p.screenshot({ path: `${DIR}/01-entregas-concluidos.png` })
  const fluxo = await p.locator('[data-testid^="fluxo-"]').count()
  console.log('cards em Entregas & concluídos:', fluxo)
  // 2) menu recolhido
  await p.locator('[data-testid="menu-recolher"]:visible').first().click(); await espera(600)
  const recolhido = await p.locator('[data-menu-principal][data-recolhido="1"]').count()
  console.log('menu recolhido:', recolhido === 1, 'largura do menu:', await p.locator('[data-menu-principal]').evaluate((e) => e.closest('aside')?.getBoundingClientRect().width ?? e.parentElement.getBoundingClientRect().width))
  await p.screenshot({ path: `${DIR}/02-menu-recolhido.png` })
  await p.locator('[data-testid="menu-recolher"]:visible').first().click(); await espera(600)
  console.log('menu aberto de novo:', (await p.locator('[data-menu-principal][data-recolhido="1"]').count()) === 0)
  await p.screenshot({ path: `${DIR}/03-menu-aberto.png` })
  // 3) painel com observação vermelha
  if (id) {
    const { data: ped } = await admin.from('pedidos').select('numero').eq('id', id).single()
    await p.locator(`[data-testid="pedido-${ped.numero}"]`).click(); await espera(900)
    const obs = p.locator('[data-testid="painel-observacao"], [data-testid*="observacao"]').first()
    console.log('observação no painel:', await obs.count(), await obs.evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => '-'), (await obs.textContent().catch(() => ''))?.trim().slice(0, 80))
    await p.screenshot({ path: `${DIR}/04-painel-obs-vermelha.png` })
  }
  console.log('erros de console:', errosConsole.length); for (const e of errosConsole.slice(0, 8)) console.log('  -', e)
  console.log('prints em', DIR)
} finally {
  await admin.from('restaurantes').update({ status_loja: statusOriginal }).eq('id', loja.id)
  if (id) await admin.from('pedidos').update({ status: 'cancelado', cancelado_motivo: 'nao_entregue', cancelado_observacao: 'Pedido de teste (ajustes finais)', cancelado_por: 'Teste', cancelado_em: new Date().toISOString() }).eq('id', id)
  await ctx.close()
}
