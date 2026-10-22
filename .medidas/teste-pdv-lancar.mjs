// Lançar no PDV continua igual depois do redesign visual (22/10/2026) — servidor LOCAL, loja Menuzia.
// Um balcão (retirada, "Receber na retirada") por forma: dinheiro (troco p/ 50), Pix, crédito, débito. Confere no banco
// a forma/troco/cartão de cada pedido e no fim fecha tudo como "Cancelado · Pedido teste" (pedidos e contas).
//   node .medidas/teste-pdv-lancar.mjs            → lança e confere
//   node .medidas/teste-pdv-lancar.mjs limpar     → só fecha as contas "Teste PDV%"
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2] }
const BASE = process.env.BASE ?? 'http://localhost:3001'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: loja } = await admin.from('restaurantes').select('id, slug').eq('slug', 'menuzia').single()
if (loja.slug !== 'menuzia') throw new Error('loja errada')

async function limpar() {
  const { data: cs } = await admin.from('comandas').select('id, senha, status').eq('restaurante_id', loja.id).like('cliente_nome', 'Teste PDV%').in('status', ['aberta'])
  for (const c of cs ?? []) {
    await admin.from('pedidos').update({ status: 'cancelado', cancelado_motivo: 'teste', cancelado_observacao: 'Teste PDV visual', cancelado_por: 'Loja: Teste', cancelado_em: new Date().toISOString(), reimprimir: false })
      .eq('restaurante_id', loja.id).eq('comanda_id', c.id).neq('status', 'cancelado')
    const { error } = await admin.rpc('comanda_cancelar', { p_restaurante: loja.id, p_comanda: c.id, p_motivo: 'Pedido teste', p_ator: null, p_ator_nome: 'Teste' })
    console.log(`conta senha ${c.senha}:`, error ? `ERRO ${error.message}` : 'cancelada')
  }
}
if (process.argv[2] === 'limpar') { await limpar(); process.exit(0) }

const nav = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await (await nav.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
const tirarPortal = () => p.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()))
await p.goto(`${BASE}/login`, { timeout: 180_000 })
await p.fill('input[name="email"]', process.env.SEED_ADMIN_EMAIL); await p.fill('input[name="password"]', process.env.SEED_ADMIN_PASSWORD)
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180_000 }), p.click('button[type="submit"]')])
await p.goto(`${BASE}/admin/pdv`, { waitUntil: 'domcontentloaded', timeout: 180_000 }); await p.waitForTimeout(12000); await tirarPortal()
const resultados = []
try {
  for (const forma of ['dinheiro', 'pix', 'credito', 'debito']) {
    await p.getByText('Central de balcão').first().click().catch(() => {}); await p.waitForTimeout(3000); await tirarPortal()
    await p.locator('[data-testid="balcao-novo"]').click(); await p.waitForTimeout(1200)
    await p.locator('[data-testid="balcao-modalidade-retirada"]').click()
    await p.locator('[data-testid="balcao-nome"]').fill(`Teste PDV ${forma}`)
    await p.locator('[data-testid="balcao-abrir"]').click(); await p.waitForTimeout(5000); await tirarPortal()
    const cards = p.locator('button[aria-label^="Adicionar "]').filter({ hasNotText: 'config' })
    for (let i = 0; i < 12; i++) {
      await cards.nth(i).click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(700)
      if (await p.locator('[data-tela-pdv]').count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(700); continue }
      break
    }
    await p.locator(`[data-testid="pdv-pag-${forma}"]`).click(); await p.waitForTimeout(400)
    if (forma === 'dinheiro') { await p.locator('[data-testid="pdv-troco-sim"]').click(); await p.locator('[data-testid="pdv-troco-valor"]').fill('50') }
    const alvo = await p.locator('[data-testid="pdv-alvo"]').innerText()
    await p.locator('[data-testid="pdv-lancar"]').click(); await p.waitForTimeout(5000)
    const toast = await p.locator('[data-testid="pdv-toast-lancado"]').innerText().catch(() => '(sem toast)')
    const senha = Number(/Senha (\d+)/.exec(alvo)?.[1])
    const { data: c } = await admin.from('comandas').select('id').eq('restaurante_id', loja.id).eq('senha', senha).order('aberta_em', { ascending: false }).limit(1).single()
    const { data: ped } = await admin.from('pedidos').select('numero, forma_pagamento, cartao_tipo, troco_para, pago, status, total').eq('comanda_id', c.id).order('criado_em', { ascending: false }).limit(1).maybeSingle()
    resultados.push({ forma, senha, toast: toast.replace(/\s+/g, ' ').slice(0, 60), pedido: ped })
    console.log(forma, '→', JSON.stringify(ped), '|', toast.replace(/\s+/g, ' ').slice(0, 60))
    await p.locator('[data-testid="pdv-voltar-mesas"]').click().catch(() => {}); await p.waitForTimeout(2500)
  }
} catch (e) { console.log('PAROU:', e.message); await p.screenshot({ path: '.medidas/pdv-visual/erro-lancar.png' }).catch(() => {}) }
await nav.close()
const esperado = { dinheiro: ['dinheiro', null, 50], pix: ['pix', null, null], credito: ['cartao', 'credito', null], debito: ['cartao', 'debito', null] }
for (const r of resultados) {
  const [f, ct, tr] = esperado[r.forma]
  const ok = r.pedido && r.pedido.forma_pagamento === f && (r.pedido.cartao_tipo ?? null) === ct && (r.pedido.troco_para === null ? null : Number(r.pedido.troco_para)) === tr
  console.log(ok ? 'OK ' : 'FALHOU', r.forma)
}
await limpar()
