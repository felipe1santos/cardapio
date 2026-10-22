// Pedidos de DEMONSTRAÇÃO dos apps (iFood, 99Food, Keeta) — SÓ Menuzia. Mesmo formato do importador (lib/canais/importar.ts),
// sem linha em pedidos_externos (nada é devolvido aos apps). Marcados com origem_detalhe.teste=true e impresso=true.
//   node .medidas/pedidos-fake-apps.mjs            → cria
//   node .medidas/pedidos-fake-apps.mjs limpar     → fecha todos como "Cancelado · teste"
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2] }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: loja } = await admin.from('restaurantes').select('id, slug').eq('slug', 'menuzia').single()
if (loja.slug !== 'menuzia') throw new Error('loja errada')

if (process.argv[2] === 'limpar') {
  const { data } = await admin.from('pedidos').update({ status: 'cancelado', cancelado_motivo: 'teste', cancelado_observacao: 'Demonstração dos apps', cancelado_por: 'Loja: Teste', cancelado_em: new Date().toISOString(), reimprimir: false })
    .eq('restaurante_id', loja.id).eq('origem_detalhe->>demo_apps', 'true').neq('status', 'cancelado').neq('status', 'entregue').select('numero')
  console.log('fechados:', (data ?? []).map((p) => p.numero).join(', ') || 'nenhum')
  process.exit(0)
}

const agora = Date.now()
const PEDIDOS = [
  { app: 'ifood', nome: 'Mariana Souza (DEMO)', status: 'recebido', forma: 'cartao', pago: true, desc: 'Pago no app (cartão)', entregaPor: 'loja', total: 62.8, taxa: 6.9,
    end: { rua: 'Rua Henrique Moscoso', numero: '1000', complemento: 'TESTE - não entregar', bairro: 'Praia da Costa', cep: '29101345', cidade: 'Vila Velha', lat: -20.3355, lng: -40.2873 },
    itens: [['Mega Burguer', 27.9, 2], ['Batata média', 0, 0]] },
  { app: '99food', nome: 'Carlos Lima (DEMO)', status: 'pronto', forma: 'dinheiro', pago: false, troco: 100, desc: 'Dinheiro na entrega', entregaPor: 'loja', total: 54.0, taxa: 7.0,
    end: { rua: 'Avenida Hugo Musso', numero: '1200', complemento: 'TESTE - não entregar', bairro: 'Itapuã', cep: '29101280', cidade: 'Vila Velha', lat: -20.3530, lng: -40.2930 },
    itens: [['Costela Burguer', 23.5, 2]] },
  { app: 'keeta', nome: 'Fernanda Alves (DEMO)', status: 'pronto', forma: 'pix', pago: true, desc: 'Pago no app (Pix)', entregaPor: 'loja', total: 41.9, taxa: 5.0,
    end: { rua: 'Rua São Paulo', numero: '500', complemento: 'TESTE - não entregar', bairro: 'Praia da Costa', cep: '29101300', cidade: 'Vila Velha', lat: -20.3330, lng: -40.2840 },
    itens: [['Mega Burguer', 27.9, 1], ['Refrigerante lata', 9.0, 1]] },
  { app: 'ifood', nome: 'Rafael Costa (DEMO)', status: 'pronto', forma: 'cartao', pago: false, desc: 'Cartão na entrega (maquininha)', entregaPor: 'loja', total: 38.5, taxa: 6.0,
    end: { rua: 'Rua Itapemirim', numero: '300', complemento: 'TESTE - não entregar', bairro: 'Itaparica', cep: '29102200', cidade: 'Vila Velha', lat: -20.3690, lng: -40.3080 },
    itens: [['Mega Burguer', 27.9, 1], ['Molho especial', 4.6, 1]] },
]
const NOME = { ifood: 'iFood', '99food': '99Food', keeta: 'Keeta' }
// `node pedidos-fake-apps.mjs keeta` → só os pedidos daquele app.
for (const [i, p] of PEDIDOS.entries()) {
  if (process.argv[2] && p.app !== process.argv[2]) continue
  const display = String(4000 + Math.floor(Math.random() * 5000))
  const itens = p.itens.filter(([, , q]) => q > 0)
  const subtotal = Math.round((p.total - p.taxa) * 100) / 100
  const { data: ped, error } = await admin.from('pedidos').insert({
    restaurante_id: loja.id, origem: 'cardapio', canal: 'delivery', origem_canal: p.app,
    origem_detalhe: { meio: 'app', app: p.app, externoId: `demo-${agora}-${i}`, displayId: display, entregaPor: p.entregaPor, pagamento: p.desc, teste: true, demo_apps: true },
    tipo: 'entrega', status: p.status, ...(p.status === 'pronto' ? { pronto_em: new Date().toISOString() } : {}),
    cliente_nome: p.nome, cliente_telefone: '27999990002', telefone_verificado: true,
    forma_pagamento: p.forma, troco_para: p.troco ?? null, pago: p.pago, pagamento_online: false,
    subtotal, taxa_entrega: p.taxa, desconto: 0, total: p.total, impresso: true, reimprimir: false,
    observacao: `Pedido ${NOME[p.app]} #${display} · DEMONSTRAÇÃO`,
    endereco_rua: p.end.rua, endereco_numero: p.end.numero, endereco_complemento: p.end.complemento, endereco_bairro: p.end.bairro,
    endereco_cep: p.end.cep, endereco_cidade: p.end.cidade, endereco_referencia: '', entrega_latitude: p.end.lat, entrega_longitude: p.end.lng,
  }).select('id, numero').single()
  if (error) { console.error(p.app, error.message); continue }
  await admin.from('pedido_itens').insert(itens.map(([nome, preco, q]) => ({ pedido_id: ped.id, nome, preco_unitario: preco, quantidade: q, observacao: '', complementos: [] })))
  console.log(`#${ped.numero} ${NOME[p.app]} · ${p.status} · ${p.desc} · R$ ${p.total.toFixed(2)}`)
}
