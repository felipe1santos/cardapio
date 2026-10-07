// ─────────────────────────────────────────────────────────────────────────────
// MODELO OFICIAL v3 da impressão do ASSISTENTE BETA (2026-10-05): comanda (entrega,
// retirada, mesa, balcão), pré-conta (mesa, balcão) e a via da COZINHA (sem valores).
// Referências: docs/impressao-final/referencias/comanda_v3.png e preconta_v3.png.
//
// Topo com a logo, nome, endereço e telefone da loja, data e o tipo; faixas pretas
// (PEDIDO #N / PRÉ-CONTA, ITENS, OBSERVAÇÃO, PAGAMENTO / VALORES, CLIENTE / MESA); itens
// "1x Nome" com o valor à direita (o nome quebra antes de encostar no valor); TOTAL grande;
// QR, frases e "feito por Menuzia.com.br". Tudo em monoespaçada (DejaVu Sans Mono).
//
// Regras do v3:
//   · telefone "(27) 99239-9932" (sem o 55); endereço quebrado por partes, nunca com a
//     linha começando em hífen (o desenho junta as partes com " - " só quando cabem);
//   · observação do item logo abaixo dele, em destaque; observação geral numa faixa
//     própria antes de PAGAMENTO; vazias não saem;
//   · linha de valor zero não sai;
//   · "PAGO" só com o pedido pago de verdade (Pix online confirmado: "PIX ONLINE - PAGO");
//     pedido aguardando pagamento não é impresso (montarComandaV3 devolve null);
//   · via da cozinha: sem valores e sem PAGAMENTO, itens e observações maiores.
//
// Monta BLOCOS (JSON); quem desenha é o ticket-canvas.js (layoutV3) — o mesmo desenho da
// prévia do painel. Os montadores antigos (cozinha-beta.js, pre-conta-beta.js) continuam
// para quem ainda manda documento no formato antigo.
// ─────────────────────────────────────────────────────────────────────────────

const { valoresDoItem } = require('./valores-item')

const texto = (v) => (v === undefined || v === null ? '' : String(v).trim())
const maiusculo = (v) => texto(v).toLocaleUpperCase('pt-BR')
const NB = ' ' // espaço que não quebra (o desenho só quebra em espaço comum)
const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100

/** "R$ 1.234,56" */
function brl(v) {
  return `R$ ${n2(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}
/** "1.234,56" (coluna do item, sem R$) */
function numero(v) {
  return n2(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** "(27) 99239-9932": tira o 55 do país e formata; outro formato sai como veio. */
function telefone(v) {
  let d = texto(v).replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return texto(v)
}

/** "01/10/2026 20:43" no fuso da loja. */
function dataHora(iso) {
  const d = iso ? new Date(iso) : null
  if (!d || isNaN(d.getTime())) return ''
  const dt = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })
  const h = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  return `${dt} ${h}`
}

/** Partes de um endereço, sem vazios e sem hífen solto nas pontas. */
function partes(lista) {
  return lista.map((s) => texto(s).replace(/^[-–\s]+|[-–\s]+$/g, '')).filter(Boolean)
}

/**
 * Loja do cabeçalho: nome, endereço (rua, nº - complemento - bairro; sem a cidade, como no
 * modelo) e telefone formatado. Aceita o formato novo (linha1/cidade) e o antigo (endereço
 * completo "rua, nº - complemento - bairro, Cidade/UF").
 */
function lojaDoTopo(loja, lojaNome) {
  const l = loja && typeof loja === 'object' ? loja : {}
  const ps = texto(l.endereco).split(/\s+-\s+/).filter(Boolean)
  // Última parte "Bairro, Cidade/UF": a cidade sai (o modelo mostra só até o bairro).
  if (ps.length > 1 && /\/[A-Za-z]{2}$/.test(ps[ps.length - 1])) {
    const ult = ps[ps.length - 1].split(',')
    ult.pop()
    ps[ps.length - 1] = ult.join(',').trim()
  } else if (ps.length === 1 && /\/[A-Za-z]{2}$/.test(ps[0]) && texto(l.linha1)) {
    ps[0] = texto(l.linha1)
  }
  return { nome: texto(l.nome || lojaNome), endereco: partes(ps), telefone: telefone(l.telefone) }
}

function blocosDoTopo(b, loja, quando, tipo) {
  b.push({ t: 'logo', nome: loja.nome })
  if (loja.nome) b.push({ t: 'loja_nome', s: maiusculo(loja.nome) })
  if (loja.endereco.length) b.push({ t: 'loja_endereco', partes: loja.endereco })
  if (loja.telefone) b.push({ t: 'loja_telefone', s: loja.telefone })
  if (quando) b.push({ t: 'data', s: quando })
  if (tipo) b.push({ t: 'tipo', s: tipo })
  b.push({ t: 'tracejado' })
}

/** "@usuario" do link do Instagram (QR). */
function arroba(url) {
  const m = /instagram\.com\/([A-Za-z0-9._]{1,30})\/?$/.exec(texto(url))
  return m ? `@${m[1]}` : ''
}

function blocosDoRodape(b, qrBruto, teste) {
  const qr = qrBruto && Array.isArray(qrBruto.linhas) && qrBruto.linhas.length >= 21 ? qrBruto : null
  const insta = qr && qr.origem === 'instagram' ? arroba(qr.url) : ''
  // Item 59 (beta.10): a legenda pode vir do servidor (QR da rota: "Entregador: leia no app Menuzia").
  const frase = qr && typeof qr.frase === 'string' && qr.frase.trim() ? qr.frase.trim().slice(0, 60)
    : insta ? `Siga a gente no Instagram ${insta}` : qr ? 'Peça de novo pelo nosso cardápio' : ''
  b.push({ t: 'tracejado', antes: 'rodape' })
  b.push({
    t: 'rodape',
    qr: qr ? { linhas: qr.linhas, icone: insta ? 'instagram' : '' } : null,
    frase,
    agradecimento: 'Obrigado pela preferência!',
  })
  b.push({ t: 'tracejado', antes: 'final' })
  b.push({ t: 'final', s: 'feito por Menuzia.com.br' })
  if (teste) {
    b.push({ t: 'aviso', s: 'TESTE DE IMPRESSÃO - SEM VALOR FISCAL' })
    b.push({ t: 'marcas' })
  }
}

/** Nome do item no modelo: "1x Nome Tamanho - Sabor (Borda: X, + Bacon)". */
function textoDoItem(qtd, nome, variacao, extras, mostrarQtd) {
  const base = [texto(nome), variacao].filter(Boolean).join(' ')
  return `${mostrarQtd ? `${qtd}x ` : ''}${base}${extras.length ? ` (${extras.join(', ')})` : ''}`
}

const ROTULO_FORMA = {
  dinheiro: 'DINHEIRO', pix: 'PIX', pix_online: 'PIX ONLINE', cartao: 'CARTÃO', credito: 'CARTÃO DE CRÉDITO',
  debito: 'CARTÃO DE DÉBITO', vale: 'VALE-REFEIÇÃO', fiado: 'FIADO', online: 'ONLINE', transferencia: 'TRANSFERÊNCIA',
}

/** Tipo do topo: ENTREGA, RETIRADA, MESA 04, BALCÃO (- SENHA 12). */
function tipoDoPedido(p) {
  if (p.canal === 'mesa') return !texto(p.mesa) ? 'MESA' : /^mesa( |$)/i.test(texto(p.mesa)) ? maiusculo(p.mesa) : `MESA ${maiusculo(p.mesa)}`
  if (p.tipo === 'entrega') return 'ENTREGA'
  if (p.canal === 'balcao') return p.senha ? `BALCÃO - SENHA ${p.senha}` : 'BALCÃO'
  return 'RETIRADA'
}

/** "Pagamento: PIX ONLINE - PAGO" — PAGO só com o pedido pago de verdade. */
function linhaDoPagamento(p) {
  const online = p.pagamentoOnline === true
  const forma = online ? 'pix_online' : texto(p.formaPagamento)
  if (!forma) return ''
  const rot = ROTULO_FORMA[forma] || maiusculo(forma)
  // Pix online só é "pago" quando o servidor confirmou (pago = true). Pedido ainda
  // aguardando pagamento nunca chega aqui (montarComandaV3 devolve null).
  return `Pagamento: ${rot}${p.pago === true ? ' - PAGO' : ''}`
}

/**
 * COMANDA v3 (ou a via da COZINHA com `o.via = 'cozinha'`).
 * @param {object} pedido item da fila /api/agente/pedidos (mesmo formato do recibo.js)
 * @param {object} o { config, lojaNome, loja, extras, qr, teste, via: 'cliente' | 'cozinha', agora }
 * @returns {object|null} documento; null para pedido aguardando pagamento (não imprime).
 */
function montarComandaV3(pedido, o = {}) {
  const p = pedido || {}
  if (p.status === 'aguardando_pagamento') return null
  const config = o.config || {}
  const extras = o.extras || {}
  const teste = o.teste === true
  const cozinha = o.via === 'cozinha'
  const loja = lojaDoTopo(o.loja, o.lojaNome)
  const b = []

  if (teste) b.push({ t: 'marcas' })
  blocosDoTopo(b, loja, dataHora(p.criadoEm), tipoDoPedido(p))
  if (teste) b.push({ t: 'aviso', s: 'TESTE DE IMPRESSÃO - NÃO PREPARAR' })
  b.push({ t: 'faixa', s: cozinha ? `COZINHA #${p.numero}` : `PEDIDO #${p.numero}` })

  // Itens: adicionais entre parênteses no nome (como no modelo); o valor do item já os inclui.
  b.push({ t: 'faixa', s: 'ITENS' })
  const itens = Array.isArray(p.itens) ? p.itens : []
  const mostrarQtd = config.mostrarNumeroItem !== false
  const mostrarNomes = config.mostrarNomeComplementos !== false || cozinha
  const multiplicar = config.multiplicarOpcoesQtd === true
  itens.forEach((it, idx) => {
    const qtd = Math.max(1, Number(it.quantidade) || 1)
    const v = valoresDoItem(qtd, it.precoUnitario, it.complementos)
    const variacao = [texto(it.tamanhoNome), texto(it.saborNome)].filter(Boolean).join(' - ')
    const ex = []
    if (texto(it.bordaNome)) ex.push(`Borda: ${texto(it.bordaNome)}`)
    if (texto(it.massaNome)) ex.push(`Massa: ${texto(it.massaNome)}`)
    if (mostrarNomes) {
      for (const a of v.adicionais) {
        const vezes = multiplicar ? a.vezes * qtd : a.vezes
        // Espaço que não quebra: "(+ Bacon)" fica inteiro na mesma linha, como no modelo.
        ex.push(`+${NB}${vezes > 1 ? `${vezes}x${NB}` : ''}${texto(a.nome)}`)
      }
    }
    const total = (v.item + v.adicionais.reduce((s, a) => s + a.valor, 0)) / 100 // centavos
    const obs = texto(it.observacao)
    b.push({
      t: 'item',
      texto: textoDoItem(qtd, it.nome, variacao, ex, mostrarQtd),
      valor: cozinha ? '' : numero(total),
      obs: obs ? `OBS: ${obs}` : '',
      primeiro: idx === 0,
    })
  })

  const obsGeral = texto(p.observacao)
  if (obsGeral) {
    b.push({ t: 'faixa', s: 'OBSERVAÇÃO' })
    b.push({ t: 'obs_geral', s: obsGeral })
  }

  if (!cozinha) {
    b.push({ t: 'faixa', s: 'PAGAMENTO' })
    const valores = []
    const par = (rotulo, v, sinal = '') => { if (n2(v) > 0) valores.push({ rotulo, valor: `${sinal}${brl(v)}` }) }
    par('Subtotal', p.subtotal)
    par('Taxa de entrega', p.taxaEntrega)
    const desconto = n2(extras.desconto)
    // Taxas que só aparecem no total (taxa manual da comanda, 0124): a diferença numa linha.
    const outras = n2(n2(p.total) - (n2(p.subtotal) + n2(p.taxaEntrega) - desconto))
    if (outras > 0.009) par('Outras taxas', outras)
    par('Desconto', desconto, '- ')
    valores.forEach((x, i) => b.push({ t: 'par', ...x, primeiro: i === 0 }))
    b.push({ t: 'linha' })
    b.push({ t: 'total', rotulo: 'TOTAL', valor: brl(p.total) })
    // Mesa acerta na conta, no fechamento: forma de pagamento aqui só confundiria.
    if (p.canal !== 'mesa') {
      const pg = linhaDoPagamento(p)
      if (pg) b.push({ t: 'texto', s: pg })
      if (texto(p.formaPagamento) === 'dinheiro' && n2(p.trocoPara) > 0) b.push({ t: 'texto', s: `Troco para: ${brl(p.trocoPara)}` })
    }
  }

  // Dados: cliente (entrega, retirada, balcão) ou mesa.
  const dados = []
  const dado = (rotulo, valor) => { const v = texto(valor); if (v) dados.push({ rotulo, partes: [v] }) }
  let secao = 'CLIENTE'
  if (p.canal === 'mesa') {
    secao = 'MESA'
    dado('Mesa:', texto(p.mesa).replace(/^mesa\s+/i, ''))
    dado('Comanda:', extras.comandaNumero ? String(extras.comandaNumero) : '')
    dado('Atendente:', extras.atendente)
    dado('Cliente:', p.clienteNome)
  } else {
    dado('Cliente:', p.clienteNome)
    dado('Tel.:', telefone(p.clienteTelefone))
    if (p.tipo === 'entrega') {
      const rua = [texto(p.enderecoRua), texto(p.enderecoNumero)].filter(Boolean).join(', ')
      const ps = partes([rua, p.enderecoComplemento, p.enderecoBairro, p.enderecoCidade])
      if (ps.length) dados.push({ rotulo: 'End.:', partes: ps })
      dado('Ref.:', p.enderecoReferencia)
    }
    if (p.canal === 'balcao' && p.senha) dado('Senha:', String(p.senha))
    if (p.canal === 'balcao') dado('Atendente:', extras.atendente)
  }
  if (dados.length) {
    b.push({ t: 'faixa', s: secao })
    dados.forEach((d, i) => b.push({ t: 'dado', ...d, primeiro: i === 0 }))
  }

  if (cozinha) {
    b.push({ t: 'tracejado', antes: 'final' })
    b.push({ t: 'final', s: 'via da cozinha' })
    if (teste) b.push({ t: 'marcas' })
  } else {
    blocosDoRodape(b, o.qr, teste)
  }
  // "Fonte maior na via de produção" (opção da loja): itens um pouco maiores na comanda.
  return { versao: 1, modelo: 'v3', documento: 'comanda', via: cozinha ? 'cozinha' : 'cliente', teste, loja: loja.nome, fonteMaior: config.fonteMaiorProducao === true, blocos: b }
}

/** "Couvert 1x15,00" a partir de "1 x R$ 15,00"; "Taxa (5%)" a partir de "5% do subtotal". */
function rotuloDaTaxa(nome, detalhe) {
  const d = texto(detalhe)
  const pessoa = /^(\d+)\s*x\s*R\$\s*([\d.,]+)$/i.exec(d)
  if (pessoa) return `${nome} ${pessoa[1]}x${pessoa[2]}`
  const pct = /^([\d.,]+)%/.exec(d)
  if (pct) return `${nome} (${pct[1]}%)`
  return d ? `${nome} ${d}` : nome
}

/**
 * PRÉ-CONTA v3 (mesa e balcão), do SNAPSHOT do servidor (impressao_snapshot_pre_conta).
 * Telefone e endereço do CLIENTE nunca saem.
 */
function montarPreContaV3(s, o = {}) {
  const teste = s.recibo_teste === true
  const loja = lojaDoTopo(s.loja_dados, s.loja)
  const b = []
  const balcao = s.tipo === 'balcao'
  const mesa = texto(s.mesa).replace(/^mesa\s+/i, '')
  const tipo = balcao
    ? (s.senha !== undefined && s.senha !== null ? `BALCÃO - SENHA ${s.senha}` : 'BALCÃO')
    : mesa ? `MESA ${maiusculo(mesa)}` : 'MESA'
  const quando = dataHora(s.impresso_em)

  if (teste) b.push({ t: 'marcas' })
  blocosDoTopo(b, loja, Number(s.via) > 1 ? `${quando} - ${s.via}ª via` : quando, tipo)
  if (teste) b.push({ t: 'aviso', s: 'TESTE DE IMPRESSÃO - PEDIDO DE DEMONSTRAÇÃO' })
  b.push({ t: 'faixa', s: 'PRÉ-CONTA' })

  b.push({ t: 'faixa', s: 'ITENS' })
  const itens = Array.isArray(s.itens) ? s.itens : []
  if (itens.length === 0) b.push({ t: 'item', texto: 'Nenhum item cobrado.', valor: '', obs: '', primeiro: true })
  itens.forEach((it, idx) => {
    const qtd = Math.max(1, Number(it.quantidade) || 1)
    const unit = it.preco_unitario !== undefined && it.preco_unitario !== null ? it.preco_unitario : (Number(it.subtotal) || 0) / qtd
    const v = valoresDoItem(qtd, unit, it.complementos)
    const variacao = [texto(it.tamanho), texto(it.sabor)].filter(Boolean).join(' - ')
    const ex = []
    if (texto(it.borda)) ex.push(`Borda: ${texto(it.borda)}`)
    if (texto(it.massa)) ex.push(`Massa: ${texto(it.massa)}`)
    for (const a of v.adicionais) ex.push(`+${NB}${a.vezes > 1 ? `${a.vezes}x${NB}` : ''}${texto(a.nome)}`)
    const total = (v.item + v.adicionais.reduce((t, a) => t + a.valor, 0)) / 100 // centavos
    const obs = texto(it.observacao)
    b.push({ t: 'item', texto: textoDoItem(qtd, it.nome, variacao, ex, true), valor: numero(total), obs: obs ? `OBS: ${obs}` : '', primeiro: idx === 0 })
  })

  b.push({ t: 'faixa', s: 'VALORES' })
  const grupo1 = []
  const par = (lista, rotulo, v, sinal = '') => { if (n2(v) > 0) lista.push({ rotulo, valor: `${sinal}${brl(v)}` }) }
  par(grupo1, 'Subtotal', s.subtotal)
  const pctServico = n2(s.taxa_percentual)
  par(grupo1, pctServico > 0 ? `Serviço (${String(pctServico).replace('.', ',')}%)` : 'Serviço', s.taxa)
  const taxas = Array.isArray(s.taxas) ? s.taxas.filter((t) => n2(t && t.valor) > 0) : []
  if (taxas.length) for (const t of taxas) par(grupo1, rotuloDaTaxa(texto(t.nome) || 'Taxa', t.detalhe), t.valor)
  else par(grupo1, texto(s.taxa_extra_nome) || 'Taxa', s.taxa_extra)
  par(grupo1, 'Taxa de entrega', s.taxa_entrega)
  par(grupo1, 'Desconto', s.desconto, '- ')
  grupo1.forEach((x, i) => b.push({ t: 'par', ...x, primeiro: i === 0 }))
  const pago = n2(s.pago)
  if (pago > 0) {
    b.push({ t: 'linha' })
    b.push({ t: 'par', rotulo: 'Total da conta', valor: brl(s.total), primeiro: true })
    b.push({ t: 'par', rotulo: 'Já pago', valor: `- ${brl(pago)}` })
  }
  b.push({ t: 'linha' })
  b.push({ t: 'total', rotulo: pago > 0 ? 'A PAGAR' : 'TOTAL', valor: brl(pago > 0 ? s.restante : s.total) })
  b.push({ t: 'nota', s: 'Conferência de conta - não é documento fiscal' })

  const dados = []
  const dado = (rotulo, valor) => { const v = texto(valor); if (v) dados.push({ rotulo, partes: [v] }) }
  if (!balcao) dado('Mesa:', mesa)
  else if (s.senha !== undefined && s.senha !== null) dado('Senha:', String(s.senha))
  dado('Comanda:', s.comanda_numero ? String(s.comanda_numero) : '')
  dado('Atendente:', s.atendente)
  dado('Cliente:', s.cliente_nome)
  if (dados.length) {
    b.push({ t: 'faixa', s: balcao ? 'BALCÃO' : 'MESA' })
    dados.forEach((d, i) => b.push({ t: 'dado', ...d, primeiro: i === 0 }))
  }

  blocosDoRodape(b, s.qr || o.qr, teste)
  return { versao: 1, modelo: 'v3', documento: 'pre_conta', via: 'cliente', teste, loja: loja.nome, blocos: b }
}

/** Texto corrido do documento v3 (registro, busca nos testes e impressão de emergência). */
function textoDoV3(doc) {
  const out = []
  for (const k of doc.blocos) {
    switch (k.t) {
      case 'logo': case 'marcas': break
      case 'loja_endereco': out.push(k.partes.join(' - ')); break
      case 'item': out.push(`${k.texto}${k.valor ? `  ${k.valor}` : ''}`); if (k.obs) out.push(`   ${k.obs}`); break
      case 'par': case 'total': out.push(`${k.rotulo}  ${k.valor}`); break
      case 'dado': out.push(`${k.rotulo} ${k.partes.join(' - ')}`); break
      case 'tracejado': out.push('- - - - - - - - - - - - - - - -'); break
      case 'linha': out.push('________________________________'); break
      case 'rodape': if (k.qr) out.push('[QR]'); if (k.frase) out.push(k.frase); if (k.agradecimento) out.push(k.agradecimento); break
      default: if (k.s) out.push(k.s)
    }
  }
  // Espaço que não quebra (só serve ao desenho) vira espaço comum no texto.
  return out.join('\n').replace(/\u00A0/g, ' ')
}

module.exports = { montarComandaV3, montarPreContaV3, textoDoV3, telefone, lojaDoTopo, linhaDoPagamento, rotuloDaTaxa, brl, numero }
