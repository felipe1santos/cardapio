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

function centro(largura, texto) {
  const t = texto.slice(0, largura)
  const pad = Math.max(0, Math.floor((largura - t.length) / 2))
  return ' '.repeat(pad) + t
}

/** Monta o recibo em texto simples, respeitando as configurações de impressão da loja. */
function montarRecibo(pedido, config, largura, lojaNome = '') {
  const out = []
  // Logo: a impressão é em texto puro (não imprime imagem), então usamos o nome da loja
  // como cabeçalho — equivalente ao "[ LOGO ]" mostrado na prévia do painel.
  if (config.imprimirLogo && lojaNome) {
    out.push(centro(largura, lojaNome.toUpperCase()))
    out.push('')
  }
  out.push(colunas(largura, `PEDIDO #${pedido.numero}`, pedido.tipo === 'entrega' ? 'ENTREGA' : 'RETIRADA'))
  out.push(linha(largura))
  if (pedido.clienteNome) out.push(`Cliente: ${pedido.clienteNome}`)
  if (pedido.tipo === 'entrega') {
    out.push(`End.: ${pedido.enderecoRua}, ${pedido.enderecoNumero} - ${pedido.enderecoBairro}`)
  }
  out.push(linha(largura))

  for (const item of pedido.itens) {
    const baseNome = config.mostrarNumeroItem ? `${item.quantidade}x ${item.nome}` : item.nome
    const variacao = [item.tamanhoNome, item.saborNome].filter(Boolean).join(' - ')
    let nomeComVariacao = variacao ? `${baseNome} (${variacao})` : baseNome
    // Fonte maior na produção: realça o item em MAIÚSCULAS (equivalente textual do preview).
    if (config.fonteMaiorProducao) nomeComVariacao = nomeComVariacao.toUpperCase()
    out.push(colunas(largura, nomeComVariacao, brl(item.precoUnitario * item.quantidade)))
    if (item.bordaNome) out.push(`   + Borda: ${item.bordaNome}`)
    if (item.massaNome) out.push(`   + Massa: ${item.massaNome}`)
    if (config.mostrarNomeComplementos) {
      for (const comp of item.complementos) {
        // Multiplicar opções pela quantidade do item, igual ao preview do painel.
        const precoComp = comp.preco * (config.multiplicarOpcoesQtd ? item.quantidade : 1)
        const precoTxt = config.mostrarPrecoComplementos && precoComp > 0 ? ` (+${brl(precoComp)})` : ''
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
