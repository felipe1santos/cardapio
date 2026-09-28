// ─────────────────────────────────────────────────────────────────────────────
// PRÉ-CONTA (Recibo/Extrato) do ASSISTENTE BETA — modelo
// docs/referencias/impressao/v2/PRE-CONTA.png (2026-09-28): logo MENUZiA, "PRE-CONTA",
// mesa, pedido, data e hora, faixa ITENS CONSUMIDOS (QTD, DESCRICAO, TOTAL), faixa
// VALORES, TOTAL grande entre tracejados e, no rodapé, o texto da loja com o QR ao lado.
//
// Só o Beta usa este arquivo. O Recibo/Extrato do Assistente atual (pre-conta.js +
// print.ps1) e a ficha da cozinha antiga (recibo.js) não mudam.
//
// Monta BLOCOS (JSON); quem desenha é o ticket-canvas.js — o mesmo da pré-visualização do
// painel. Tudo vem do SNAPSHOT do servidor; o agente não calcula valor. Telefone,
// endereço, observação do pedido e frete só saem no documento de TESTE — a conta real
// nunca os imprime.
// ─────────────────────────────────────────────────────────────────────────────

const { brl } = require('./pre-conta')
const { linhasDoRodape } = require('./cozinha-beta')

const texto = (v) => (v === undefined || v === null ? '' : String(v).trim())
const maiusculo = (v) => texto(v).toLocaleUpperCase('pt-BR')

function dataHora(iso) {
  const d = iso ? new Date(iso) : null
  if (!d || isNaN(d.getTime())) return ''
  const dt = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })
  const h = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  return `${dt} ${h}`
}

/** Status do pagamento, lido dos números do snapshot. */
function statusPagamento(s) {
  const total = Number(s.total) || 0
  const pago = Number(s.pago) || 0
  const restante = Number(s.restante) || 0
  if (total > 0 && restante <= 0.004) return 'Pago'
  if (pago > 0) return 'Pagamento parcial'
  return 'A receber'
}

/**
 * Documento da pré-conta do Beta.
 * @param {object} s snapshot (conta real ou recibo_teste); s.qr opcional (servidor)
 * @returns {{ versao: 3, modelo: 'pre_conta', teste: boolean, loja: string, blocos: object[] }}
 */
function montarPreContaBeta(s) {
  const teste = s.recibo_teste === true
  const b = []

  if (teste) b.push({ t: 'marcas' })
  b.push({ t: 'logo' })
  b.push({ t: 'titulo', s: 'PRE-CONTA' })

  // Mesa / balcão, pedido, data e hora — centralizados, como o modelo.
  const linhas = []
  if (teste) linhas.push('Mesa 34')
  else if (s.tipo === 'balcao') linhas.push(s.senha !== undefined && s.senha !== null ? `Balcao - Senha ${s.senha}` : 'Balcao')
  // Mesa cadastrada como "Mesa 01" já traz a palavra; "01" ganha o prefixo.
  else if (texto(s.mesa)) linhas.push(/^mesa( |$)/i.test(texto(s.mesa)) ? texto(s.mesa) : `Mesa ${texto(s.mesa)}`)
  const numero = s.pedido_numero ?? s.comanda_numero
  if (numero !== undefined && numero !== null) linhas.push(`Pedido #${numero}`)
  if (texto(s.cliente_nome)) linhas.push(`Cliente: ${texto(s.cliente_nome).split(/\s+/)[0]}`)
  if (dataHora(s.impresso_em)) linhas.push(dataHora(s.impresso_em))
  if (Number(s.via) > 1) linhas.push(`${s.via}a via`)
  linhas.forEach((l, i) => b.push({ t: 'linha', s: l, primeiro: i === 0 }))
  if (teste) {
    b.push({ t: 'aviso', s: 'TESTE DE IMPRESSAO - PEDIDO DE DEMONSTRACAO' })
    const e = s.endereco && typeof s.endereco === 'object' ? s.endereco : null
    if (texto(s.cliente_telefone)) b.push({ t: 'linha', s: `Tel.: ${texto(s.cliente_telefone)}` })
    if (e) b.push({ t: 'linha', s: [texto(e.rua), texto(e.numero)].filter(Boolean).join(', ') })
  }

  // Itens: QTD, DESCRICAO, TOTAL.
  b.push({ t: 'faixa', s: 'ITENS CONSUMIDOS', alta: true, primeiro: true })
  b.push({ t: 'tabela_cab' })
  b.push({ t: 'tracejado', depois: 'tabela' })
  const itens = Array.isArray(s.itens) ? s.itens : []
  if (itens.length === 0) b.push({ t: 'linha', s: 'Nenhum item cobrado.' })
  itens.forEach((it, idx) => {
    const variacao = [texto(it.tamanho), texto(it.sabor)].filter(Boolean).join(' - ')
    const subs = []
    if (variacao) subs.push(variacao)
    if (texto(it.borda)) subs.push(`+ Borda: ${texto(it.borda)}`)
    if (texto(it.massa)) subs.push(`+ Massa: ${texto(it.massa)}`)
    const agrupados = new Map()
    for (const c of Array.isArray(it.complementos) ? it.complementos : []) {
      const cur = agrupados.get(c.nome) || { nome: c.nome, n: 0 }
      cur.n += 1
      agrupados.set(c.nome, cur)
    }
    for (const c of agrupados.values()) subs.push(`+ ${c.n > 1 ? `${c.n}x ` : ''}${texto(c.nome)}`)
    if (texto(it.observacao)) subs.push(`Obs.: ${texto(it.observacao)}`)
    b.push({ t: 'tabela_item', qtd: String(it.quantidade), desc: maiusculo(it.nome), total: brl(it.subtotal), subs, primeiro: idx === 0 })
  })

  // Valores
  b.push({ t: 'faixa', s: 'VALORES' })
  const valores = [{ rotulo: 'Subtotal', valor: brl(s.subtotal) }]
  if (Number(s.taxa) > 0 || Number(s.taxa_percentual) > 0) valores.push({ rotulo: 'Taxa de serviço', valor: brl(s.taxa) })
  if (Number(s.taxa_extra) > 0) valores.push({ rotulo: texto(s.taxa_extra_nome) || 'Taxa', valor: brl(s.taxa_extra) })
  if (teste && Number(s.taxa_entrega) > 0) valores.push({ rotulo: 'Taxa de entrega', valor: brl(s.taxa_entrega) })
  if (Number(s.desconto) > 0) valores.push({ rotulo: 'Desconto', valor: `- ${brl(s.desconto)}` })
  const pago = Number(s.pago) || 0
  if (pago > 0) {
    valores.push({ rotulo: 'Total da conta', valor: brl(s.total) })
    valores.push({ rotulo: 'Ja pago', valor: `- ${brl(pago)}` })
  }
  valores.forEach((v, i) => b.push({ t: 'par', ...v, primeiro: i === 0 }))
  b.push({ t: 'tracejado', depois: 'valores' })
  b.push({ t: 'total', rotulo: pago > 0 ? 'A PAGAR' : 'TOTAL', valor: brl(pago > 0 ? s.restante : s.total) })
  b.push({ t: 'tracejado', depois: 'total' })

  // Rodapé: texto da loja + QR (Instagram ou cardápio), como o modelo.
  const qr = s.qr && Array.isArray(s.qr.linhas) && s.qr.linhas.length >= 21 ? { linhas: s.qr.linhas, icone: s.qr.origem === 'instagram' ? 'instagram' : '' } : null
  // Modelo da pré-conta: rodapé todo em peso normal.
  const rod = linhasDoRodape(s.qr || null, s.loja).map((l) => (l.s === 'Feito por Sistema Menúzia' ? { s: 'Sistema Menúzia' } : { s: l.s }))
  b.push({ t: 'rodape_qr', linhas: rod, qr })
  if (teste) {
    b.push({ t: 'aviso', s: 'TESTE DE IMPRESSAO - SEM VALOR FISCAL' })
    b.push({ t: 'marcas' })
  }

  return { versao: 3, modelo: 'pre_conta', teste, loja: texto(s.loja), blocos: b }
}

/** Texto corrido do documento (registro, busca em teste e impressão de emergência). */
function textoDoDocumento(doc) {
  const out = []
  for (const k of doc.blocos) {
    switch (k.t) {
      case 'logo': out.push('MENUZIA'); break
      case 'titulo': case 'horas': case 'aviso': case 'faixa': case 'linha': case 'obs_pedido': out.push(k.s); break
      case 'pedido': out.push([k.numero, k.tipo].filter(Boolean).join(' | ')); break
      case 'item':
        out.push(`${k.qtd} ${k.nome}`)
        for (const x of k.subs || []) out.push(`   ${x}`)
        if (k.obs) out.push(`   ${k.obs}`)
        break
      case 'par': case 'total': out.push(`${k.rotulo}  ${k.valor}`); break
      case 'dado': out.push(`${k.rotulo} ${k.valor}`); break
      case 'tabela_cab': out.push('QTD  DESCRICAO  TOTAL'); break
      case 'tabela_item':
        out.push(`${k.qtd}  ${k.desc}  ${k.total}`)
        for (const x of k.subs || []) out.push(`     ${x}`)
        break
      case 'tracejado': out.push('- - - - - - - - - - - - - - - -'); break
      case 'qr': out.push('[QR]'); break
      case 'rodape': case 'rodape_qr': for (const l of k.linhas || []) out.push(l.s); if (k.qr) out.push('[QR]'); break
      default: break
    }
  }
  return out.join('\n')
}

module.exports = { montarPreContaBeta, textoDoDocumento, statusPagamento }
