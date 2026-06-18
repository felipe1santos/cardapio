function brl(v) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function linha(largura, char = '-') {
  return char.repeat(largura)
}

function colunas(largura, esquerda, direita) {
  const espaco = Math.max(1, largura - esquerda.length - direita.length)
  return esquerda + ' '.repeat(espaco) + direita
}

/** Monta o recibo em texto simples, respeitando as configurações de impressão da loja. */
function montarRecibo(pedido, config, largura) {
  const out = []
  out.push(colunas(largura, `PEDIDO #${pedido.numero}`, pedido.tipo === 'entrega' ? 'ENTREGA' : 'RETIRADA'))
  out.push(linha(largura))
  if (pedido.clienteNome) out.push(`Cliente: ${pedido.clienteNome}`)
  if (pedido.tipo === 'entrega') {
    out.push(`End.: ${pedido.enderecoRua}, ${pedido.enderecoNumero} - ${pedido.enderecoBairro}`)
  }
  out.push(linha(largura))

  for (const item of pedido.itens) {
    const nomeItem = config.mostrarNumeroItem ? `${item.quantidade}x ${item.nome}` : item.nome
    const variacao = [item.tamanhoNome, item.saborNome].filter(Boolean).join(' - ')
    const nomeComVariacao = variacao ? `${nomeItem} (${variacao})` : nomeItem
    out.push(colunas(largura, nomeComVariacao, brl(item.precoUnitario * item.quantidade)))
    if (item.bordaNome) out.push(`   + Borda: ${item.bordaNome}`)
    if (item.massaNome) out.push(`   + Massa: ${item.massaNome}`)
    if (config.mostrarNomeComplementos) {
      for (const comp of item.complementos) {
        const precoTxt = config.mostrarPrecoComplementos && comp.preco > 0 ? ` (+${brl(comp.preco)})` : ''
        out.push(`   + ${comp.nome}${precoTxt}`)
      }
    }
    if (item.observacao) out.push(`   obs: ${item.observacao}`)
  }

  out.push(linha(largura))
  out.push(colunas(largura, 'Subtotal', brl(pedido.subtotal)))
  if (pedido.tipo === 'entrega') out.push(colunas(largura, 'Taxa de entrega', brl(pedido.taxaEntrega)))
  out.push(colunas(largura, 'TOTAL', brl(pedido.total)))
  out.push(linha(largura))
  out.push(`Pagamento: ${pedido.formaPagamento.toUpperCase()}`)
  if (pedido.formaPagamento === 'dinheiro' && pedido.trocoPara) {
    out.push(`Troco para: ${brl(pedido.trocoPara)}`)
  }
  if (pedido.observacao) out.push(`Obs. do pedido: ${pedido.observacao}`)
  out.push('')
  out.push('')
  return out.join('\n')
}

module.exports = { montarRecibo }
