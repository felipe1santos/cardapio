// Teste das formas de pagamento por canal (0217, 21/10/2026) — SÓ Menuzia, em produção.
// Perfil: marca Vale (Alelo) na entrega e tira o crédito da retirada → salva. Vitrine (API pública): aceita o marcado e
// recusa o resto. Kanban mostra "VR · Alelo". No fim a Menuzia volta ao que era (coluna nula) e os pedidos viram teste.
//   node .medidas/teste-formas-pagamento.mjs <senha do gerente.aprovador>
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2] }
const BASE = 'https://app.menuzia.com.br'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: loja } = await admin.from('restaurantes').select('id, slug, formas_pagamento, formas_pagamento_mesa').eq('slug', 'menuzia').single()
if (loja.slug !== 'menuzia') throw new Error('loja errada')
const log = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), ...a)
const ITEM = '58030688-26b9-48b5-9fe4-9b9e26592670'
const pedidos = []
const pedir = async (extra, tipo = 'entrega') => {
  const r = await fetch(`${BASE}/api/loja/menuzia/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo, cliente: { nome: 'Teste Formas Pagamento', telefone: '27999990002' },
    endereco: tipo === 'entrega' ? { rua: 'Rua Teste', numero: '10', complemento: 'TESTE - não entregar', bairro: 'Jaburuna', cep: '29102000', cidade: 'Vila Velha', referencia: '' } : { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
    itens: [{ itemId: ITEM, quantidade: 1, observacao: 'TESTE formas de pagamento', complementos: [] }], chavePedido: `fp-${randomUUID()}`, ...extra }) })
  const j = await r.json().catch(() => ({}))
  if (j.id) pedidos.push(j.id)
  return { s: r.status, j }
}

log('antes: formas_pagamento =', JSON.stringify(loja.formas_pagamento), '| mesa =', JSON.stringify(loja.formas_pagamento_mesa))
const nav = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await (await nav.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
try {
  await p.goto(`${BASE}/login`); await p.fill('input[name="email"]', 'gerente.aprovador'); await p.fill('input[name="password"]', process.argv[2])
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 }), p.click('button[type="submit"]')])
  // Perfil é só do dono: a tela roda no servidor local (mesmo banco) com o login de teste do projeto (.env.local).
  const LOCAL = process.env.LOCAL ?? 'http://localhost:3001'
  const dono = await (await nav.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
  await dono.goto(`${LOCAL}/login`, { timeout: 180_000 }); await dono.fill('input[name="email"]', process.env.SEED_ADMIN_EMAIL); await dono.fill('input[name="password"]', process.env.SEED_ADMIN_PASSWORD)
  await Promise.all([dono.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180_000 }), dono.click('button[type="submit"]')])
  await dono.goto(`${LOCAL}/admin/ajustes`, { waitUntil: 'domcontentloaded', timeout: 180_000 }); await dono.waitForTimeout(15000)
  await dono.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()))
  const secao = dono.locator('[data-testid="secao-formas-pagamento"]')
  await secao.scrollIntoViewIfNeeded()
  await secao.screenshot({ path: '.medidas/formas-1-antes.png' })
  const marcado = async (id) => dono.locator(`[data-testid="${id}"]`).isChecked()
  log('tela (legado): pix entrega', await marcado('forma-pix-entrega'), '| crédito retirada', await marcado('forma-credito-retirada'), '| dinheiro entrega', await marcado('forma-dinheiro-entrega'))
  await dono.locator('[data-testid="forma-vale-entrega"]').check()
  await dono.locator('[data-testid="vale-bandeiras-perfil"] label', { hasText: 'Alelo' }).locator('input').check()
  await dono.locator('[data-testid="forma-credito-retirada"]').uncheck()
  await secao.screenshot({ path: '.medidas/formas-2-marcado.png' })
  await dono.getByRole('button', { name: 'Salvar alterações' }).first().click(); await dono.waitForTimeout(5000)
  const { data: depois } = await admin.from('restaurantes').select('formas_pagamento').eq('id', loja.id).single()
  log('salvo:', JSON.stringify(depois.formas_pagamento))

  const a = await pedir({ pagamento: 'vale', valeBandeira: 'Alelo' })
  log('entrega vale Alelo →', a.s, a.j.numero ? `#${a.j.numero}` : a.j.error)
  const b = await pedir({ pagamento: 'vale', valeBandeira: 'Ticket' })
  log('entrega vale Ticket →', b.s, b.j.error ?? '')
  const c = await pedir({ pagamento: 'cartao', cartaoTipo: 'credito' }, 'retirada')
  log('retirada crédito →', c.s, c.j.error ?? '')
  const d = await pedir({ pagamento: 'cartao', cartaoTipo: 'debito' }, 'retirada')
  log('retirada débito →', d.s, d.j.numero ? `#${d.j.numero}` : d.j.error)
  const { data: pv } = await admin.from('pedidos').select('numero, forma_pagamento, vale_bandeira, cartao_tipo').in('id', pedidos)
  log('no banco:', JSON.stringify(pv))

  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(9000)
  await p.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()))
  if (a.j.numero) {
    const card = p.locator(`[data-testid="pedido-${a.j.numero}"]`).first()
    await card.scrollIntoViewIfNeeded().catch(() => {})
    log('card #' + a.j.numero + ':', (await card.innerText().catch(() => '?')).replace(/\n/g, ' | ').slice(0, 160))
    await card.screenshot({ path: '.medidas/formas-3-card-vale.png' }).catch(() => {})
  }

} catch (e) {
  log('PAROU:', e.message)
  await p.screenshot({ path: '.medidas/formas-erro.png' }).catch(() => {})
} finally {
  for (const id of pedidos) await admin.from('pedidos').update({ status: 'cancelado', cancelado_motivo: 'teste', cancelado_observacao: 'Teste formas de pagamento', cancelado_por: 'Loja: Teste', cancelado_em: new Date().toISOString(), reimprimir: false }).eq('id', id).eq('restaurante_id', loja.id)
  await admin.from('restaurantes').update({ formas_pagamento: loja.formas_pagamento }).eq('id', loja.id)
  log(`${pedidos.length} pedido(s) de teste cancelados; Menuzia voltou a formas_pagamento =`, JSON.stringify(loja.formas_pagamento))
  await nav.close()
}
