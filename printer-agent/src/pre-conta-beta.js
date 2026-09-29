// ─────────────────────────────────────────────────────────────────────────────
// PRÉ-CONTA (Recibo/Extrato) do ASSISTENTE BETA — modelo
// docs/referencias/impressao/v3/PRE-CONTA.png (2026-09-28): logo da loja, "PRE-CONTA",
// mesa, cliente, data e hora; faixa ITENS CONSUMIDOS com QTD estreita, DESCRICAO larga e
// TOTAL (R$) só com o número — cada adicional com o seu valor, a coluna soma o Subtotal;
// faixa VALORES (com R$), "A PAGAR" em destaque, o QR e, no rodapé, nome, telefone e
// endereço da loja.
//
// Só o Beta usa este arquivo. O Recibo/Extrato do Assistente atual (pre-conta.js +
// print.ps1) e a ficha da cozinha antiga (recibo.js) não mudam.
//
// Monta BLOCOS (JSON); quem desenha é o ticket-canvas.js — o mesmo da pré-visualização do
// painel. Tudo vem do SNAPSHOT do servidor; o agente não calcula valor além de repartir a
// linha do item entre ele e os adicionais. Telefone e endereço do CLIENTE nunca saem.
// ─────────────────────────────────────────────────────────────────────────────

const { brl } = require('./pre-conta')
const { dadosDaLoja } = require('./cozinha-beta')
const { valoresDoItem, numero } = require('./valores-item')

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

/** "@usuario" do link do Instagram (QR). */
function arroba(url) {
  const m = /instagram\.com\/([A-Za-z0-9._]{1,30})\/?$/.exec(texto(url))
  return m ? `@${m[1]}` : ''
}

/**
 * Documento da pré-conta do Beta.
 * @param {object} s snapshot (conta real ou recibo_teste); s.qr e s.loja_dados opcionais (servidor)
 * @returns {{ versao: 4, modelo: 'pre_conta', teste: boolean, loja: string, blocos: object[] }}
 */
function montarPreContaBeta(s) {
  const teste = s.recibo_teste === true
  const loja = dadosDaLoja(s.loja_dados, s.loja)
  const b = []

  if (teste) b.push({ t: 'marcas' })
  b.push({ t: 'logo', nome: loja.nome })
  b.push({ t: 'titulo', s: 'PRE-CONTA' })

  // Topo: só mesa (ou balcão/senha), cliente e data/hora.
  const linhas = []
  if (s.tipo === 'balcao') linhas.push(s.senha !== undefined && s.senha !== null ? `Balcao - Senha ${s.senha}` : 'Balcao')
  // Mesa cadastrada como "Mesa 01" já traz a palavra; "01" ganha o prefixo.
  else if (texto(s.mesa)) linhas.push(/^mesa( |$)/i.test(texto(s.mesa)) ? texto(s.mesa) : `Mesa ${texto(s.mesa)}`)
  if (texto(s.cliente_nome)) linhas.push(`Cliente: ${texto(s.cliente_nome).split(/\s+/)[0]}`)
  const quando = dataHora(s.impresso_em)
  if (quando) linhas.push(Number(s.via) > 1 ? `${quando} - ${s.via}a via` : quando)
  linhas.forEach((l, i) => b.push({ t: 'linha', s: l, primeiro: i === 0 }))
  if (teste) b.push({ t: 'aviso', s: 'TESTE DE IMPRESSAO - PEDIDO DE DEMONSTRACAO' })

  // Itens: QTD, DESCRICAO e TOTAL (R$) só com o número.
  b.push({ t: 'faixa', s: 'ITENS CONSUMIDOS', primeiro: true })
  b.push({ t: 'tabela_cab', qtd: 'QTD', desc: 'DESCRICAO', total: 'TOTAL (R$)' })
  b.push({ t: 'tracejado', depois: 'tabela' })
  const itens = Array.isArray(s.itens) ? s.itens : []
  if (itens.length === 0) b.push({ t: 'tabela_item', qtd: '', desc: 'Nenhum item cobrado.', total: '', subs: [], primeiro: true })
  itens.forEach((it, idx) => {
    const qtd = Math.max(1, Number(it.quantidade) || 1)
    // Linha do item = (unitário − adicionais) × qtd; cada adicional com o seu valor × qtd.
    const unit = it.preco_unitario !== undefined && it.preco_unitario !== null ? it.preco_unitario : (Number(it.subtotal) || 0) / qtd
    const v = valoresDoItem(qtd, unit, it.complementos)
    const variacao = [texto(it.tamanho), texto(it.sabor)].filter(Boolean).join(' - ')
    const subs = []
    if (variacao) subs.push({ s: variacao })
    if (texto(it.borda)) subs.push({ s: `+ Borda: ${texto(it.borda)}` })
    if (texto(it.massa)) subs.push({ s: `+ Massa: ${texto(it.massa)}` })
    let valorItem = v.item
    for (const a of v.adicionais) {
      if (!(a.valor > 0)) valorItem += a.valor
      subs.push({ s: `+ ${a.vezes > 1 ? `${a.vezes}x ` : ''}${texto(a.nome)}`, valor: a.valor > 0 ? numero(a.valor) : '' })
    }
    if (texto(it.observacao)) subs.push({ s: `Obs.: ${texto(it.observacao)}` })
    b.push({ t: 'tabela_item', qtd: String(qtd), desc: maiusculo(it.nome), total: numero(valorItem), subs, primeiro: idx === 0 })
  })

  // Valores (com R$).
  b.push({ t: 'faixa', s: 'VALORES' })
  const valores = [{ rotulo: 'Subtotal', valor: brl(s.subtotal) }]
  if (Number(s.taxa) > 0 || Number(s.taxa_percentual) > 0) valores.push({ rotulo: 'Taxa de serviço', valor: brl(s.taxa) })
  if (Number(s.taxa_extra) > 0) valores.push({ rotulo: texto(s.taxa_extra_nome) || 'Taxa', valor: brl(s.taxa_extra) })
  if (Number(s.taxa_entrega) > 0) valores.push({ rotulo: 'Taxa de entrega', valor: brl(s.taxa_entrega) })
  if (Number(s.desconto) > 0) valores.push({ rotulo: 'Desconto', valor: `- ${brl(s.desconto)}` })
  const pago = Number(s.pago) || 0
  if (pago > 0) {
    valores.push({ rotulo: 'Total da conta', valor: brl(s.total) })
    valores.push({ rotulo: 'Já pago', valor: `- ${brl(pago)}` })
  }
  valores.forEach((v, i) => b.push({ t: 'par', ...v, primeiro: i === 0 }))
  b.push({ t: 'tracejado', depois: 'valores' })
  b.push({ t: 'total', rotulo: pago > 0 ? 'A PAGAR' : 'TOTAL', valor: brl(pago > 0 ? s.restante : s.total) })
  b.push({ t: 'tracejado', depois: 'total' })

  // Rodapé: frase do QR (Instagram ou cardápio) com o QR ao lado; depois, a loja.
  const qrOk = s.qr && Array.isArray(s.qr.linhas) && s.qr.linhas.length >= 21
  const qr = qrOk ? { linhas: s.qr.linhas, icone: s.qr.origem === 'instagram' ? 'instagram' : '' } : null
  const frase = qrOk && s.qr.origem === 'instagram' && arroba(s.qr.url)
    ? [{ s: 'Siga a gente no Instagram' }, { s: arroba(s.qr.url) }]
    : qrOk ? [{ s: 'Peça de novo pelo nosso cardápio' }] : []
  b.push({ t: 'rodape_qr', linhas: [...frase, ...(frase.length ? [{ s: '' }] : []), { s: 'Sistema Menuzia' }], qr })
  b.push({ t: 'tracejado', depois: 'qr' })
  b.push({ t: 'loja', nome: loja.nome, telefone: loja.telefone, endereco: loja.endereco })
  b.push({ t: 'tracejado', depois: 'loja' })
  if (teste) {
    b.push({ t: 'aviso_rodape', s: 'TESTE DE IMPRESSAO - SEM VALOR FISCAL' })
    b.push({ t: 'marcas' })
  }

  return { versao: 4, modelo: 'pre_conta', teste, loja: loja.nome, blocos: b }
}

/** Texto corrido do documento (registro, busca em teste e impressão de emergência). */
function textoDoDocumento(doc) {
  const out = []
  for (const k of doc.blocos) {
    switch (k.t) {
      case 'logo': if (k.nome) out.push(k.nome); break
      case 'titulo': case 'horas': case 'aviso': case 'aviso_rodape': case 'faixa': case 'linha': case 'obs_pedido': out.push(k.s); break
      case 'pedido': out.push([k.numero, k.tipo].filter(Boolean).join(' | ')); break
      case 'itens_cab': out.push(`${k.esq}  ${k.dir}`); break
      case 'item':
        out.push(`${k.texto}  ${k.valor || ''}`.trim())
        for (const x of k.subs || []) out.push(`   ${x.s}${x.valor ? `  ${x.valor}` : ''}`)
        if (k.obs) out.push(`   ${k.obs}`)
        break
      case 'par': case 'total': out.push(`${k.rotulo}  ${k.valor}`); break
      case 'dado': out.push(`${k.rotulo} ${k.valor}`); break
      case 'tabela_cab': out.push(`${k.qtd}  ${k.desc}  ${k.total}`); break
      case 'tabela_item':
        out.push(`${k.qtd}  ${k.desc}  ${k.total}`)
        for (const x of k.subs || []) out.push(`     ${x.s}${x.valor ? `  ${x.valor}` : ''}`)
        break
      case 'tracejado': out.push('- - - - - - - - - - - - - - - -'); break
      case 'qr': out.push('[QR]'); break
      case 'rodape':
        for (const l of k.linhas || []) out.push(l.s)
        if (k.loja) { if (k.loja.nome) out.push(k.loja.nome); if (k.loja.telefone) out.push(`Tel.: ${k.loja.telefone}`); if (k.loja.endereco) out.push(k.loja.endereco) }
        if (k.final) out.push(k.final)
        break
      case 'rodape_qr': for (const l of k.linhas || []) if (l.s) out.push(l.s); if (k.qr) out.push('[QR]'); break
      case 'loja': if (k.nome) out.push(k.nome); if (k.telefone) out.push(`Tel.: ${k.telefone}`); if (k.endereco) out.push(k.endereco); break
      case 'separador': out.push('. . . . . . . . . . . . . . . .'); break
      case 'rodape_loja': {
        const l = k.loja || {}
        if (l.nome) out.push(l.nome)
        if (l.telefone) out.push(`Tel.: ${l.telefone}`)
        if (l.linha1) out.push(l.linha1)
        if (l.cidade) out.push(l.cidade)
        for (const s of k.chamada || []) out.push(s)
        if (k.qr) out.push('[QR]')
        if (k.final) out.push(k.final)
        break
      }
      default: break
    }
  }
  return out.join('\n')
}

module.exports = { montarPreContaBeta, textoDoDocumento, statusPagamento }
