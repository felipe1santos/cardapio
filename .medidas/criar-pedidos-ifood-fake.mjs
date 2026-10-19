// Bloco E (19/10): pedidos FAKE de origem iFood na Menuzia (SÓ Menuzia, marcados como teste) para o dono ver o logo
// no card e no painel. Entram já "impressos" (o Assistente não imprime) e sem WhatsApp. Um 3º pedido entra como
// cancelado pelo cliente (robô) para o print da coluna "Cancelados".
//   node .medidas/criar-pedidos-ifood-fake.mjs            cria
//   node .medidas/criar-pedidos-ifood-fake.mjs --fechar   fecha todos os "Teste iFood" abertos (cancelado · motivo teste)
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: loja } = await admin.from('restaurantes').select('id, slug').eq('slug', 'menuzia').single()
if (loja?.slug !== 'menuzia') throw new Error('loja errada')

if (process.argv[2] === '--fechar') {
  const { data: abertos } = await admin.from('pedidos').select('id, numero').eq('restaurante_id', loja.id).ilike('cliente_nome', 'Teste iFood%').not('status', 'in', '("entregue","cancelado")')
  for (const p of abertos ?? []) await admin.from('pedidos').update({ status: 'cancelado', cancelado_motivo: 'teste', cancelado_observacao: 'Pedido fake do iFood (Bloco E)', cancelado_por: 'Loja: Teste', cancelado_em: new Date().toISOString(), reimprimir: false }).eq('id', p.id).eq('restaurante_id', loja.id)
  console.log('fechados:', (abertos ?? []).map((p) => '#' + p.numero).join(' ') || 'nenhum')
  process.exit(0)
}

const ITENS = [
  { nome: 'Hamburguer Supremo', preco_unitario: 32, quantidade: 1, observacao: 'sem cebola', complementos: [{ nome: 'Bacon extra', preco: 4 }] },
  { nome: 'coca lata', preco_unitario: 6, quantidade: 2, observacao: '', complementos: [] },
]
const base = {
  restaurante_id: loja.id, origem: 'cardapio', canal: 'delivery', origem_canal: 'ifood', origem_detalhe: { meio: 'app', app: 'ifood', teste: true },
  cliente_telefone: '27999990001', telefone_verificado: true, impresso: true, reimprimir: false,
  endereco_rua: 'Rua Teste Kanban', endereco_numero: '10', endereco_complemento: 'TESTE - não entregar', endereco_bairro: 'Jaburuna', endereco_cep: '29102000', endereco_cidade: 'Vila Velha',
}
const subtotal = ITENS.reduce((s, i) => s + (i.preco_unitario + i.complementos.reduce((a, c) => a + c.preco, 0)) * i.quantidade, 0)
const pedidos = [
  { ...base, tipo: 'entrega', status: 'recebido', cliente_nome: 'Teste iFood Ana', forma_pagamento: 'cartao', cartao_tipo: 'credito', pago: true, pagamento_online: false, subtotal, taxa_entrega: 5.89, total: subtotal + 5.89, observacao: 'Pedido do app — pago no iFood' },
  { ...base, tipo: 'retirada', status: 'preparando', preparando_em: new Date().toISOString(), cliente_nome: 'Teste iFood Bruno', forma_pagamento: 'dinheiro', troco_para: 100, pago: false, subtotal, taxa_entrega: 0, total: subtotal, endereco_rua: '', endereco_numero: '', endereco_complemento: '', endereco_bairro: '', endereco_cep: '', endereco_cidade: '' },
  // Cancelado pelo cliente (robô do WhatsApp): mostra "Cancelado pelo cliente (robô) · Cliente desistiu · …" na coluna Cancelados.
  { ...base, origem_canal: 'whatsapp', origem_detalhe: { meio: 'robo', teste: true }, tipo: 'entrega', status: 'cancelado', cliente_nome: 'Teste iFood Carla (cancelado)', forma_pagamento: 'pix', pago: false, subtotal, taxa_entrega: 5.89, total: subtotal + 5.89,
    cancelado_motivo: 'cliente_desistiu', cancelado_observacao: 'quero cancelar, pedi errado', cancelado_por: 'Cliente (WhatsApp robô)', cancelado_em: new Date().toISOString() },
]
for (const ped of pedidos) {
  const { data, error } = await admin.from('pedidos').insert(ped).select('id, numero').single()
  if (error) { console.log('ERRO', ped.cliente_nome, error.message); continue }
  const { error: ei } = await admin.from('pedido_itens').insert(ITENS.map((i) => ({ ...i, pedido_id: data.id })))
  console.log(`#${data.numero} ${ped.cliente_nome} (${ped.status})`, ei ? 'ERRO itens ' + ei.message : 'ok')
}
