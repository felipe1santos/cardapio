// Teste da Uber Direct (21/10/2026) — SÓ Menuzia, conta de TESTE da Uber (Robo Courier, sem corrida real).
// Cria um pedido de teste pronto/pago, cota e confirma pela API do painel (gerente de teste), acompanha a corrida
// (webhook) até "entregue" e fecha o pedido como Cancelado · Pedido teste.
//   node .medidas/teste-uber-direct.mjs <senha do gerente.aprovador>
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2] }
const BASE = 'https://app.menuzia.com.br'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: loja } = await admin.from('restaurantes').select('id, slug').eq('slug', 'menuzia').single()
if (loja.slug !== 'menuzia') throw new Error('loja errada')
const log = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), ...a)

const itens = [{ nome: 'Mega Burguer', preco_unitario: 24, quantidade: 1, observacao: '', complementos: [] }]
const { data: ped, error } = await admin.from('pedidos').insert({
  restaurante_id: loja.id, origem: 'cardapio', canal: 'delivery', origem_canal: 'direto', origem_detalhe: { teste: true, uber_direct: true },
  tipo: 'entrega', status: 'pronto', pronto_em: new Date().toISOString(), cliente_nome: 'Teste Uber Direct', cliente_telefone: '27999990002', telefone_verificado: true,
  forma_pagamento: 'pix', pago: true, pagamento_online: true, subtotal: 24, taxa_entrega: 0, total: 24, impresso: true, reimprimir: false,
  endereco_rua: 'Rua Henrique Moscoso', endereco_numero: '1000', endereco_complemento: 'TESTE - não entregar', endereco_bairro: 'Praia da Costa', endereco_cep: '29101345', endereco_cidade: 'Vila Velha',
  entrega_latitude: -20.3355, entrega_longitude: -40.2873,
}).select('id, numero').single()
if (error) throw error
await admin.from('pedido_itens').insert(itens.map((i) => ({ ...i, pedido_id: ped.id })))
log(`pedido de teste #${ped.numero} criado (pronto, pago)`)

const nav = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await (await nav.newContext()).newPage()
await p.goto(`${BASE}/login`); await p.fill('input[name="email"]', 'gerente.aprovador'); await p.fill('input[name="password"]', process.argv[2])
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 }), p.click('button[type="submit"]')])
const fechar = async (motivo) => {
  await admin.from('pedidos').update({ status: 'cancelado', cancelado_motivo: 'teste', cancelado_observacao: `Teste Uber Direct (${motivo})`, cancelado_por: 'Loja: Teste', cancelado_em: new Date().toISOString(), reimprimir: false }).eq('id', ped.id).eq('restaurante_id', loja.id)
  log(`pedido #${ped.numero} fechado como Cancelado · Pedido teste`)
}
try {
  const cfg = await (await p.request.get(`${BASE}/api/admin/entregas/uber/config`)).json()
  log('config: ambiente', cfg.config?.ambiente, '| ligado', cfg.config?.ativo)
  const t = await p.request.post(`${BASE}/api/admin/entregas/uber/config`, { data: { acao: 'testar' } })
  log('testar conexão:', t.status(), (await t.json()).mensagem ?? '')
  if (!t.ok()) throw new Error('credenciais recusadas')
  const rc = await p.request.post(`${BASE}/api/admin/entregas/uber/cotacao`, { data: { pedidoId: ped.id } })
  const cot = await rc.json()
  log('cotação:', rc.status(), rc.ok() ? `R$ ${cot.preco} · prazo ${cot.prazoMin} min · id ${String(cot.quotationId).slice(0, 8)}…` : cot.error)
  if (!rc.ok()) throw new Error('cotação recusada')
  const rch = await p.request.post(`${BASE}/api/admin/entregas/uber/chamar`, { data: { pedidoId: ped.id, cotacao: cot } })
  const ch = await rch.json()
  log('confirmar:', rch.status(), rch.ok() ? `corrida ${String(ch.corrida?.externoId).slice(0, 12)}… status ${ch.corrida?.status}` : ch.error)
  if (!rch.ok()) throw new Error('corrida recusada')
  let ultimo = ''
  for (let i = 0; i < 40; i++) {
    const { data: c } = await admin.from('entregas_provedor').select('status, motorista_nome, share_link, preco, ambiente').eq('pedido_id', ped.id).order('criado_em', { ascending: false }).limit(1).single()
    const { data: pp } = await admin.from('pedidos').select('status').eq('id', ped.id).single()
    const atual = `${c.status} / pedido ${pp.status}${c.motorista_nome ? ` / entregador ${c.motorista_nome}` : ''}`
    if (atual !== ultimo) { log('→', atual); ultimo = atual }
    // Print do card no Kanban durante a entrega (uma vez, com entregador a caminho ou já com o pedido).
    if (!globalThis.printFeito && ['ON_GOING', 'PICKED_UP'].includes(c.status)) {
      globalThis.printFeito = true
      await p.setViewportSize({ width: 1440, height: 900 })
      await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(8000)
      const card = p.locator(`text=#${ped.numero}`).first()
      if (await card.count()) await card.scrollIntoViewIfNeeded().catch(() => {})
      await p.screenshot({ path: '.medidas/uber-kanban-durante.png' })
      log('print do Kanban salvo (.medidas/uber-kanban-durante.png)')
    }
    if (['COMPLETED', 'CANCELED', 'REJECTED'].includes(c.status)) break
    await new Promise((r) => setTimeout(r, 15_000))
  }
  const { data: ev } = await admin.from('entregas_provedor').select('id, eventos').eq('pedido_id', ped.id).limit(1).single()
  log('eventos registrados:', Array.isArray(ev?.eventos) ? ev.eventos.length : '?')
} catch (e) {
  log('PAROU:', e.message)
} finally {
  await fechar('fim do teste')
  await nav.close()
}
