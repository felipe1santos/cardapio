// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT ÚNICO "ALFA 1" (Assistente 1.1.0, 09/10/2026) — comanda e pré-conta.
// Referência oficial: docs/impressao/alfa1/referencia/Impressao-Alfa-1.html (o dono aprovou).
//
// Um só layout para os dois modos de impressão:
//   · IMAGEM: o HTML/CSS da referência (Comfortaa embutida), desenhado numa janela oculta do
//     Electron e capturado em pontos (alfa1-render.js) — fica igual à referência por construção;
//   · TEXTO: o MESMO layout, na mesma ordem, com os comandos da própria impressora (ESC/POS).
// Daqui saem: os DADOS do documento (montarComandaAlfa1 / montarPreContaAlfa1), o HTML
// (htmlAlfa1), os bytes do modo texto (textoAlfa1) e o texto corrido (textoPlanoAlfa1).
// ─────────────────────────────────────────────────────────────────────────────

const { valoresDoItem } = require('./valores-item')

const tx = (v) => (v === undefined || v === null ? '' : String(v).trim())
const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const brl = (v) => `R$ ${n2(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
const num = (v) => n2(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/** Proporção da referência: bobina de 302 px em tela = 576 pontos (80 mm) no papel. */
const LARGURA_REFERENCIA = 302
const ESCALA = 576 / LARGURA_REFERENCIA

function telefone(v) {
  let d = tx(v).replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return tx(v)
}

const SP = { timeZone: 'America/Sao_Paulo' }
function data(iso) {
  const d = iso ? new Date(iso) : null
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR', { ...SP, day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
}
function hora(iso) {
  const d = iso ? new Date(iso) : null
  return d && !isNaN(d.getTime()) ? d.toLocaleTimeString('pt-BR', { ...SP, hour: '2-digit', minute: '2-digit' }) : ''
}
const dataHora = (iso) => [data(iso), hora(iso)].filter(Boolean).join(' - ')

const ROTULO_FORMA = {
  dinheiro: 'Dinheiro', pix: 'Pix', pix_online: 'Pix online', cartao: 'Cartão', credito: 'Cartão de crédito',
  debito: 'Cartão de débito', vale: 'Vale-refeição', fiado: 'Fiado', online: 'Online', transferencia: 'Transferência',
}

function formaDoPedido(p) {
  if (p.pagamentoOnline === true) return 'Pix online'
  const f = tx(p.formaPagamento)
  if (f === 'cartao' && (p.cartaoTipo === 'credito' || p.cartaoTipo === 'debito')) return ROTULO_FORMA[p.cartaoTipo]
  return ROTULO_FORMA[f] || f
}

/** "@usuario" do link do Instagram. */
function arroba(url) {
  const m = /instagram\.com\/([A-Za-z0-9._]{1,30})\/?/.exec(tx(url))
  return m ? `@${m[1]}` : ''
}

const qrValido = (qr) => (qr && Array.isArray(qr.linhas) && qr.linhas.length >= 21 ? qr : null)

/** Itens com complementos (linhas recuadas) e observação. */
function itensDoPedido(lista, { multiplicar = false, mostrarNomes = true } = {}) {
  return (Array.isArray(lista) ? lista : []).map((it) => {
    const q = Math.max(1, Number(it.quantidade) || 1)
    const unit = it.precoUnitario ?? it.preco_unitario ?? (Number(it.subtotal) || 0) / q
    const v = valoresDoItem(q, unit, it.complementos)
    const variacao = [tx(it.tamanhoNome ?? it.tamanho), tx(it.saborNome ?? it.sabor)].filter(Boolean).join(' - ')
    const comp = []
    const borda = tx(it.bordaNome ?? it.borda), massa = tx(it.massaNome ?? it.massa)
    if (borda) comp.push(`Borda: ${borda}`)
    if (massa) comp.push(`Massa: ${massa}`)
    if (mostrarNomes) for (const a of v.adicionais) comp.push(`${multiplicar ? a.vezes * q : a.vezes}x ${tx(a.nome)}`)
    const total = (v.item + v.adicionais.reduce((s, a) => s + a.valor, 0)) / 100
    return { q, nome: [tx(it.nome), variacao].filter(Boolean).join(' '), total, comp, obs: tx(it.observacao) }
  })
}

/**
 * COMANDA (cozinha) — entrega (DELIVERY), retirada, balcão e mesa.
 * @param {object} pedido item da fila /api/agente/pedidos
 * @param {object} o { config, lojaNome, loja, extras, qr, teste, via: 'cliente'|'cozinha' }
 * @returns {any} documento; null para pedido aguardando pagamento.
 */
function montarComandaAlfa1(pedido, o = {}) {
  const p = pedido || {}
  if (p.status === 'aguardando_pagamento') return null
  const config = o.config || {}
  const extras = o.extras || {}
  const entrega = p.tipo === 'entrega'
  const mesa = p.canal === 'mesa'
  const balcao = p.canal === 'balcao' && !entrega
  const nomeMesa = tx(p.mesa).replace(/^mesa\s+/i, '')
  const tipo = entrega ? 'DELIVERY' : mesa ? (nomeMesa ? `MESA ${nomeMesa.toLocaleUpperCase('pt-BR')}` : 'MESA') : balcao ? 'BALCÃO' : 'RETIRADA'
  const cozinha = o.via === 'cozinha'

  const dados = []
  const kv = (rotulo, valor) => { const v = tx(valor); if (v) dados.push({ rotulo, valor: v }) }
  if (mesa) {
    kv('Mesa', nomeMesa)
    kv('Conta', extras.comandaNumero ? String(extras.comandaNumero) : '')
    kv('Atendente', extras.atendente)
    kv('Cliente', p.clienteNome)
  } else {
    kv('Cliente', p.clienteNome)
    if (Number(extras.qtdPedidosCliente) > 0) kv('Qtd de pedidos', String(extras.qtdPedidosCliente))
    kv('Tel', telefone(p.clienteTelefone))
    if (entrega) {
      kv('Endereço', [tx(p.enderecoRua), tx(p.enderecoNumero)].filter(Boolean).join(', '))
      kv('Comp', p.enderecoComplemento)
      kv('Bairro', p.enderecoBairro)
      kv('Ref', p.enderecoReferencia)
      kv('Cidade', tx(p.enderecoCidade).replace(/\/[A-Za-z]{2}$/, ''))
    }
    if (balcao && p.senha) kv('Senha', String(p.senha))
    if (balcao) kv('Atendente', extras.atendente)
  }

  const subtotal = n2(p.subtotal)
  const taxaEntrega = n2(p.taxaEntrega)
  const desconto = n2(extras.desconto)
  const total = n2(p.total)
  const outras = n2(total - (subtotal + taxaEntrega - desconto))
  const dinheiro = tx(p.formaPagamento) === 'dinheiro' && p.pagamentoOnline !== true
  const recebe = dinheiro && n2(p.trocoPara) > total ? n2(p.trocoPara) : 0
  const qr = entrega ? qrValido(o.qr) : null

  return {
    versao: 1, modelo: 'alfa1', documento: 'comanda', via: cozinha ? 'cozinha' : 'cliente', teste: o.teste === true,
    loja: tx(o.loja?.nome || o.lojaNome),
    quando: dataHora(p.criadoEm),
    numero: `#${String(p.numero ?? '').padStart(3, '0')}`,
    tipo,
    entregaPrevista: entrega && p.agendadoPara ? dataHora(p.agendadoPara) : '',
    dados,
    itens: itensDoPedido(p.itens, { multiplicar: config.multiplicarOpcoesQtd === true, mostrarNomes: config.mostrarNomeComplementos !== false || cozinha }),
    observacao: tx(p.observacao),
    subtotal,
    // Mesa acerta na conta; a via da cozinha não leva valores.
    pagamento: mesa || cozinha ? null : {
      titulo: entrega ? 'Pagamento na entrega' : 'Pagamento',
      forma: formaDoPedido(p),
      pago: p.pago === true,
      linhas: [
        ['Valor dos itens', subtotal],
        ...(taxaEntrega > 0 ? [['Taxa de entrega', taxaEntrega]] : []),
        ...(outras > 0.009 ? [['Outras taxas', outras]] : []),
        ...(desconto > 0 ? [['Desconto', -desconto]] : []),
      ],
      total,
      recebe,
      troco: recebe ? n2(recebe - total) : 0,
    },
    qr: qr ? { linhas: qr.linhas, url: tx(qr.url), titulo: 'ROTA DE ENTREGA', legenda: 'Aponte a câmera para abrir a rota' } : null,
  }
}

/** "Couvert 1x15,00" a partir de "1 x R$ 15,00"; "Taxa (5%)" a partir de "5% do subtotal". */
function rotuloDaTaxa(nome, detalhe) {
  const d = tx(detalhe)
  const pessoa = /^(\d+)\s*x\s*R\$\s*([\d.,]+)$/i.exec(d)
  if (pessoa) return `${nome} ${pessoa[1]}x${pessoa[2]}`
  const pct = /^([\d.,]+)%/.exec(d)
  if (pct) return `${nome} (${pct[1]}%)`
  return d ? `${nome} ${d}` : nome
}

/** PRÉ-CONTA ("Conferência de Conta"), do snapshot do servidor (impressao_snapshot_pre_conta). */
/** @returns {any} */
function montarPreContaAlfa1(s, o = {}) {
  const ld = s.loja_dados || {}
  const balcao = s.tipo === 'balcao'
  const mesa = tx(s.mesa).replace(/^mesa\s+/i, '')
  const conta = s.comanda_numero ? String(s.comanda_numero).padStart(4, '0') : ''
  const faixa = [balcao ? (s.senha !== undefined && s.senha !== null ? `Balcão · Senha ${s.senha}` : 'Balcão') : `Mesa ${mesa || '—'}`, conta ? `Conta ${conta}` : ''].filter(Boolean).join(' · ')
  const itens = itensDoPedido(s.itens, { mostrarNomes: true })
  const resumo = []
  const linha = (rotulo, v, forte = false) => { if (n2(v) !== 0) resumo.push({ rotulo, valor: v, forte }) }
  const pctServico = n2(s.taxa_percentual)
  linha('Subtotal', s.subtotal)
  linha(pctServico > 0 ? `Serviço (${String(pctServico).replace('.', ',')}%)` : 'Serviço', s.taxa)
  const taxas = Array.isArray(s.taxas) ? s.taxas.filter((t) => n2(t && t.valor) > 0) : []
  if (taxas.length) for (const t of taxas) linha(rotuloDaTaxa(tx(t.nome) || 'Taxa', t.detalhe), t.valor)
  else linha(tx(s.taxa_extra_nome) || 'Taxa', s.taxa_extra)
  linha('Taxa de entrega', s.taxa_entrega)
  if (n2(s.desconto) > 0) linha('Desconto', -n2(s.desconto))
  linha('Total da conta', s.total, true)
  if (n2(s.pago) > 0) linha('Já pago', -n2(s.pago))
  const aPagar = n2(s.pago) > 0 ? n2(s.restante) : n2(s.total)
  const pessoas = Math.max(0, Math.floor(Number(s.pessoas) || 0))
  const qr = qrValido(s.qr || o.qr)
  const insta = qr && qr.origem === 'instagram' ? arroba(qr.url) : ''
  return {
    versao: 1, modelo: 'alfa1', documento: 'pre_conta', teste: s.recibo_teste === true,
    loja: tx(ld.nome || s.loja),
    cnpj: tx(ld.cnpj),
    quando: data(s.impresso_em) + (Number(s.via) > 1 ? ` - ${s.via}ª via` : ''),
    hora: hora(s.impresso_em),
    faixa,
    itens,
    somaItens: n2(itens.reduce((t, i) => t + i.total, 0)),
    resumo,
    aPagar,
    pessoas: pessoas > 1 ? `${pessoas} pessoas · ${brl(aPagar / pessoas)} por pessoa` : '',
    atendente: tx(s.atendente),
    servicoOpcional: n2(s.taxa) > 0 ? `Serviço de ${pctServico > 0 ? String(pctServico).replace('.', ',') : '10'}% opcional` : '',
    instagram: insta && qr ? { arroba: insta, linhas: qr.linhas, url: tx(qr.url) } : null,
  }
}

// ── HTML (modo IMAGEM) ───────────────────────────────────────────────────────

const esc = (s) => tx(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** CSS da bobina — o da referência, com tinta preta pura (a térmica não tem cinza). */
const CSS_ALFA1 = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff}
.papel{background:#fff;color:#000;font-family:'Comfortaa',sans-serif;font-size:14px;font-weight:600;line-height:1.45;padding:18px 12px 26px;-webkit-font-smoothing:antialiased}
.c{text-align:center}
.loja{font-size:17px;font-weight:700}
.reg{font-weight:500}
.tr{border-top:1px dashed #000;margin:8px 0}
.sol{border-top:1.5px solid #000;margin:8px 0}
.tit{text-align:center;font-weight:700;font-size:15px;margin:6px 0 4px}
.kv b{font-weight:700}.kv span{font-weight:500}
.lin{display:flex;justify-content:space-between;gap:8px;font-variant-numeric:tabular-nums}
.lin>span:first-child{min-width:0}
.cabi{display:flex;justify-content:space-between;font-weight:700;letter-spacing:.03em}
.item{display:flex;justify-content:space-between;gap:8px;font-weight:600}
.item>span:first-child{min-width:0;overflow-wrap:anywhere}
.item>span:last-child{flex:none}
.comp{padding-left:16px;font-weight:500;overflow-wrap:anywhere}
.obs{background:#fff;color:#000;border:1.5px solid #000;font-size:14px;font-weight:700;padding:2px 6px;margin:3px 0;border-radius:4px;overflow-wrap:anywhere}
.faixa{background:#000;color:#fff;text-align:center;font-weight:700;font-size:15px;padding:3px 6px;margin:6px 0 6px;border-radius:3px}
.topo{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px}
.num{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}
.badge{color:#000;font-weight:700;font-size:17px;letter-spacing:.04em;text-align:right}
.mesa-faixa{display:flex;justify-content:space-between;gap:8px;background:#000;color:#fff;font-weight:700;padding:3px 8px;border-radius:3px;font-variant-numeric:tabular-nums}
.pc-rod{display:flex;justify-content:space-between;align-items:center;gap:12px}
.pc-rod .txt{min-width:0;display:grid;gap:2px}
.tot{display:flex;justify-content:space-between;gap:8px;font-weight:700;font-size:15.5px}
.grande{font-size:17px}
.qr{display:block;margin:6px auto 4px}
.pc-rod .qr{margin:0;flex:none}
.pq{font-size:12px;font-weight:500}
.aviso{text-align:center;font-weight:700;border:1.5px solid #000;padding:2px 4px;margin:6px 0}
.kv{overflow-wrap:anywhere}
.tot>span:last-child,.lin>span:last-child,.lin>b:last-child,.item>span:last-child,.total-g>span:last-child,.badge,.num{white-space:nowrap}
.tot>span:first-child,.lin>b:first-child,.total-g>span:first-child{min-width:0}
.pc-tit{text-align:center;font-weight:700;font-size:16px;margin-bottom:10px}
.pc-loja{font-weight:500;line-height:1.4;overflow-wrap:anywhere}
.pc-loja b{font-weight:700}
.tab{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.tab th{font-weight:700;text-align:left;border-bottom:1px solid #000;padding:0 0 2px}
.tab td{font-weight:500;padding:1px 0;vertical-align:top;overflow-wrap:anywhere}
.tab .q{width:30px;text-align:right;padding-right:8px}
.tab .v{width:76px;text-align:right}
.tab .sub td{font-size:13px}
.total-g{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-weight:700;font-size:22px;border-top:1px solid #000;border-bottom:1px solid #000;padding:3px 0;margin:6px 0;font-variant-numeric:tabular-nums}
.res td{font-weight:500}
.res .forte td{font-weight:700}
`

/**
 * QR em SVG com o módulo em PONTOS INTEIROS do papel (nítido): `ladoCss` é o tamanho desejado em
 * px da referência; o módulo vira floor(ladoCss·escala / n) pontos.
 */
function svgQr(linhas, ladoCss, escala) {
  const n = linhas.length
  const mod = Math.max(2, Math.floor((ladoCss * escala) / n))
  const lado = (n * mod) / escala
  let r = ''
  linhas.forEach((row, y) => { for (let x = 0; x < n; x++) if (row[x] === '1') r += `M${x} ${y}h1v1h-1z` })
  return `<svg class="qr" width="${lado.toFixed(3)}" height="${lado.toFixed(3)}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path d="${r}" fill="#000"/></svg>`
}

function htmlComanda(d, escala) {
  const ent = d.tipo === 'DELIVERY'
  const kv = (r, v) => `<div class="kv"><b>${esc(r)}:</b> <span>${esc(v)}</span></div>`
  const itens = `<div class="cabi"><span>QTD&nbsp;&nbsp;ITENS</span><span>${d.pagamento ? 'TOTAL' : ''}</span></div>` + d.itens.map((i) =>
    `<div class="item"><span>${i.q}x ${esc(i.nome)}</span><span>${d.pagamento ? brl(i.total) : ''}</span></div>` +
    i.comp.map((c) => `<div class="comp">${esc(c)}</div>`).join('') +
    (i.obs ? `<div class="obs">Obs: ${esc(i.obs)}</div>` : '')).join('')
  let h = `<div class="c"><div class="loja">${esc(d.loja)}</div><div class="reg">${esc(d.quando)}</div></div>`
  if (d.teste) h += '<div class="aviso">TESTE DE IMPRESSÃO - NÃO PREPARAR</div>'
  h += `<div class="topo"><span class="num">${esc(d.numero)}</span><span class="badge">${esc(d.tipo)}</span></div><div class="sol"></div>`
  if (d.entregaPrevista) h += `${kv('Entrega prevista', d.entregaPrevista)}<div class="tr"></div>`
  h += d.dados.map((x) => kv(x.rotulo, x.valor)).join('')
  if (d.dados.length) h += '<div class="tr"></div>'
  h += `<div class="faixa">Itens do pedido</div>${itens}`
  if (d.observacao) h += `<div class="obs">Obs. do pedido: ${esc(d.observacao)}</div>`
  if (d.pagamento) {
    const pg = d.pagamento
    h += `<div class="tr"></div><div class="tot"><span>SUBTOTAL</span><span>${brl(d.subtotal)}</span></div><div class="tr"></div>`
    h += `<div class="faixa">${esc(pg.titulo)}</div>`
    if (pg.forma) h += kv('Forma de pgto', pg.forma + (pg.pago ? ' - PAGO' : ''))
    h += pg.linhas.map(([r, v]) => `<div class="lin"><span>${esc(r)}</span><span>${v < 0 ? `- ${brl(-v)}` : brl(v)}</span></div>`).join('')
    h += '<div class="sol"></div>'
    h += pg.pago
      ? `<div class="tot grande"><span>PAGO</span><span>${brl(pg.total)}</span></div>`
      : `<div class="tot grande"><span>COBRAR DO CLIENTE</span><span>${brl(pg.total)}</span></div>`
    if (pg.recebe && !pg.pago) {
      h += `<div class="tr"></div><div class="lin"><b>RECEBER DO CLIENTE</b><b>${brl(pg.recebe)}</b></div><div class="lin"><b>TROCO</b><b>${brl(pg.troco)}</b></div>`
    }
  }
  if (d.qr && ent) h += `<div class="tr"></div><div class="c"><div class="tit">${esc(d.qr.titulo)}</div>${svgQr(d.qr.linhas, 116, escala)}<div class="pq">${esc(d.qr.legenda)}</div></div>`
  h += `<div class="tr"></div><div class="c pq">${d.via === 'cozinha' ? 'via da cozinha · ' : ''}feito por Menuzia.com.br</div>`
  return h
}

function htmlPreConta(d, escala) {
  const linhas = d.itens.map((i) => `<tr><td class="q">${i.q}</td><td>${esc(i.nome)}</td><td class="v">${num(i.total)}</td></tr>` +
    i.comp.map((c) => `<tr class="sub"><td></td><td>+ ${esc(c.replace(/^1x /, ''))}</td><td></td></tr>`).join('') +
    (i.obs ? `<tr class="sub"><td></td><td>Obs: ${esc(i.obs)}</td><td></td></tr>` : '')).join('')
  const res = d.resumo.map((r) => `<tr${r.forte ? ' class="forte"' : ''}><td>${esc(r.rotulo)}</td><td class="v">${r.valor < 0 ? `- ${num(-r.valor)}` : num(r.valor)}</td></tr>`).join('')
  let h = '<div class="pc-tit">Conferência de Conta</div>'
  if (d.teste) h += '<div class="aviso">TESTE DE IMPRESSÃO</div>'
  h += `<div class="pc-loja"><b>${esc(d.loja)}</b>${d.cnpj ? `<br>CNPJ ${esc(d.cnpj)}` : ''}<br>Não é documento fiscal<br>${esc(d.quando)}</div>`
  h += `<div class="tr"></div><div class="mesa-faixa"><span>${esc(d.faixa)}</span><span>${esc(d.hora)}</span></div><div style="height:6px"></div>`
  h += `<table class="tab"><thead><tr><th class="q">Qt</th><th>Item</th><th class="v">Total</th></tr></thead><tbody>${linhas || '<tr><td></td><td>Nenhum item cobrado.</td><td></td></tr>'}</tbody></table>`
  h += `<div class="total-g"><span>Total</span><span>${num(d.somaItens)}</span></div>`
  h += `<table class="tab res">${res}</table>`
  h += `<div class="total-g"><span>A pagar</span><span>${brl(d.aPagar)}</span></div>`
  if (d.pessoas) h += `<div class="c reg" style="margin-top:8px">${esc(d.pessoas)}</div>`
  if (d.atendente) h += `<div class="c reg">Atendente: ${esc(d.atendente)}</div>`
  if (d.servicoOpcional) h += `<div class="c reg">${esc(d.servicoOpcional)}</div>`
  h += '<div class="tr"></div>'
  if (d.instagram) h += `<div class="pc-rod"><div class="txt"><b>Siga a gente no Instagram</b><span class="reg">${esc(d.instagram.arroba)}</span></div>${svgQr(d.instagram.linhas, 84, escala)}</div>`
  h += `<div class="c" style="margin-top:10px">Obrigado pela preferência!</div><div class="c pq">feito por Menuzia.com.br</div>`
  return h
}

/**
 * Página completa para o desenho. A largura do papel em px da referência é larguraPontos/ESCALA
 * (576 → 302); quem desenha aplica o zoom ESCALA, então 1 px da página vira 1 ponto do papel.
 * `fonteUrl`: endereço do Comfortaa (arquivo do próprio Assistente).
 */
function htmlAlfa1(doc, { larguraPontos = 576, fonteUrl = '' } = {}) {
  const largCss = larguraPontos / ESCALA
  const corpo = doc.documento === 'pre_conta' ? htmlPreConta(doc, ESCALA) : htmlComanda(doc, ESCALA)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Comfortaa';src:url('${fonteUrl}') format('truetype');font-weight:300 700;font-display:block}
${CSS_ALFA1}
.papel{width:${largCss.toFixed(4)}px}
</style></head><body><div class="papel" id="papel">${corpo}</div></body></html>`
}

// ── TEXTO (modo TEXTO: o mesmo layout com os comandos da impressora) ─────────

const ESC = 0x1b, GS = 0x1d
// WPC1252 (ESC t 16) para os acentos; caracteres de borda: '+', '-', '|'.
const PAGINA = [ESC, 0x74, 16]
const MAPA_1252 = { '€': 0x80, '‚': 0x82, '…': 0x85, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '·': 0xb7 }
function codificar(s) {
  const out = []
  for (const ch of String(s).replace(/ /g, ' ')) {
    const c = ch.codePointAt(0)
    if (c < 0x80) out.push(c)
    else if (MAPA_1252[ch] !== undefined) out.push(MAPA_1252[ch])
    else if (c >= 0xa0 && c <= 0xff) out.push(c)
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
      out.push(base && base.codePointAt(0) < 0x80 ? base.codePointAt(0) : 0x3f)
    }
  }
  return out
}

function quebrar(s, n) {
  const linhas = []
  for (const par of tx(s).split('\n')) {
    let atual = ''
    for (const p of par.split(/\s+/).filter(Boolean)) {
      let w = p
      while (w.length > n) { if (atual) { linhas.push(atual); atual = '' } linhas.push(w.slice(0, n)); w = w.slice(n) }
      if (!atual) atual = w
      else if (atual.length + 1 + w.length <= n) atual += ` ${w}`
      else { linhas.push(atual); atual = w }
    }
    if (atual) linhas.push(atual)
  }
  return linhas.length ? linhas : ['']
}

/** Nome à esquerda (quebra) e valor à direita, na largura n. */
function duasColunas(esq, dir, n) {
  const d = tx(dir)
  const ls = quebrar(esq, Math.max(4, n - (d ? d.length + 1 : 0)))
  const ult = ls.length - 1
  return ls.map((l, i) => (i === ult && d ? l + ' '.repeat(Math.max(1, n - l.length - d.length)) + d : l))
}

/** QR nativo (GS ( k, modelo 2) a partir do texto; sem texto, nada. */
function qrNativo(conteudo, modulo = 6) {
  const dados = Buffer.from(String(conteudo), 'utf8')
  const len = dados.length + 3
  return [
    GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00, // modelo 2
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, modulo, // tamanho do módulo
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31, // correção M
    GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...dados,
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, // imprime
  ]
}

/**
 * Bytes ESC/POS do MESMO layout (modo Texto). `colunas`: 48 (80 mm) ou 32 (58 mm).
 */
function textoAlfa1(d, { colunas = 48, intensidade = null, cortar = true } = {}) {
  const n = colunas
  const b = [ESC, 0x40, 0x1c, 0x2e, ...PAGINA]
  if (intensidade === 'escura' || intensidade === 'mais_escura') b.push(GS, 0x28, 0x4b, 0x02, 0x00, 0x31, intensidade === 'escura' ? 3 : 6)
  const alinhar = (a) => b.push(ESC, 0x61, a === 'c' ? 1 : a === 'd' ? 2 : 0)
  const neg = (v) => b.push(ESC, 0x45, v ? 1 : 0)
  const tam = (v) => b.push(GS, 0x21, v)
  const inv = (v) => b.push(GS, 0x42, v ? 1 : 0)
  const ln = (s = '') => b.push(...codificar(s), 0x0a)
  const tr = () => ln('-'.repeat(n))
  const sol = () => ln('='.repeat(n))
  const faixa = (s) => { alinhar('c'); neg(true); inv(true); const t = ` ${s} `; const pad = Math.max(0, n - t.length); ln(' '.repeat(Math.floor(pad / 2)) + t + ' '.repeat(Math.ceil(pad / 2))); inv(false); neg(false); alinhar('e') }
  const kv = (r, v) => { const ls = quebrar(`${r}: ${v}`, n); neg(true); b.push(...codificar(`${r}:`)); neg(false); b.push(...codificar(ls[0].slice(r.length + 1)), 0x0a); ls.slice(1).forEach((l) => ln(l)) }
  const par = (e, dd, forte = false) => { neg(forte); duasColunas(e, dd, n).forEach((l) => ln(l)); neg(false) }
  const caixa = (s) => { // observação com borda simulada
    const ls = quebrar(s, n - 4)
    neg(true); ln(`+${'-'.repeat(n - 2)}+`); ls.forEach((l) => ln(`| ${l}${' '.repeat(Math.max(0, n - 4 - l.length))} |`)); ln(`+${'-'.repeat(n - 2)}+`); neg(false)
  }
  const grande = (e, dd) => { neg(true); tam(0x11); duasColunas(e, dd, Math.floor(n / 2)).forEach((l) => ln(l)); tam(0); neg(false) }
  // QR nativo da impressora (GS ( k) com o link; o link curto vai embaixo para quem não tem QR nativo.
  const qr = (url) => {
    if (!url) return
    alinhar('c'); b.push(...qrNativo(url, n <= 32 ? 4 : 6)); ln(); quebrar(url.replace(/^https?:\/\//, ''), n).forEach((l) => ln(l)); alinhar('e')
  }

  if (d.documento === 'pre_conta') {
    alinhar('c'); neg(true); ln('Conferência de Conta'); neg(false); alinhar('e')
    if (d.teste) { alinhar('c'); neg(true); ln('TESTE DE IMPRESSÃO'); neg(false); alinhar('e') }
    neg(true); quebrar(d.loja, n).forEach((l) => ln(l)); neg(false)
    if (d.cnpj) ln(`CNPJ ${d.cnpj}`)
    ln('Não é documento fiscal'); quebrar(d.quando, n).forEach((l) => ln(l)); tr()
    neg(true); inv(true); duasColunas(` ${d.faixa}`, `${d.hora} `, n).forEach((l) => ln(l)); inv(false); neg(false)
    const wq = 3, wv = 9, wi = n - wq - wv - 2
    neg(true); ln(`${'Qt'.padStart(wq)} ${'Item'.padEnd(wi)} ${'Total'.padStart(wv)}`); neg(false); ln('-'.repeat(n))
    for (const i of d.itens) {
      quebrar(i.nome, wi).forEach((l, k) => ln(`${(k === 0 ? String(i.q) : '').padStart(wq)} ${l.padEnd(wi)} ${(k === 0 ? num(i.total) : '').padStart(wv)}`))
      i.comp.forEach((c) => quebrar(`+ ${c.replace(/^1x /, '')}`, wi).forEach((l) => ln(`${''.padStart(wq)} ${l}`)))
      if (i.obs) quebrar(`Obs: ${i.obs}`, wi).forEach((l) => ln(`${''.padStart(wq)} ${l}`))
    }
    tr(); grande('Total', num(d.somaItens)); tr()
    for (const r of d.resumo) par(r.rotulo, r.valor < 0 ? `- ${num(-r.valor)}` : num(r.valor), r.forte)
    sol(); grande('A pagar', brl(d.aPagar)); sol()
    alinhar('c')
    if (d.pessoas) quebrar(d.pessoas, n).forEach((l) => ln(l))
    if (d.atendente) quebrar(`Atendente: ${d.atendente}`, n).forEach((l) => ln(l))
    if (d.servicoOpcional) ln(d.servicoOpcional)
    alinhar('e'); tr()
    if (d.instagram) { neg(true); ln('Siga a gente no Instagram'); neg(false); ln(d.instagram.arroba); qr(d.instagram.url) }
    alinhar('c'); quebrar('Obrigado pela preferência!', n).forEach((l) => ln(l)); ln('feito por Menuzia.com.br'); alinhar('e')
  } else {
    alinhar('c'); neg(true); quebrar(d.loja, n).forEach((l) => ln(l)); neg(false); quebrar(d.quando, n).forEach((l) => ln(l)); alinhar('e')
    if (d.teste) { alinhar('c'); neg(true); ln('TESTE DE IMPRESSÃO - NÃO PREPARAR'); neg(false); alinhar('e') }
    // "#010" em letra dupla à esquerda e o tipo em negrito à direita (na metade das colunas).
    neg(true); tam(0x11); duasColunas(d.numero, d.tipo, Math.floor(n / 2)).forEach((l) => ln(l)); tam(0); neg(false)
    sol()
    if (d.entregaPrevista) { kv('Entrega prevista', d.entregaPrevista); tr() }
    d.dados.forEach((x) => kv(x.rotulo, x.valor))
    if (d.dados.length) tr()
    faixa('Itens do pedido')
    neg(true); par('QTD  ITENS', d.pagamento ? 'TOTAL' : ''); neg(false)
    for (const i of d.itens) {
      neg(true); duasColunas(`${i.q}x ${i.nome}`, d.pagamento ? brl(i.total) : '', n).forEach((l) => ln(l)); neg(false)
      i.comp.forEach((c) => quebrar(c, n - 3).forEach((l) => ln(`   ${l}`)))
      if (i.obs) caixa(`Obs: ${i.obs}`)
    }
    if (d.observacao) caixa(`Obs. do pedido: ${d.observacao}`)
    if (d.pagamento) {
      const pg = d.pagamento
      tr(); par('SUBTOTAL', brl(d.subtotal), true); tr()
      faixa(pg.titulo)
      if (pg.forma) kv('Forma de pgto', pg.forma + (pg.pago ? ' - PAGO' : ''))
      pg.linhas.forEach(([r, v]) => par(r, v < 0 ? `- ${brl(-v)}` : brl(v)))
      sol()
      grande(pg.pago ? 'PAGO' : 'COBRAR', brl(pg.total))
      if (pg.recebe && !pg.pago) { tr(); par('RECEBER DO CLIENTE', brl(pg.recebe), true); par('TROCO', brl(pg.troco), true) }
    }
    if (d.qr) { tr(); alinhar('c'); neg(true); ln(d.qr.titulo); neg(false); alinhar('e'); qr(d.qr.url); alinhar('c'); quebrar(d.qr.legenda, n).forEach((l) => ln(l)); alinhar('e') }
    tr(); alinhar('c'); quebrar(`${d.via === 'cozinha' ? 'via da cozinha - ' : ''}feito por Menuzia.com.br`, n).forEach((l) => ln(l)); alinhar('e')
  }
  b.push(ESC, 0x64, 5)
  if (cortar) b.push(GS, 0x56, 0x01)
  return Buffer.from(b)
}

/** Texto corrido (registro, emergência e testes): os bytes do modo texto sem os comandos. */
function textoPlanoAlfa1(d, colunas = 48) {
  return decodificarTexto(textoAlfa1(d, { colunas, cortar: false }))
}

/** Bytes ESC/POS → texto legível (tira comandos; para a simulação e os testes). */
function decodificarTexto(buf) {
  const out = []
  let i = 0
  const tabela1252 = { 0x80: '€', 0x82: '‚', 0x85: '…', 0x96: '–', 0x97: '—', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•' }
  while (i < buf.length) {
    const c = buf[i]
    if (c === ESC) { const k = buf[i + 1]; i += k === 0x40 ? 2 : k === 0x64 || k === 0x61 || k === 0x45 || k === 0x74 ? 3 : 2; continue }
    if (c === 0x1c) { i += 2; continue }
    if (c === GS) {
      const k = buf[i + 1]
      if (k === 0x28) { const len = buf[i + 3] | (buf[i + 4] << 8); if (buf[i + 2] === 0x6b && buf[i + 6] === 0x51) out.push('[QR]'); i += 5 + len; continue }
      i += k === 0x56 ? 3 : 3; continue
    }
    out.push(c === 0x0a ? '\n' : tabela1252[c] || String.fromCharCode(c))
    i++
  }
  return out.join('')
}

module.exports = {
  montarComandaAlfa1, montarPreContaAlfa1, htmlAlfa1, textoAlfa1, textoPlanoAlfa1, decodificarTexto,
  ESCALA, LARGURA_REFERENCIA, CSS_ALFA1, quebrar, duasColunas, telefone, arroba, brl,
}

// ── Largura e envio (puros, testados) ────────────────────────────────────────

/** Linhas por faixa do envio da imagem e pausa entre faixas (impressora fraca não trava no meio). */
const FAIXA_LINHAS = 64
const FAIXA_PAUSA_MS = 40

/**
 * Largura do desenho em pontos: a REAL do driver (ex.: 574), arredondada para baixo em múltiplo de 8
 * (o comando de imagem manda bytes inteiros). Sem diagnóstico: a do servidor ou 576/384 pelo papel.
 * @param {{ larguraMm?: number, larguraPontos?: number | null, pontosImprimiveis?: number | null }} [o]
 */
function larguraDoPapel({ larguraMm = 80, larguraPontos = null, pontosImprimiveis = null } = {}) {
  const base = Number.isInteger(larguraPontos) && larguraPontos > 0 ? larguraPontos : Number(larguraMm) <= 58 ? 384 : 576
  const real = Number(pontosImprimiveis)
  const w = Number.isFinite(real) && real >= base * 0.75 && real < base ? real : base
  return Math.floor(w / 8) * 8
}

/** Colunas do modo texto pela largura: 32 (58 mm) ou 48 (80 mm). */
const colunasDoPapel = (larguraPontos) => (larguraPontos <= 420 ? 32 : 48)

/**
 * Por onde mandar: 'driver' no banco (ajuste do suporte) FORÇA o Windows; qualquer outro valor é envio
 * DIRETO — rede se tiver IP, senão a fila do Windows em RAW — com o Windows só de RESERVA se o direto der erro.
 * Impressora virtual (PDF, XPS…) sempre pelo Windows (bytes ESC/POS lá viram lixo).
 * @param {{ envio?: string | null, redeIp?: string | null, virtual?: boolean }} [o]
 */
function caminhoDoEnvio({ envio, redeIp, virtual = false } = {}) {
  if (envio === 'driver' || virtual) return { via: 'driver', reserva: false }
  if (envio === 'raw_rede' || (envio !== 'raw_fila' && redeIp)) return redeIp ? { via: 'raw_rede', reserva: true } : { via: 'raw_fila', reserva: true }
  return { via: 'raw_fila', reserva: true }
}

module.exports.FAIXA_LINHAS = FAIXA_LINHAS
module.exports.FAIXA_PAUSA_MS = FAIXA_PAUSA_MS
module.exports.larguraDoPapel = larguraDoPapel
module.exports.colunasDoPapel = colunasDoPapel
module.exports.caminhoDoEnvio = caminhoDoEnvio
