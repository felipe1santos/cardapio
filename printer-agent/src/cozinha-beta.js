// ─────────────────────────────────────────────────────────────────────────────
// COMANDA DA COZINHA do ASSISTENTE BETA — modelo oficial (2026-09-28,
// mockup-comanda-cozinha-termica-menuzia): topo com horários e o tipo do pedido,
// logo no meio, faixa preta com o número, ITENS DO PEDIDO com bolinha, adicionais com
// preço à direita, observação entre colchetes, VALORES, faixa do TOTAL, dados da
// entrega (ou da mesa / do cliente) e o QR da loja no fim.
//
// Só o Beta usa este arquivo. A ficha do Assistente atual (recibo.js + print.ps1) não
// muda. Monta BLOCOS (JSON); quem mede e desenha é o print-beta.ps1, na largura real do
// papel. Nenhum valor é calculado aqui além de repartir o que o pedido já traz: a linha
// do item leva o preço sem os adicionais e cada adicional leva o dele, e a soma bate com
// o subtotal (preço unitário gravado = base + adicionais).
// ─────────────────────────────────────────────────────────────────────────────

function brl(v) {
  const n = Math.round((Number(v) || 0) * 100) / 100
  return `R$ ${n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

const texto = (v) => (v === undefined || v === null ? '' : String(v).trim())
const maiusculo = (v) => texto(v).toLocaleUpperCase('pt-BR')

function hora(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
}

const ROTULO_FORMA = { dinheiro: 'DINHEIRO', pix: 'PIX', cartao: 'CARTAO', credito: 'CREDITO', debito: 'DEBITO', vale: 'VALE-REFEICAO', fiado: 'FIADO' }

/** O que vai no canto superior direito. */
function tipoDoPedido(p) {
  // Mesa cadastrada como "Mesa 01" já traz a palavra; "01" ganha o prefixo.
  if (p.canal === 'mesa') return !p.mesa ? 'MESA' : /^mesa( |$)/i.test(texto(p.mesa)) ? maiusculo(p.mesa) : `MESA ${maiusculo(p.mesa)}`
  if (p.tipo === 'entrega') return 'ENTREGA'
  if (p.canal === 'balcao') return 'BALCAO'
  return 'RETIRADA'
}

/**
 * @param {object} pedido  item da fila /api/agente/pedidos (mesmo formato do recibo.js)
 * @param {object} o       { config, lojaNome, extras, qr, teste }
 */
function montarCozinhaBeta(pedido, o = {}) {
  const config = o.config || {}
  const extras = o.extras || {}
  const p = pedido
  const b = []
  const teste = o.teste === true

  if (teste) b.push({ t: 'marcas' })

  // Topo: horários à esquerda, logo no meio, tipo à direita.
  const linhasTopo = []
  const recebido = hora(p.criadoEm)
  if (recebido) linhasTopo.push(['Recebido', recebido])
  const pronto = hora(extras.prontoEm)
  const aceito = hora(extras.aceitoEm)
  if (pronto) linhasTopo.push(['Pronto', pronto])
  else if (aceito) linhasTopo.push(['Aceito', aceito])
  b.push({ t: 'topo', linhas: linhasTopo, direita: tipoDoPedido(p), logo: 'circulo' })

  // Faixa preta com o número. Balcão com senha: a senha é o que se chama no balcão.
  b.push({ t: 'faixa_num', esq: `#${p.numero}`, dir: p.canal === 'balcao' && p.senha ? `SENHA ${p.senha}` : 'COMANDA' })
  if (teste) b.push({ t: 'centro', s: 'TESTE DE IMPRESSAO - NAO PREPARAR', negrito: true })

  // Itens
  b.push({ t: 'secao', s: 'ITENS DO PEDIDO' })
  const itens = Array.isArray(p.itens) ? p.itens : []
  const mostrarNomes = config.mostrarNomeComplementos !== false
  const mostrarPrecos = config.mostrarPrecoComplementos !== false
  for (const it of itens) {
    const qtd = Math.max(1, Number(it.quantidade) || 1)
    const comps = Array.isArray(it.complementos) ? it.complementos : []
    const somaComps = comps.reduce((s, c) => s + (Number(c.preco) || 0), 0)
    const unitario = Number(it.precoUnitario) || 0
    // Sem nomes de adicionais na ficha (opção da loja): o preço deles fica na linha do item.
    const precoLinha = mostrarNomes ? (unitario - somaComps) * qtd : unitario * qtd
    b.push({ t: 'item_bola', qtd: `${qtd}x`, nome: maiusculo(it.nome), valor: brl(precoLinha) })

    const det = []
    const variacao = [texto(it.tamanhoNome), texto(it.saborNome)].filter(Boolean).join(' - ')
    if (variacao) det.push({ s: variacao, valor: '' })
    if (texto(it.bordaNome)) det.push({ s: `+ Borda: ${texto(it.bordaNome)}`, valor: '' })
    if (texto(it.massaNome)) det.push({ s: `+ Massa: ${texto(it.massaNome)}`, valor: '' })
    if (mostrarNomes) {
      // Repetido (cliente escolheu quantidade) vira "2x Bacon" numa linha só.
      const agrupados = new Map()
      for (const c of comps) {
        const cur = agrupados.get(c.nome) || { nome: c.nome, preco: Number(c.preco) || 0, n: 0 }
        cur.n += 1
        agrupados.set(c.nome, cur)
      }
      for (const c of agrupados.values()) {
        const preco = c.preco * c.n * qtd
        det.push({ s: `+ ${c.n > 1 ? `${c.n}x ` : ''}${texto(c.nome)}`, valor: mostrarPrecos && preco > 0 ? brl(preco) : '' })
      }
    }
    const obs = texto(it.observacao)
    b.push({ t: 'detalhes', linhas: det, obs: obs ? `[OBS.: ${maiusculo(obs)}]` : '' })
  }
  if (texto(p.observacao)) b.push({ t: 'obs_pedido', s: `[OBS. DO PEDIDO: ${maiusculo(p.observacao)}]` })

  // Valores
  b.push({ t: 'secao', s: 'VALORES' })
  b.push({ t: 'par', rotulo: 'Subtotal', valor: brl(p.subtotal) })
  if (p.tipo === 'entrega' || Number(p.taxaEntrega) > 0) b.push({ t: 'par', rotulo: 'Taxa de entrega', valor: brl(p.taxaEntrega) })
  const desconto = Number(extras.desconto) || 0
  if (desconto > 0) b.push({ t: 'par', rotulo: 'Desconto', valor: `- ${brl(desconto)}` })
  // Mesa acerta na conta, no fechamento: forma de pagamento aqui só confundiria.
  if (p.canal !== 'mesa' && texto(p.formaPagamento)) {
    b.push({ t: 'rotulo_valor', rotulo: 'Pagamento:', valor: ROTULO_FORMA[p.formaPagamento] || maiusculo(p.formaPagamento) })
    if (p.formaPagamento === 'dinheiro' && Number(p.trocoPara) > 0) b.push({ t: 'rotulo_valor', rotulo: 'Troco para:', valor: brl(p.trocoPara) })
    if (p.pago === true) b.push({ t: 'rotulo_valor', rotulo: 'Status:', valor: 'PAGO' })
  }
  b.push({ t: 'faixa_total', rotulo: 'TOTAL', valor: brl(p.total) })
  b.push({ t: 'regua' })

  // Dados: entrega, mesa ou cliente. Nada de endereço inventado fora da entrega.
  const dado = (rotulo, valor, negrito = true) => {
    const v = texto(valor)
    if (v) b.push({ t: 'dado', rotulo, valor: v, negrito })
  }
  if (p.tipo === 'entrega') {
    b.push({ t: 'secao', s: 'DADOS DA ENTREGA' })
    dado('Cliente:', p.clienteNome)
    dado('Telefone:', p.clienteTelefone)
    const end = [texto(p.enderecoRua), texto(p.enderecoNumero)].filter(Boolean).join(', ')
    dado('Endereco:', [end, texto(p.enderecoComplemento)].filter(Boolean).join(' - '), false)
    dado('Bairro:', maiusculo(p.enderecoBairro))
  } else if (p.canal === 'mesa') {
    b.push({ t: 'secao', s: 'DADOS DA MESA' })
    dado('Mesa:', p.mesa)
    dado('Comanda:', extras.comandaNumero ? String(extras.comandaNumero) : '')
    dado('Atendente:', extras.atendente)
    dado('Cliente:', p.clienteNome)
  } else {
    b.push({ t: 'secao', s: 'DADOS DO CLIENTE' })
    dado('Cliente:', p.clienteNome)
    dado('Telefone:', p.clienteTelefone)
    if (p.canal === 'balcao' && p.senha) dado('Senha:', String(p.senha))
    dado('Atendente:', extras.atendente)
  }

  const qr = o.qr
  if (qr && Array.isArray(qr.linhas) && qr.linhas.length >= 21) {
    b.push({ t: 'qr', linhas: qr.linhas, icone: qr.origem === 'instagram' ? 'instagram' : '' })
  }
  b.push({ t: 'rodape', s: 'Feito por Menúzia' })
  if (teste) b.push({ t: 'marcas' })
  b.push({ t: 'corte' })

  return { versao: 2, modelo: 'cozinha', teste, loja: texto(o.lojaNome), blocos: b }
}

module.exports = { montarCozinhaBeta, brl }
