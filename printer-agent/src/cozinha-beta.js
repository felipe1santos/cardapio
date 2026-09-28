// ─────────────────────────────────────────────────────────────────────────────
// COMANDA DA COZINHA do ASSISTENTE BETA — modelo docs/referencias/impressao/v3/COMANDA.png
// (2026-09-28): logo da loja (ou o nome), "COMANDA COZINHA", "#129" com o tipo num selo,
// horários, faixa ITENS DO PEDIDO com "ITEM / VALOR (R$)", cada item com o seu valor e os
// adicionais com o deles (a coluna soma o Subtotal), observação em faixa cinza, VALORES
// (com o ícone da forma de pagamento), TOTAL, dados da entrega / mesa / cliente, QR e o
// rodapé com nome, telefone e endereço da loja.
//
// Só o Beta usa este arquivo. A ficha do Assistente atual (recibo.js + print.ps1) não
// muda. Monta BLOCOS (JSON); quem desenha é o ticket-canvas.js — o mesmo desenho da
// pré-visualização do painel. Opções da loja (Impressão › Opções da impressão): número do
// item, nome e preço dos adicionais, multiplicar pela quantidade, fonte maior e logo.
// ─────────────────────────────────────────────────────────────────────────────

const { valoresDoItem, numero } = require('./valores-item')

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

/** O que vai no selo ao lado do número do pedido. */
function tipoDoPedido(p) {
  // Mesa cadastrada como "Mesa 01" já traz a palavra; "01" ganha o prefixo.
  if (p.canal === 'mesa') return !p.mesa ? 'MESA' : /^mesa( |$)/i.test(texto(p.mesa)) ? maiusculo(p.mesa) : `MESA ${maiusculo(p.mesa)}`
  if (p.tipo === 'entrega') return 'ENTREGA'
  if (p.canal === 'balcao') return p.senha ? `SENHA ${p.senha}` : 'BALCAO'
  return 'RETIRADA'
}

/** "@usuario" do link do Instagram (QR). */
function arroba(url) {
  const m = /instagram\.com\/([A-Za-z0-9._]{1,30})\/?$/.exec(texto(url))
  return m ? `@${m[1]}` : ''
}

/** Frase embaixo do QR: Instagram da loja ou, sem ele, o cardápio. */
function linhasDoQr(qr) {
  if (qr && qr.origem === 'instagram' && arroba(qr.url)) return [{ s: 'Siga a gente no Instagram' }, { s: arroba(qr.url), negrito: true }]
  if (qr) return [{ s: 'Peça de novo pelo nosso cardápio' }]
  return []
}

/** Nome, telefone e endereço da LOJA (do cadastro — nunca o endereço do cliente). */
function dadosDaLoja(loja, lojaNome) {
  const l = loja && typeof loja === 'object' ? loja : {}
  return { nome: maiusculo(l.nome || lojaNome), telefone: texto(l.telefone), endereco: texto(l.endereco) }
}

/**
 * @param {object} pedido  item da fila /api/agente/pedidos (mesmo formato do recibo.js)
 * @param {object} o       { config, lojaNome, loja: { nome, telefone, endereco }, extras, qr, teste }
 */
function montarCozinhaBeta(pedido, o = {}) {
  const config = o.config || {}
  const extras = o.extras || {}
  const p = pedido
  const b = []
  const teste = o.teste === true
  const loja = dadosDaLoja(o.loja, o.lojaNome)

  if (teste) b.push({ t: 'marcas' })
  b.push({ t: 'logo', nome: loja.nome })
  b.push({ t: 'titulo', s: 'COMANDA COZINHA' })
  b.push({ t: 'pedido', numero: `#${p.numero}`, tipo: tipoDoPedido(p) })

  const horas = []
  const recebido = hora(p.criadoEm)
  if (recebido) horas.push(`Recebido ${recebido}`)
  const pronto = hora(extras.prontoEm)
  const aceito = hora(extras.aceitoEm)
  if (pronto) horas.push(`Pronto ${pronto}`)
  else if (aceito) horas.push(`Aceito ${aceito}`)
  if (horas.length) b.push({ t: 'horas', s: horas.join('  •  ') })
  if (teste) b.push({ t: 'aviso', s: 'TESTE DE IMPRESSÃO - NÃO PREPARAR' })

  // Itens: "1x NOME" e o valor; adicionais com o valor deles (a coluna soma o Subtotal).
  b.push({ t: 'faixa', s: 'ITENS DO PEDIDO' })
  b.push({ t: 'itens_cab', esq: 'ITEM', dir: 'VALOR (R$)' })
  const itens = Array.isArray(p.itens) ? p.itens : []
  const mostrarQtd = config.mostrarNumeroItem !== false
  const mostrarNomes = config.mostrarNomeComplementos !== false
  const mostrarPrecos = config.mostrarPrecoComplementos !== false
  const multiplicar = config.multiplicarOpcoesQtd === true
  itens.forEach((it, idx) => {
    const qtd = Math.max(1, Number(it.quantidade) || 1)
    const v = valoresDoItem(qtd, it.precoUnitario, it.complementos)
    const subs = []
    const variacao = [texto(it.tamanhoNome), texto(it.saborNome)].filter(Boolean).join(' - ')
    if (variacao) subs.push({ s: variacao })
    if (texto(it.bordaNome)) subs.push({ s: `+ Borda: ${texto(it.bordaNome)}` })
    if (texto(it.massaNome)) subs.push({ s: `+ Massa: ${texto(it.massaNome)}` })
    // Sem o nome (ou sem o preço) dos adicionais, o valor deles fica na linha do item.
    let valorItem = v.item
    if (mostrarNomes) {
      for (const a of v.adicionais) {
        const vezes = multiplicar ? a.vezes * qtd : a.vezes
        const valor = mostrarPrecos && a.valor > 0 ? numero(a.valor) : ''
        if (!valor) valorItem += a.valor
        subs.push({ s: `+ ${vezes > 1 ? `${vezes}x ` : ''}${texto(a.nome)}`, valor })
      }
    } else {
      valorItem += v.adicionais.reduce((s, a) => s + a.valor, 0)
    }
    const obs = texto(it.observacao)
    b.push({
      t: 'item',
      texto: `${mostrarQtd ? `${qtd}x ` : ''}${maiusculo(it.nome)}`,
      valor: numero(valorItem),
      subs,
      obs: obs ? `OBS: ${maiusculo(obs)}` : '',
      primeiro: idx === 0,
    })
  })
  if (texto(p.observacao)) b.push({ t: 'obs_pedido', s: `OBS. DO PEDIDO: ${maiusculo(p.observacao)}` })

  // Valores (como já eram; só o ícone da forma de pagamento é novo).
  b.push({ t: 'faixa', s: 'VALORES' })
  const valores = []
  valores.push({ rotulo: 'Subtotal', valor: brl(p.subtotal) })
  if (p.tipo === 'entrega' || Number(p.taxaEntrega) > 0) valores.push({ rotulo: 'Taxa de entrega', valor: brl(p.taxaEntrega) })
  const desconto = Number(extras.desconto) || 0
  if (desconto > 0) valores.push({ rotulo: 'Desconto', valor: `- ${brl(desconto)}` })
  // Mesa acerta na conta, no fechamento: forma de pagamento aqui só confundiria.
  if (p.canal !== 'mesa' && texto(p.formaPagamento)) {
    valores.push({ rotulo: 'Pagamento', valor: ROTULO_FORMA[p.formaPagamento] || maiusculo(p.formaPagamento), icone: texto(p.formaPagamento) })
    if (p.formaPagamento === 'dinheiro' && Number(p.trocoPara) > 0) valores.push({ rotulo: 'Troco para', valor: brl(p.trocoPara) })
    if (p.pago === true) valores.push({ rotulo: 'Status', valor: 'PAGO' })
  }
  valores.forEach((v, i) => b.push({ t: 'par', ...v, primeiro: i === 0 }))
  b.push({ t: 'tracejado' })
  b.push({ t: 'total', rotulo: 'TOTAL', valor: brl(p.total) })

  // Dados: entrega, mesa ou cliente. Nada de endereço inventado fora da entrega.
  const dados = []
  const dado = (rotulo, valor, negrito = true) => {
    const v = texto(valor)
    if (v) dados.push({ rotulo, valor: v, negrito })
  }
  let secao
  if (p.tipo === 'entrega') {
    secao = 'DADOS DA ENTREGA'
    dado('Cliente:', p.clienteNome)
    dado('Telefone:', p.clienteTelefone)
    const end = [texto(p.enderecoRua), texto(p.enderecoNumero)].filter(Boolean).join(', ')
    dado('Endereco:', [end, texto(p.enderecoComplemento)].filter(Boolean).join(' - '), false)
    dado('Bairro:', maiusculo(p.enderecoBairro))
  } else if (p.canal === 'mesa') {
    secao = 'DADOS DA MESA'
    // "Mesa 01" cadastrada com a palavra: sai "Mesa: 01", não "Mesa: Mesa 01".
    dado('Mesa:', texto(p.mesa).replace(/^mesa\s+/i, ''))
    dado('Comanda:', extras.comandaNumero ? String(extras.comandaNumero) : '')
    dado('Atendente:', extras.atendente)
    dado('Cliente:', p.clienteNome)
  } else {
    secao = 'DADOS DO CLIENTE'
    dado('Cliente:', p.clienteNome)
    dado('Telefone:', p.clienteTelefone)
    if (p.canal === 'balcao' && p.senha) dado('Senha:', String(p.senha))
    dado('Atendente:', extras.atendente)
  }
  if (dados.length) {
    b.push({ t: 'faixa', s: secao })
    dados.forEach((d, i) => b.push({ t: 'dado', ...d, primeiro: i === 0 }))
  }

  // Rodapé: QR, frase, loja (nome, telefone, endereço) e "Feito por".
  const qr = o.qr && Array.isArray(o.qr.linhas) && o.qr.linhas.length >= 21 ? o.qr : null
  if (qr) b.push({ t: 'qr', linhas: qr.linhas, icone: qr.origem === 'instagram' ? 'instagram' : '' })
  b.push({ t: 'rodape', linhas: linhasDoQr(qr), loja, final: 'Feito por Sistema Menuzia' })
  if (teste) b.push({ t: 'marcas' })

  return { versao: 4, modelo: 'cozinha', teste, loja: loja.nome, fonteMaior: config.fonteMaiorProducao === true, blocos: b }
}

module.exports = { montarCozinhaBeta, brl, linhasDoQr, dadosDaLoja }
