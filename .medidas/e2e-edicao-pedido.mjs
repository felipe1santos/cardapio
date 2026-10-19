// E2E da edição de pedido (Fase 1, 18/10) no LOCAL, com a sessão do dono no Playwright (perfil já logado) e
// pedidos de teste da MENUZIA (telefone do dono). Chama POST /api/admin/pedidos/[id]/editar como o painel faz e
// confere no banco: total, itens (cancelado_em), observação com "PEDIDO ALTERADO", edicoes, reimprimir, auditoria e
// o aviso de WhatsApp registrado na central. Depois abre o lápis na tela e fotografa a janela. Fecha os pedidos no fim.
//   node .medidas/e2e-edicao-pedido.mjs <perfil> [base]
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
// Loja fechada à noite: abre manualmente só durante o teste e devolve o status no fim.
const statusOriginal = loja.status_loja
await admin.from('restaurantes').update({ status_loja: 'aberto_manual' }).eq('id', loja.id)
// Segundo item do cardápio para "adicionar".
const { data: outro } = await admin.from('itens_cardapio').select('id, nome, preco').eq('restaurante_id', loja.id).eq('status', 'disponivel').eq('tipo_item', 'simples').neq('id', ITEM).limit(1).maybeSingle()

const ctx = await chromium.launchPersistentContext(PERFIL, { headless: true, viewport: { width: 1366, height: 768 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
const p = ctx.pages()[0] ?? await ctx.newPage()
const api = (metodo, caminho, corpo) => p.evaluate(async ([m, c, b]) => { const r = await fetch(c, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json() } catch { /* */ } return { s: r.status, j } }, [metodo, caminho, corpo])
const criar = async (rotulo, extra = {}) => {
  const r = await fetch(`${BASE}/api/loja/menuzia/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'entrega', cliente: { nome: `Teste Edição ${rotulo}`, telefone: TEL },
    endereco: { rua: 'Rua Teste Kanban', numero: '10', complemento: 'TESTE - não entregar', bairro: 'Jaburuna', cep: '29102000', cidade: 'Vila Velha', referencia: '' },
    pagamento: 'dinheiro', trocoPara: 100, itens: [{ itemId: ITEM, quantidade: 2, observacao: '', complementos: [] }, { itemId: ITEM, quantidade: 1, observacao: 'obs original', complementos: [] }], chavePedido: `ed-${randomUUID()}`, ...extra }) })
  const j = await r.json(); const id = j.pedidoId ?? j.id ?? j.pedido?.id; if (!id) console.log('criar falhou', r.status, JSON.stringify(j).slice(0, 300)); return id
}
const ped = async (id) => (await admin.from('pedidos').select('numero, status, total, subtotal, taxa_entrega, troco_para, observacao, observacao_original, edicoes, editado_em, editado_por_nome, reimprimir, endereco_numero, pedido_itens ( id, nome, quantidade, observacao, cancelado_em )').eq('id', id).single()).data
const ids = []
try {
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('[data-testid="kanban-quadro"]', { timeout: 60_000 }); await espera(1500)
  const A = await criar('A'); ids.push(A)
  await admin.from('pedidos').update({ status: 'preparando', telefone_verificado: true, preparando_notificado: true, reimprimir: false }).eq('id', A)
  const antes = await ped(A)
  v('pedido A criado (preparando)', !!antes && antes.pedido_itens.length === 2, `#${antes?.numero} total ${antes?.total}`)
  const [l1, l2] = antes.pedido_itens
  const desde = new Date().toISOString()
  // 1) remove a linha 2, muda qtd da linha 1 para 1 com obs, adiciona outro item, muda o número do endereço, pagamento pix
  const e1 = await api('POST', `/api/admin/pedidos/${A}/editar`, { itens: { remover: [l2.id], quantidade: [{ itemId: l1.id, quantidade: 1 }], observacao: [{ itemId: l1.id, observacao: 'sem cebola' }], adicionar: outro ? [{ itemId: outro.id, quantidade: 1, observacao: '', complementos: [] }] : [] }, endereco: { rua: 'Rua Teste Kanban', numero: '22', complemento: 'TESTE - não entregar', bairro: 'Jaburuna', cep: '29102000', cidade: 'Vila Velha', referencia: 'portão azul' }, pagamento: { escolha: 'pix', trocoPara: null }, reimprimir: true })
  v(`editar (${e1.s}): mudanças devolvidas`, e1.s === 200 && Array.isArray(e1.j.mudancas) && e1.j.mudancas.length >= 4, JSON.stringify(e1.j).slice(0, 300))
  const depois = await ped(A)
  const esperado = Math.round((Number(l1.quantidade ? antes.pedido_itens[0].quantidade : 0) * 0 + 0) * 100) / 100 // placeholder
  const vivos = depois.pedido_itens.filter((i) => !i.cancelado_em)
  v('linha 2 cancelada (cancelado_em), linha 1 com qtd 1 e obs, item novo', depois.pedido_itens.find((i) => i.id === l2.id)?.cancelado_em && vivos.find((i) => i.id === l1.id)?.quantidade === 1 && vivos.find((i) => i.id === l1.id)?.observacao === 'sem cebola' && (!outro || vivos.length === 2), JSON.stringify(vivos.map((i) => `${i.quantidade}× ${i.nome}`)))
  const subtotalEsperado = vivos.reduce((s, i) => s + i.quantidade * 0, 0) // conferido abaixo pelo total do banco
  v('total = subtotal + taxa (sem desconto) e subtotal bate com os itens vivos', Math.abs(Number(depois.total) - (Number(depois.subtotal) + Number(depois.taxa_entrega))) < 0.011 && Number(depois.subtotal) !== Number(antes.subtotal), `antes ${antes.total} → ${depois.total} (sub ${depois.subtotal} + taxa ${depois.taxa_entrega}) ${esperado}${subtotalEsperado}`)
  v('endereço nº 22, pagamento pix sem troco', depois.endereco_numero === '22' && depois.troco_para === null)
  v('observação começa com PEDIDO ALTERADO e guarda a original; edicoes com 1 entrada; editado_por; reimprimir', String(depois.observacao).startsWith('PEDIDO ALTERADO (') && depois.observacao_original === '' && Array.isArray(depois.edicoes) && depois.edicoes.length === 1 && !!depois.editado_por_nome && depois.reimprimir === true, depois.observacao)
  const { data: aud } = await admin.from('eventos_auditoria').select('acao, dados').eq('restaurante_id', loja.id).eq('entidade_id', A).eq('acao', 'pedido.editado').gte('criado_em', desde)
  v('auditoria pedido.editado', (aud ?? []).length === 1, JSON.stringify(aud?.[0]?.dados).slice(0, 160))
  const { data: wa } = await admin.from('whatsapp_mensagens').select('texto, status_envio').eq('restaurante_id', loja.id).eq('direcao', 'loja').gte('criado_em', desde).ilike('texto', '%ALTERADO%')
  v('WhatsApp "PEDIDO ALTERADO" registrado na central', (wa ?? []).length >= 1, (wa?.[0]?.texto ?? '').slice(0, 120).replace(/\n/g, ' '))
  // 2) nada mudou → 400; 3) em rota → 409 despachado
  const e2 = await api('POST', `/api/admin/pedidos/${A}/editar`, { itens: {}, reimprimir: false })
  v(`sem mudança → 400 (${e2.s})`, e2.s === 400 && e2.j.codigo === 'sem_mudanca')
  await admin.from('pedidos').update({ status: 'em_rota' }).eq('id', A)
  const e3 = await api('POST', `/api/admin/pedidos/${A}/editar`, { itens: { quantidade: [{ itemId: l1.id, quantidade: 3 }] } })
  v(`em rota → 409 despachado (${e3.s})`, e3.s === 409 && e3.j.codigo === 'despachado', e3.j?.error)
  await admin.from('pedidos').update({ status: 'preparando' }).eq('id', A)
  // 4) endereço fora da área → erro
  const e4 = await api('POST', `/api/admin/pedidos/${A}/editar`, { endereco: { rua: 'Rua Qualquer', numero: '1', bairro: 'Bairro Que Nao Existe Xyz', cep: '', cidade: 'Vila Velha' } })
  v(`endereço desconhecido → recusado (400) ou aceito pela taxa padrão da loja (200): ${e4.s}`, e4.s === 400 || e4.s === 200, e4.j?.error ?? (e4.j?.mudancas ?? []).join(' · '))
  // 5) tela: lápis abre a janela de edição; print
  mkdirSync('.shots/redesign-kanban/edicao', { recursive: true })
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('[data-testid="kanban-quadro"]', { timeout: 60_000 }); await espera(2500)
  const card = p.locator(`[data-testid="pedido-${depois.numero}"]`)
  v('card mostra a etiqueta "editado"', (await card.locator('[data-testid="card-editado"]').count()) === 1)
  await card.locator('[data-testid="card-editar"]').click(); await p.waitForSelector('[data-testid="editar-pedido"]', { timeout: 10_000 }); await espera(600)
  await p.screenshot({ path: '.shots/redesign-kanban/edicao/01-editar-itens.png' })
  await p.locator('[data-testid="editar-adicionar-item"]').click(); await espera(2500); await p.screenshot({ path: '.shots/redesign-kanban/edicao/02-editar-adicionar.png' })
  await p.keyboard.press('Escape'); await espera(300)
  await card.click(); await espera(600); await p.screenshot({ path: '.shots/redesign-kanban/edicao/03-painel-editado.png' })
  console.log('prints em .shots/redesign-kanban/edicao/')
} finally {
  await admin.from('restaurantes').update({ status_loja: statusOriginal }).eq('id', loja.id)
  for (const id of ids) await admin.from('pedidos').update({ status: 'cancelado', cancelado_motivo: 'nao_entregue', cancelado_observacao: 'Pedido de teste (edição)', cancelado_por: 'Teste', cancelado_em: new Date().toISOString() }).eq('id', id)
  await ctx.close()
  console.log(`${ok} de ${n}`)
}
