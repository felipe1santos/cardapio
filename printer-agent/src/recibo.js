// ─────────────────────────────────────────────────────────────────────────────
// Recibo estruturado por MARCADORES de linha. Cada linha começa com \x01<tipo> e os
// campos são separados por \x02. O print.ps1 lê esses marcadores pra DESENHAR cada
// tipo diferente (barra preta na divisória, item em negrito com preço à direita,
// TOTAL grande, rodapé etc.) — igual à referência profissional. Se o render gráfico
// falhar, o print.ps1 limpa os marcadores e imprime texto puro legível (fallback).
//
// Tipos:
//   \x01N\x02<texto>            nome da loja (grande, centralizado) — só sem logo imagem
//   \x01H\x02<titulo>           divisória (retângulo preto, texto branco centralizado)
//   \x01C\x02<texto>            linha centralizada (ENTREGA/RETIRADA)
//   \x01I\x02<nome>\x02<preco>  item (negrito grande, nome esq. + preço dir.)
//   \x01S\x02<texto>            sub-linha do item (+ borda/complemento/obs, recuada)
//   \x01P\x02<label>\x02<valor> linha de pagamento (subtotal/taxa) com preço à direita
//   \x01T\x02<label>\x02<valor> TOTAL (extra grande)
//   \x01L\x02<texto>            linha normal à esquerda (Pagamento/Troco/Cliente/Tel/End)
//   \x01R                       separador pontilhado
//   \x01F\x02<texto>            rodapé (pequeno, centralizado)
// ─────────────────────────────────────────────────────────────────────────────

const SOH = '\x01' // início de linha marcada
const STX = '\x02' // separador de campo

function brl(v) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

/** Monta o recibo como lista de linhas marcadas (uma string por linha). */
function montarReciboLinhas(pedido, config, lojaNome = '', temLogoImagem = false) {
  const L = []
  const H = (t) => L.push(`${SOH}H${STX}${t}`)
  const I = (nome, preco) => L.push(`${SOH}I${STX}${nome}${STX}${preco}`)
  const S = (t) => L.push(`${SOH}S${STX}${t}`)
  const P = (label, valor) => L.push(`${SOH}P${STX}${label}${STX}${valor}`)
  const T = (label, valor) => L.push(`${SOH}T${STX}${label}${STX}${valor}`)
  const Lin = (t) => L.push(`${SOH}L${STX}${t}`)
  const C = (t) => L.push(`${SOH}C${STX}${t}`)
  const HR = () => L.push(`${SOH}R`)

  // Nome da loja como cabeçalho em texto só quando NÃO há logo-imagem (senão a logo
  // já é a marca no topo, desenhada pelo print.ps1).
  if (config.imprimirLogo && lojaNome && !temLogoImagem) {
    L.push(`${SOH}N${STX}${lojaNome.toUpperCase()}`)
  }

  H(`PEDIDO #${pedido.numero}`)
  C(pedido.tipo === 'entrega' ? 'ENTREGA' : 'RETIRADA')
  if (pedido.origem === 'pdv') C(pedido.mesa ? `MESA ${pedido.mesa}` : 'BALCAO (PDV)')
  if (pedido.criadoEm) {
    const dt = new Date(pedido.criadoEm)
    if (!isNaN(dt.getTime())) {
      C(dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' -'))
    }
  }

  const totalUnidades = pedido.itens.reduce((s, i) => s + (i.quantidade || 1), 0)
  H(`ITENS (${totalUnidades})`)
  pedido.itens.forEach((item, idx) => {
    const baseNome = config.mostrarNumeroItem ? `${item.quantidade}x ${item.nome}` : item.nome
    const variacao = [item.tamanhoNome, item.saborNome].filter(Boolean).join(' - ')
    const nomeComVariacao = variacao ? `${baseNome} (${variacao})` : baseNome
    I(nomeComVariacao, brl(item.precoUnitario * item.quantidade))
    if (item.bordaNome) S(`+ Borda: ${item.bordaNome}`)
    if (item.massaNome) S(`+ Massa: ${item.massaNome}`)
    if (config.mostrarNomeComplementos) {
      // Complementos repetidos (cliente escolheu quantidade) viram "2x Bacon" numa linha só.
      const agrupados = new Map()
      for (const comp of item.complementos) {
        const cur = agrupados.get(comp.nome) ?? { nome: comp.nome, preco: comp.preco, qtd: 0 }
        cur.qtd += 1
        agrupados.set(comp.nome, cur)
      }
      for (const comp of agrupados.values()) {
        const precoComp = comp.preco * comp.qtd * (config.multiplicarOpcoesQtd ? item.quantidade : 1)
        const precoTxt = config.mostrarPrecoComplementos && precoComp > 0 ? ` (+${brl(precoComp)})` : ''
        S(`+ ${comp.qtd > 1 ? `${comp.qtd}x ` : ''}${comp.nome}${precoTxt}`)
      }
    }
    if (item.observacao) S(`Obs: ${item.observacao}`)
    // Separador pontilhado entre itens (não depois do último).
    if (idx < pedido.itens.length - 1) HR()
  })

  H('PAGAMENTO')
  P('Subtotal', brl(pedido.subtotal))
  if (pedido.desconto > 0) P('Desconto', '-' + brl(pedido.desconto))
  if (pedido.tipo === 'entrega') P('Taxa de entrega', brl(pedido.taxaEntrega))
  T('TOTAL', brl(pedido.total))
  Lin(`Pagamento: ${pedido.formaPagamento.toUpperCase()}`)
  if (typeof pedido.pago === 'boolean') Lin(pedido.pago ? 'Status: PAGO' : 'Status: A RECEBER')
  if (pedido.formaPagamento === 'dinheiro' && pedido.trocoPara) Lin(`Troco para: ${brl(pedido.trocoPara)}`)
  if (pedido.observacao) Lin(`Obs. do pedido: ${pedido.observacao}`)

  if (pedido.clienteNome || pedido.clienteTelefone || pedido.tipo === 'entrega') {
    H('CLIENTE')
    if (pedido.clienteNome) Lin(`Cliente: ${pedido.clienteNome}`)
    if (pedido.clienteTelefone) Lin(`Tel.: ${pedido.clienteTelefone}`)
    if (pedido.tipo === 'entrega') {
      Lin(`End.: ${pedido.enderecoRua}, ${pedido.enderecoNumero}`)
      if (pedido.enderecoComplemento) Lin(`Compl.: ${pedido.enderecoComplemento}`)
      if (pedido.enderecoBairro) Lin(`Bairro: ${pedido.enderecoBairro}`)
      if (pedido.enderecoCep) Lin(`CEP: ${pedido.enderecoCep}`)
    }
  }

  L.push(`${SOH}F${STX}feito por Menuzia.com.br`)
  return L
}

/** String marcada (uma linha por \n) — é o que vai pro print.ps1. */
function montarRecibo(pedido, config, largura, lojaNome = '', temLogoImagem = false) {
  return montarReciboLinhas(pedido, config, lojaNome, temLogoImagem).join('\n')
}

module.exports = { montarRecibo, montarReciboLinhas }
