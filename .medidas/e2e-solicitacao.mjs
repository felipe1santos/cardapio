// E2E das solicitações do cliente (Fase 2, 18/10) no LOCAL, sessão do dono no Playwright, pedidos de teste da MENUZIA.
//  1. pedido em Recebido + "cancelar" pelo robô (abrirSolicitacao) → cancelamento automático
//  2. pedido em Preparando + alteração (sem proposta) → pendente → card mostra faixa amarela → Recusar com motivo → cliente avisado
//  3. pedido em Preparando + alteração com proposta (IA: +1 item) → Aplicar → pedido editado, solicitação aplicada
//  4. pedido em rota → "não dá mais"
//  5. escalada de 5 min (cron) → conversa pede atendente + aviso
//   node .medidas/e2e-solicitacao.mjs <perfil> [base]
import { readFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const [PERFIL, BASE = 'http://localhost:3000'] = process.argv.slice(2)
const TEL = '27992534407', ITEM = '58030688-26b9-48b5-9fe4-9b9e26592670'
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = 0, n = 0
const v = (r, c, extra = '') => { n++; if (c) ok++; console.log(c ? 'ok  ' : 'ERRO', r, extra ? '— ' + extra : '') }
const { data: loja } = await admin.from('restaurantes').select('id, status_loja').eq('slug', 'menuzia').single()
const statusOriginal = loja.status_loja
await admin.from('restaurantes').update({ status_loja: 'aberto_manual' }).eq('id', loja.id)
const { data: outro } = await admin.from('itens_cardapio').select('id, nome').eq('restaurante_id', loja.id).eq('status', 'disponivel').eq('tipo_item', 'simples').neq('id', ITEM).limit(1).maybeSingle()
const criar = async (rotulo) => {
  const r = await fetch(`${BASE}/api/loja/menuzia/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'entrega', cliente: { nome: `Teste Solicitação ${rotulo}`, telefone: TEL }, endereco: { rua: 'Rua Teste Kanban', numero: '10', complemento: 'TESTE - não entregar', bairro: 'Jaburuna', cep: '29102000', cidade: 'Vila Velha', referencia: '' },
    pagamento: 'dinheiro', trocoPara: null, itens: [{ itemId: ITEM, quantidade: 1, observacao: '', complementos: [] }], chavePedido: `so-${randomUUID()}` }) })
  const j = await r.json(); const id = j.pedidoId ?? j.id ?? j.pedido?.id; if (!id) console.log('criar falhou', r.status, JSON.stringify(j).slice(0, 200)); return id
}
const ids = []
const ctx = await chromium.launchPersistentContext(PERFIL, { headless: true, viewport: { width: 1366, height: 768 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
const p = ctx.pages()[0] ?? await ctx.newPage()
const api = (metodo, caminho, corpo) => p.evaluate(async ([m, c, b]) => { const r = await fetch(c, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json() } catch { /* */ } return { s: r.status, j } }, [metodo, caminho, corpo])
try {
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('[data-testid="kanban-quadro"]', { timeout: 120_000 }); await espera(1500)

  // 2) pendente sem proposta → faixa → recusar
  const B = await criar('B'); ids.push(B)
  await admin.from('pedidos').update({ status: 'preparando', preparando_notificado: true, telefone_verificado: true }).eq('id', B)
  const { data: solB } = await admin.from('pedido_solicitacoes').insert({ restaurante_id: loja.id, pedido_id: B, origem: 'robo', tipo: 'alterar', texto: 'tirar a cebola do lanche' }).select('id').single()
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('[data-testid="kanban-quadro"]', { timeout: 60_000 }); await espera(2500)
  const { data: pb } = await admin.from('pedidos').select('numero').eq('id', B).single()
  const cardB = p.locator(`[data-testid="pedido-${pb.numero}"]`)
  v('card mostra a faixa "Cliente pediu alteração"', (await cardB.locator('[data-testid="solicitacao-alterar"]').count()) === 1)
  mkdirSync('.shots/redesign-kanban/solicitacao', { recursive: true })
  await p.screenshot({ path: '.shots/redesign-kanban/solicitacao/01-faixa.png' })
  const desde = new Date().toISOString()
  await cardB.locator('[data-testid="solicitacao-recusar"]').click(); await cardB.locator('[data-testid="solicitacao-motivo"]').fill('a cozinha já montou'); await cardB.locator('[data-testid="solicitacao-recusar-confirmar"]').click()
  let sB = null
  for (let i = 0; i < 40 && sB?.status !== 'recusada'; i++) { await espera(500); sB = (await admin.from('pedido_solicitacoes').select('status, motivo_recusa, decidido_por_nome').eq('id', solB.id).single()).data }
  v('recusada com motivo e quem decidiu', sB.status === 'recusada' && sB.motivo_recusa === 'a cozinha já montou' && !!sB.decidido_por_nome, JSON.stringify(sB))
  const { data: envio } = await admin.from('whatsapp_envios').select('texto').eq('restaurante_id', loja.id).like('chave', `solicitacao_recusada:${solB.id}`).limit(1)
  v('cliente avisado da recusa (fila do WhatsApp)', (envio ?? []).length === 1 && /não pôde alterar/.test(envio[0].texto), envio?.[0]?.texto)

  // 3) pendente com proposta (+1 item) → aplicar
  const C = await criar('C'); ids.push(C)
  await admin.from('pedidos').update({ status: 'preparando', preparando_notificado: true, telefone_verificado: true }).eq('id', C)
  const { data: solC } = await admin.from('pedido_solicitacoes').insert({ restaurante_id: loja.id, pedido_id: C, origem: 'ia', tipo: 'alterar', texto: `mais 1 ${outro.nome}`, proposta: { itens: { adicionar: [{ itemId: outro.id, quantidade: 1, observacao: '', complementos: [] }] } } }).select('id').single()
  const ap = await api('POST', `/api/admin/pedidos/${C}/solicitacao`, { acao: 'aplicar', solicitacaoId: solC.id })
  const { data: pc } = await admin.from('pedidos').select('numero, total, observacao, pedido_itens ( nome, cancelado_em )').eq('id', C).single()
  v(`aplicar com proposta (${ap.s}): item adicionado e observação ALTERADO`, ap.s === 200 && pc.pedido_itens.filter((i) => !i.cancelado_em).length === 2 && /PEDIDO ALTERADO/.test(pc.observacao), JSON.stringify(ap.j))
  const { data: sC } = await admin.from('pedido_solicitacoes').select('status').eq('id', solC.id).single()
  v('solicitação marcada como aplicada', sC.status === 'aplicada')

  // 4) em rota → aplicar recusa (despachado)
  const D = await criar('D'); ids.push(D)
  await admin.from('pedidos').update({ status: 'em_rota', preparando_notificado: true }).eq('id', D)
  const { data: solD } = await admin.from('pedido_solicitacoes').insert({ restaurante_id: loja.id, pedido_id: D, origem: 'robo', tipo: 'alterar', texto: 'x', proposta: { itens: { adicionar: [{ itemId: outro.id, quantidade: 1, observacao: '', complementos: [] }] } } }).select('id').single()
  const apD = await api('POST', `/api/admin/pedidos/${D}/solicitacao`, { acao: 'aplicar', solicitacaoId: solD.id })
  v(`aplicar em pedido já em rota → 409 (${apD.s})`, apD.s === 409, apD.j?.error)

  // 5) escalada de 5 min pelo cron
  const E = await criar('E'); ids.push(E)
  await admin.from('pedidos').update({ status: 'preparando', preparando_notificado: true }).eq('id', E)
  const { data: solE } = await admin.from('pedido_solicitacoes').insert({ restaurante_id: loja.id, pedido_id: E, origem: 'robo', tipo: 'alterar', texto: 'sem gelo', criado_em: new Date(Date.now() - 6 * 60_000).toISOString() }).select('id').single()
  const cron = await fetch(`${BASE}/api/cron/whatsapp`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' } }); await espera(1500)
  const { data: sE } = await admin.from('pedido_solicitacoes').select('escalada_em, status').eq('id', solE.id).single()
  const { data: envE } = await admin.from('whatsapp_envios').select('texto').eq('restaurante_id', loja.id).like('chave', `solicitacao_escalada:${solE.id}`).limit(1)
  v(`cron (${cron.status}): solicitação de 6 min escalada (segue pendente) e cliente avisado`, cron.ok && !!sE.escalada_em && sE.status === 'pendente' && (envE ?? []).length === 1, envE?.[0]?.texto ?? '')
  // Limpa os envios de teste da fila (não mandar WhatsApp de teste de verdade).
  await admin.from('whatsapp_envios').delete().eq('restaurante_id', loja.id).or(`chave.like.solicitacao_recusada:%,chave.like.solicitacao_escalada:%`).gte('criado_em', desde)
  console.log('prints em .shots/redesign-kanban/solicitacao/')
} finally {
  await admin.from('restaurantes').update({ status_loja: statusOriginal }).eq('id', loja.id)
  await admin.from('pedido_solicitacoes').update({ status: 'cancelada' }).in('pedido_id', ids).eq('status', 'pendente')
  for (const id of ids) await admin.from('pedidos').update({ status: 'cancelado', cancelado_motivo: 'nao_entregue', cancelado_observacao: 'Pedido de teste (solicitação)', cancelado_por: 'Teste', cancelado_em: new Date().toISOString() }).eq('id', id)
  await ctx.close()
  console.log(`${ok} de ${n}`)
}
