// Pedidos de teste na MENUZIA para os prints do redesign do Kanban (18/10): um em cada coluna
// (recebido, preparando, pronto p/ entrega, em rota) + um retirada pronto. Telefone do dono. Criados pela API
// local (mesmo caminho da vitrine) e movidos de status direto no banco (sem avisos extras).
//   node .medidas/redesign-kanban-pedidos-teste.mjs criar [base]   → imprime os ids
//   node .medidas/redesign-kanban-pedidos-teste.mjs limpar         → fecha todos os "Teste Kanban" como Não entregue
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const TEL = '27992534407', ITEM = '58030688-26b9-48b5-9fe4-9b9e26592670'
const [acao = 'criar', BASE = 'http://localhost:3000'] = process.argv.slice(2)
const { data: loja } = await admin.from('restaurantes').select('id').eq('slug', 'menuzia').single()

if (acao === 'limpar') {
  const { data } = await admin.from('pedidos').select('id, numero, status').eq('restaurante_id', loja.id).like('cliente_nome', 'Teste Kanban%').not('status', 'in', '(entregue,cancelado)')
  for (const p of data ?? []) {
    await admin.from('pedidos').update({ status: 'cancelado', cancelado_motivo: 'nao_entregue', cancelado_observacao: 'Pedido de teste (redesign do Kanban)', cancelado_por: 'Teste', cancelado_em: new Date().toISOString() }).eq('id', p.id)
    console.log('fechado', p.numero)
  }
  process.exit(0)
}

const CASOS = [
  { rotulo: 'Recebido', status: 'recebido', tipo: 'entrega', pagamento: 'pix', itens: 2 },
  { rotulo: 'Preparando', status: 'preparando', tipo: 'entrega', pagamento: 'dinheiro', trocoPara: 100, itens: 3 },
  { rotulo: 'Pronto', status: 'pronto', tipo: 'entrega', pagamento: 'cartao', itens: 1 },
  { rotulo: 'Retirada', status: 'pronto', tipo: 'retirada', pagamento: 'pix', itens: 4 },
  { rotulo: 'Em rota', status: 'em_rota', tipo: 'entrega', pagamento: 'dinheiro', itens: 2 },
]
for (const c of CASOS) {
  const corpo = {
    tipo: c.tipo, cliente: { nome: `Teste Kanban ${c.rotulo}`, telefone: TEL },
    ...(c.tipo === 'entrega' ? { endereco: { rua: 'Rua Teste Kanban', numero: '10', complemento: 'TESTE - não entregar', bairro: 'Jaburuna', cep: '29102000', cidade: 'Vila Velha', referencia: 'Ao lado da padaria' } } : {}),
    pagamento: c.pagamento, ...(c.trocoPara ? { trocoPara: c.trocoPara } : {}),
    itens: Array.from({ length: c.itens }, (_, i) => ({ itemId: ITEM, quantidade: i + 1, observacao: i === 0 ? 'TESTE kanban — sem cebola' : '', complementos: [] })),
    chavePedido: `rk-${randomUUID()}`,
  }
  const r = await fetch(`${BASE}/api/loja/menuzia/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const j = await r.json().catch(() => ({}))
  const id = j.pedidoId ?? j.id ?? j.pedido?.id
  if (!r.ok || !id) { console.error('falhou', c.rotulo, r.status, JSON.stringify(j).slice(0, 200)); continue }
  const patch = { status: c.status, telefone_verificado: true, preparando_notificado: c.status !== 'recebido' }
  await admin.from('pedidos').update(patch).eq('id', id)
  console.log('criado', c.rotulo, id)
}
