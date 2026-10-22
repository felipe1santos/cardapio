// Teste do "Cobrar por Pix e chamar" (21/10/2026) — SÓ Menuzia, Uber em modo TESTE (sem corrida real).
// Pedido de teste em dinheiro, pronto: caixa no card → Pix gerado (não pago) → vencido pelo cron → motoboy próprio.
// Depois simula o Pix pago (pago=true no banco) e confirma: o servidor cota e chama a Uber de teste; a corrida é cancelada.
//   node .medidas/teste-pix-parceiro.mjs <senha do gerente.aprovador>
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2] }
const BASE = 'https://app.menuzia.com.br'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: loja } = await admin.from('restaurantes').select('id, slug').eq('slug', 'menuzia').single()
if (loja.slug !== 'menuzia') throw new Error('loja errada')
const log = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), ...a)
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const { data: ped, error } = await admin.from('pedidos').insert({
  restaurante_id: loja.id, origem: 'cardapio', canal: 'delivery', origem_canal: 'direto', origem_detalhe: { teste: true, pix_parceiro: true },
  tipo: 'entrega', status: 'pronto', pronto_em: new Date().toISOString(), cliente_nome: 'Teste Pix Parceiro', cliente_telefone: '27999990002', telefone_verificado: true,
  forma_pagamento: 'dinheiro', troco_para: 50, pago: false, subtotal: 24, taxa_entrega: 0, total: 24, impresso: true, reimprimir: false,
  endereco_rua: 'Rua Henrique Moscoso', endereco_numero: '1000', endereco_complemento: 'TESTE - não entregar', endereco_bairro: 'Praia da Costa', endereco_cep: '29101345', endereco_cidade: 'Vila Velha',
  entrega_latitude: -20.3355, entrega_longitude: -40.2873,
}).select('id, numero').single()
if (error) throw error
await admin.from('pedido_itens').insert([{ nome: 'Mega Burguer', preco_unitario: 24, quantidade: 1, observacao: '', complementos: [], pedido_id: ped.id }])
log(`pedido de teste #${ped.numero} criado (pronto, dinheiro, a receber)`)

const nav = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await (await nav.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto(`${BASE}/login`); await p.fill('input[name="email"]', 'gerente.aprovador'); await p.fill('input[name="password"]', process.argv[2])
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 }), p.click('button[type="submit"]')])
const estado = async () => (await admin.from('pedidos').select('pago, forma_pagamento, parceiro_pix').eq('id', ped.id).single()).data
const kanban = async () => { await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(9000); await p.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove())) }
const card = () => p.locator(`[data-testid="pedido-${ped.numero}"]`).first()
try {
  const at = await (await p.request.get(`${BASE}/api/admin/entregas/ativos`)).json()
  log('ativos:', at.ativos, '| pixOnline', at.pixOnline)
  await kanban()
  await card().scrollIntoViewIfNeeded().catch(() => {})
  await card().locator('[data-testid="card-uber"]').click(); await p.waitForTimeout(7000)
  await p.screenshot({ path: '.medidas/pix-parceiro-1-caixa.png' })
  log('caixa:', (await p.locator('[data-testid="parceiro-pix-caixa"]').innerText().catch(() => 'NÃO APARECEU')).replace(/\n/g, ' | '))
  await p.locator('[data-testid="parceiro-pix-cobrar"]').click(); await p.waitForTimeout(6000)
  log('aviso:', (await p.locator('[data-testid="parceiro-pix-aviso"]').innerText().catch(() => '(sem aviso — WhatsApp saiu)')).slice(0, 90))
  log('estado:', JSON.stringify(await estado()))
  const { data: cob } = await admin.from('pagamentos_online').select('status, valor, finalidade, contexto').eq('pedido_id', ped.id).order('criado_em', { ascending: false }).limit(1).single()
  log('cobrança:', JSON.stringify(cob))
  await p.keyboard.press('Escape'); await kanban(); await card().scrollIntoViewIfNeeded().catch(() => {})
  await p.screenshot({ path: '.medidas/pix-parceiro-2-aguardando.png' })
  // 10 min sem pagar: adianta o relógio do fluxo e espera o cron de 1 min.
  const pp = (await estado()).parceiro_pix
  await admin.from('pedidos').update({ parceiro_pix: { ...pp, desde: new Date(Date.now() - 11 * 60_000).toISOString() } }).eq('id', ped.id)
  for (let i = 0; i < 12 && (await estado()).parceiro_pix?.estado !== 'vencido'; i++) await espera(10_000)
  log('após cron:', (await estado()).parceiro_pix?.estado)
  const { data: al } = await admin.from('fin_alertas').select('tipo, mensagem').eq('restaurante_id', loja.id).eq('tipo', 'pix_parceiro_vencido').order('criado_em', { ascending: false }).limit(1).maybeSingle()
  log('alarme:', al?.mensagem ?? '(nenhum)')
  await kanban(); await card().scrollIntoViewIfNeeded().catch(() => {})
  await p.screenshot({ path: '.medidas/pix-parceiro-3-vencido.png' })
  await card().locator('[data-testid="parceiro-pix-usar-motoboy"]').click(); await p.waitForTimeout(5000)
  const { data: cob2 } = await admin.from('pagamentos_online').select('status').eq('pedido_id', ped.id).order('criado_em', { ascending: false }).limit(1).single()
  log('motoboy próprio → parceiro_pix', JSON.stringify((await estado()).parceiro_pix), '| cobrança', cob2.status)
  // Pix pago (simulado no banco) → confirmar: cota e chama a Uber de TESTE.
  await admin.from('pedidos').update({ pago: true, pagamento_online: true, forma_pagamento: 'pix', troco_para: null, parceiro_pix: { provedor: 'uber', estado: 'erro', preco: 14.3, desde: new Date().toISOString(), erro: 'simulado' } }).eq('id', ped.id)
  const rc = await p.request.post(`${BASE}/api/admin/entregas/uber/pix`, { data: { acao: 'confirmar', pedidoId: ped.id } })
  log('confirmar após pago:', rc.status(), JSON.stringify(await rc.json()))
  const { data: c } = await admin.from('entregas_provedor').select('id, status, preco, ambiente').eq('pedido_id', ped.id).order('criado_em', { ascending: false }).limit(1).maybeSingle()
  log('corrida:', JSON.stringify(c), '| parceiro_pix', JSON.stringify((await estado()).parceiro_pix))
  if (c) { const r = await p.request.post(`${BASE}/api/admin/entregas/uber/corrida`, { data: { acao: 'cancelar', corridaId: c.id } }); log('cancelar corrida:', r.status()) }
} catch (e) {
  log('PAROU:', e.message)
  await p.screenshot({ path: '.medidas/pix-parceiro-erro.png' }).catch(() => {})
} finally {
  await admin.from('pedidos').update({ status: 'cancelado', cancelado_motivo: 'teste', cancelado_observacao: 'Teste Pix parceiro', cancelado_por: 'Loja: Teste', cancelado_em: new Date().toISOString(), reimprimir: false, parceiro_pix: null }).eq('id', ped.id).eq('restaurante_id', loja.id)
  log(`pedido #${ped.numero} fechado como Cancelado · Pedido teste`)
  await nav.close()
}
