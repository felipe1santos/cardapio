// ─────────────────────────────────────────────────────────────────────────────
// RECIBO/EXTRATO (a "pré-conta"; conferência de consumo) e TESTE DE IMPRESSORA.
//
// Formatador próprio: o recibo da cozinha (recibo.js) não é tocado. Usa os mesmos
// marcadores de linha que o print.ps1 já desenha (ver recibo.js):
//   N nome da loja · H divisória · C centralizado · I item + preço · S sub-linha
//   P rótulo + valor · T TOTAL grande · L linha · R pontilhado · F rodapé
//
// Tudo o que sai aqui veio do SNAPSHOT montado no servidor (impressao_snapshot_pre_conta):
// o agente não calcula valor nenhum. O snapshot da conta real não traz telefone,
// endereço, frete, rota, credenciais nem o motivo interno do desconto.
//
// Recibo/Extrato de TESTE (snapshot com recibo_teste, lib/impressao/recibo-teste.ts): o
// MESMO renderizador, com blocos que SÓ o teste imprime (telefone, endereço, observação,
// taxa de entrega, status) para mostrar no papel o que costuma cortar, e
// marcado "TESTE DE IMPRESSÃO — SEM VALOR FISCAL" com as réguas de borda (marcador K).
// A conta real não tem esses campos: para ela, nada muda.
// ─────────────────────────────────────────────────────────────────────────────

const SOH = '\x01'
const STX = '\x02'

function brl(v) {
  const n = Number(v) || 0
  const s = Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '-' : ''}R$ ${s}`
}

function dataHora(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d
    .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .replace(',', '')
}

const ROTULO_FORMA = { dinheiro: 'Dinheiro', pix: 'Pix', credito: 'Crédito', debito: 'Débito', vale: 'Vale-refeição', fiado: 'Fiado' }

function linhasBase() {
  const L = []
  return {
    L,
    N: (t) => L.push(`${SOH}N${STX}${t}`),
    H: (t) => L.push(`${SOH}H${STX}${t}`),
    C: (t) => L.push(`${SOH}C${STX}${t}`),
    I: (a, b) => L.push(`${SOH}I${STX}${a}${STX}${b}`),
    S: (t) => L.push(`${SOH}S${STX}${t}`),
    P: (a, b) => L.push(`${SOH}P${STX}${a}${STX}${b}`),
    T: (a, b) => L.push(`${SOH}T${STX}${a}${STX}${b}`),
    Lin: (t) => L.push(`${SOH}L${STX}${t}`),
    R: () => L.push(`${SOH}R`),
    F: (t) => L.push(`${SOH}F${STX}${t}`),
    K: () => L.push(`${SOH}K`),
  }
}

/** Linhas marcadas da pré-conta a partir do snapshot do servidor. */
function montarPreContaLinhas(s) {
  const { L, N, H, C, I, S, P, T, Lin, R, F, K } = linhasBase()
  const teste = s.recibo_teste === true
  if (teste) K()
  if (s.loja) N(String(s.loja).toUpperCase())
  H('RECIBO/EXTRATO')
  // Duas linhas curtas: linha centralizada (C) não quebra no print.ps1 e cortaria no 58 mm.
  if (teste) {
    C('TESTE DE IMPRESSÃO')
    C('SEM VALOR FISCAL')
  }
  C('CONFERÊNCIA DE CONSUMO')
  C('NÃO É DOCUMENTO FISCAL')

  if (teste) {
    C('PEDIDO DE DEMONSTRAÇÃO')
    if (s.cliente_nome) Lin(`Cliente: ${s.cliente_nome}`)
  } else if (s.tipo === 'balcao') {
    C(`BALCÃO · SENHA ${s.senha ?? '—'}`)
    if (s.cliente_nome) Lin(`Cliente: ${s.cliente_nome}`)
  } else {
    C(`${String(s.mesa ?? 'MESA').toUpperCase()}${s.comanda_numero ? ` · COMANDA ${s.comanda_numero}` : ''}`)
  }
  Lin(`Abertura: ${dataHora(s.aberta_em)}`)
  Lin(`Impressão: ${dataHora(s.impresso_em)}`)
  if (s.operador) Lin(`Operador: ${s.operador}`)
  Lin(Number(s.via) > 1 ? `${s.via}ª VIA (reimpressão)` : '1ª via')
  // Só no Recibo/Extrato de TESTE: a conta real nunca imprime telefone, endereço nem frete,
  // mesmo que o campo apareça no snapshot.
  if (teste && s.cliente_telefone) Lin(`Telefone: ${s.cliente_telefone}`)
  if (teste && s.endereco && typeof s.endereco === 'object') {
    const e = s.endereco
    Lin(`Endereço: ${[e.rua, e.numero].filter(Boolean).join(', ')}`)
    if (e.complemento) Lin(`Compl.: ${e.complemento}`)
    const local = [e.bairro, [e.cidade, e.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ')
    if (local) Lin(local)
  }
  if (teste && s.observacao) Lin(`Obs.: ${s.observacao}`)

  const itens = Array.isArray(s.itens) ? s.itens : []
  const unidades = itens.reduce((t, i) => t + (Number(i.quantidade) || 0), 0)
  H(`CONSUMO (${unidades})`)
  if (itens.length === 0) Lin('Nenhum item cobrado.')
  itens.forEach((it, idx) => {
    const variacao = [it.tamanho, it.sabor].filter(Boolean).join(' - ')
    I(`${it.quantidade}x ${it.nome}${variacao ? ` (${variacao})` : ''}`, brl(it.subtotal))
    if (Number(it.quantidade) > 1) S(`${it.quantidade} x ${brl(it.preco_unitario)}`)
    if (it.borda) S(`+ Borda: ${it.borda}`)
    if (it.massa) S(`+ Massa: ${it.massa}`)
    const comps = Array.isArray(it.complementos) ? it.complementos : []
    const agrupados = new Map()
    for (const c of comps) {
      const cur = agrupados.get(c.nome) ?? { nome: c.nome, preco: Number(c.preco) || 0, qtd: 0 }
      cur.qtd += 1
      agrupados.set(c.nome, cur)
    }
    for (const c of agrupados.values()) {
      const preco = c.preco * c.qtd
      S(`+ ${c.qtd > 1 ? `${c.qtd}x ` : ''}${c.nome}${preco > 0 ? ` (${brl(preco)})` : ''}`)
    }
    if (it.observacao) S(`Obs: ${it.observacao}`)
    if (idx < itens.length - 1) R()
  })

  H('TOTAIS')
  P('Subtotal', brl(s.subtotal))
  if (Number(s.taxa) > 0 || Number(s.taxa_percentual) > 0) {
    P(`Taxa de serviço (${String(Number(s.taxa_percentual)).replace('.', ',')}%)`, brl(s.taxa))
  }
  if (Number(s.desconto) > 0) P('Desconto', brl(-Number(s.desconto)))
  if (teste && Number(s.taxa_entrega) > 0) P('Taxa de entrega', brl(s.taxa_entrega))
  T('TOTAL', brl(s.total))
  const pagamentos = Array.isArray(s.pagamentos) ? s.pagamentos : []
  if (Number(s.pago) > 0 || pagamentos.length > 0) {
    P('Já pago', brl(s.pago))
    for (const p of pagamentos) S(`${ROTULO_FORMA[p.forma] ?? p.forma}: ${brl(p.valor)}`)
  }
  P('RESTANTE A PAGAR', brl(s.restante))
  if (teste && s.status_pagamento) Lin(`Status: ${s.status_pagamento}`)

  const cancelados = Array.isArray(s.cancelados) ? s.cancelados : []
  if (cancelados.length > 0) {
    H('CANCELADOS — NÃO COBRADOS')
    for (const c of cancelados) S(`${c.quantidade}x ${c.nome}`)
  }

  F('Confira os itens da sua conta.')
  F('feito por Menuzia.com.br')
  if (teste) {
    F('TESTE DE IMPRESSÃO — SEM VALOR FISCAL')
    K()
  }
  return L
}

/** Página de teste: prova largura, alinhamento, acentos e destino. */
function montarTesteLinhas(s) {
  const { L, N, H, C, I, P, T, Lin, R, F } = linhasBase()
  if (s.loja) N(String(s.loja).toUpperCase())
  H('TESTE DE IMPRESSORA')
  C(String(s.impressora ?? ''))
  Lin(`Windows: ${s.nome_sistema ?? '—'}`)
  Lin(`Computador: ${s.computador ?? '—'}`)
  Lin(`Papel: ${s.largura_mm ?? '—'} mm`)
  Lin(`Pedido por: ${s.operador ?? '—'}`)
  Lin(`Quando: ${dataHora(s.impresso_em)}`)
  R()
  Lin('Acentos: ÁÉÍÓÚ ÂÊÔ ÃÕ Ç à ü')
  I('Nome de item bem comprido para ver a quebra de linha', 'R$ 1.234,56')
  P('Alinhamento de valor', 'R$ 9,90')
  T('TOTAL', 'R$ 1.244,46')
  F('Se você está lendo isto, a impressora está ok.')
  return L
}

function montarPreConta(s) {
  return montarPreContaLinhas(s).join('\n')
}
function montarTeste(s) {
  return montarTesteLinhas(s).join('\n')
}

/** Colunas por largura do papel (base 48 em 80 mm, 32 em 58 mm), como o recibo da cozinha. */
function colsPreConta(larguraMm) {
  return Number(larguraMm) <= 58 ? 32 : 48
}

module.exports = { montarPreConta, montarPreContaLinhas, montarTeste, montarTesteLinhas, colsPreConta, brl }
