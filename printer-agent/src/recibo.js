function brl(v) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
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

// Cabeçalho de seção no estilo "===== TITULO =====": legível e compacto, sem as
// linhas tracejadas soltas que deixavam o cupom com cara de rascunho. Centraliza o
// título preenchendo as laterais com '='.
function secao(largura, titulo) {
  const t = ` ${titulo} `
  if (t.length >= largura) return centro(largura, titulo)
  const total = largura - t.length
  const left = Math.floor(total / 2)
  const right = total - left
  return '='.repeat(left) + t + '='.repeat(right)
}

// Quebra um texto em linhas que cabem na largura sem cortar palavra no meio. O corte
// no meio da palavra (ex.: "HAMBUR" / "GUERIA") era o que deixava o cupom "quebrado".
function quebrar(largura, texto) {
  const palavras = String(texto).split(/\s+/).filter(Boolean)
  const linhas = []
  let atual = ''
  for (const p of palavras) {
    if (!atual) atual = p
    else if ((atual + ' ' + p).length <= largura) atual += ' ' + p
    else { linhas.push(atual); atual = p }
  }
  if (atual) linhas.push(atual)
  return linhas.length ? linhas : ['']
}

// Quebra `texto` em linhas de no máximo `largura`, cada uma prefixada por `indent`
// (as linhas de continuação também recebem o indent). Palavra maior que o espaço
// disponível é cortada no braço, pra nunca estourar a largura.
function envolver(largura, texto, indent = '') {
  const max = Math.max(1, largura - indent.length)
  const linhas = []
  let atual = ''
  for (let palavra of String(texto).split(/\s+/).filter(Boolean)) {
    while (palavra.length > max) {
      if (atual) { linhas.push(atual); atual = '' }
      linhas.push(palavra.slice(0, max))
      palavra = palavra.slice(max)
    }
    if (!atual) atual = palavra
    else if ((atual + ' ' + palavra).length <= max) atual += ' ' + palavra
    else { linhas.push(atual); atual = palavra }
  }
  if (atual) linhas.push(atual)
  return (linhas.length ? linhas : ['']).map((l) => indent + l)
}

// Linha "nome ............ R$ valor" com o valor alinhado à direita e o nome
// quebrado em várias linhas quando for longo (sem partir palavra).
function itemLinha(largura, nome, valor) {
  const maxNome = Math.max(1, largura - valor.length - 1)
  const nomeLinhas = quebrar(maxNome, nome)
  return nomeLinhas.map((ln, i) =>
    i === nomeLinhas.length - 1 ? colunas(largura, ln, valor) : ln,
  )
}

/** Monta o recibo em texto simples, respeitando as configurações de impressão da loja.
 * `temLogoImagem` = a logo será desenhada como IMAGEM (pelo print.ps1); nesse caso não
 * repetimos o nome da loja como cabeçalho em texto. */
function montarRecibo(pedido, config, largura, lojaNome = '', temLogoImagem = false) {
  const out = []

  // Sem logo-imagem disponível, usamos o nome da loja como cabeçalho (fallback texto).
  if (config.imprimirLogo && lojaNome && !temLogoImagem) {
    out.push(centro(largura, lojaNome.toUpperCase()))
  }

  out.push(secao(largura, `PEDIDO #${pedido.numero}`))
  out.push(pedido.tipo === 'entrega' ? 'ENTREGA' : 'RETIRADA')

  out.push(secao(largura, 'ITENS'))
  for (const item of pedido.itens) {
    const baseNome = config.mostrarNumeroItem ? `${item.quantidade}x ${item.nome}` : item.nome
    const variacao = [item.tamanhoNome, item.saborNome].filter(Boolean).join(' - ')
    let nomeComVariacao = variacao ? `${baseNome} (${variacao})` : baseNome
    // Fonte maior na produção: realça o item em MAIÚSCULAS (equivalente textual do preview).
    if (config.fonteMaiorProducao) nomeComVariacao = nomeComVariacao.toUpperCase()
    for (const ln of itemLinha(largura, nomeComVariacao, brl(item.precoUnitario * item.quantidade))) {
      out.push(ln)
    }
    if (item.bordaNome) out.push(`  + Borda: ${item.bordaNome}`)
    if (item.massaNome) out.push(`  + Massa: ${item.massaNome}`)
    if (config.mostrarNomeComplementos) {
      for (const comp of item.complementos) {
        // Multiplicar opções pela quantidade do item, igual ao preview do painel.
        const precoComp = comp.preco * (config.multiplicarOpcoesQtd ? item.quantidade : 1)
        const precoTxt = config.mostrarPrecoComplementos && precoComp > 0 ? ` (+${brl(precoComp)})` : ''
        out.push(`  + ${comp.nome}${precoTxt}`)
      }
    }
    if (item.observacao) out.push(`  Obs: ${item.observacao}`)
  }

  out.push(secao(largura, 'PAGAMENTO'))
  out.push(colunas(largura, 'Subtotal', brl(pedido.subtotal)))
  if (pedido.tipo === 'entrega') out.push(colunas(largura, 'Taxa de entrega', brl(pedido.taxaEntrega)))
  out.push(colunas(largura, 'TOTAL', brl(pedido.total)))
  out.push(`Pagamento: ${pedido.formaPagamento.toUpperCase()}`)
  if (pedido.formaPagamento === 'dinheiro' && pedido.trocoPara) {
    out.push(`Troco para: ${brl(pedido.trocoPara)}`)
  }
  if (pedido.observacao) out.push(`Obs. do pedido: ${pedido.observacao}`)

  if (pedido.clienteNome || pedido.clienteTelefone || pedido.tipo === 'entrega') {
    out.push(secao(largura, 'CLIENTE'))
    if (pedido.clienteNome) out.push(`Cliente: ${pedido.clienteNome}`)
    if (pedido.clienteTelefone) out.push(`Tel.: ${pedido.clienteTelefone}`)
    if (pedido.tipo === 'entrega') {
      for (const ln of quebrar(largura, `End.: ${pedido.enderecoRua}, ${pedido.enderecoNumero} - ${pedido.enderecoBairro}`)) {
        out.push(ln)
      }
    }
  }

  out.push('')
  out.push('')

  // Garante que NENHUMA linha ultrapasse `largura`. Sem isso, uma linha longa (nome do
  // cliente, endereço, complemento, observação) fazia o print.ps1 dimensionar a fonte
  // pra caber a linha mais larga -> o recibo real saía com fonte MENOR que o teste.
  // Requebra qualquer linha que estoure, preservando a indentação.
  const normalizado = []
  for (const linha of out) {
    if (linha.length <= largura) { normalizado.push(linha); continue }
    const indent = linha.slice(0, linha.length - linha.trimStart().length)
    for (const parte of envolver(largura, linha.trimStart(), indent)) normalizado.push(parte)
  }
  return normalizado.join('\n')
}

module.exports = { montarRecibo }
