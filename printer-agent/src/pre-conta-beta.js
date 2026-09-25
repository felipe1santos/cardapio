// ─────────────────────────────────────────────────────────────────────────────
// RECIBO/EXTRATO do ASSISTENTE BETA — layout próprio, desenhado por print-beta.ps1.
//
// Só o Beta usa este arquivo. O Recibo/Extrato do Assistente atual (pre-conta.js +
// print.ps1) e a ficha da cozinha (recibo.js) não mudam.
//
// Monta o documento em BLOCOS (JSON), não em texto pronto: quem mede e quebra as linhas
// é o renderizador, na largura real do papel (58 ou 80 mm, ou a calibrada). O mesmo
// montador serve a conta real e o "Testar Recibo/Extrato" — o teste só muda os dados
// (snapshot de demonstração), as frases de teste e os marcadores de borda.
//
// Tudo vem do SNAPSHOT do servidor; o agente não calcula valor nenhum (o status do
// pagamento é só a leitura de pago/restante). Telefone, endereço, observação do pedido e
// frete só saem no documento de TESTE — a conta real nunca os imprime, mesmo que o campo
// apareça no snapshot.
// ─────────────────────────────────────────────────────────────────────────────

const { brl } = require('./pre-conta')

function dataHora(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d
    .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .replace(',', '')
}

const ROTULO_FORMA = { dinheiro: 'Dinheiro', pix: 'Pix', credito: 'Crédito', debito: 'Débito', vale: 'Vale-refeição', fiado: 'Fiado' }

/** Valor negativo com o sinal de menos tipográfico (−R$ 45,00). */
function brlNegativo(v) {
  return `−${brl(Math.abs(Number(v) || 0))}`
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

const texto = (v) => (v === undefined || v === null ? '' : String(v).trim())

/**
 * Documento do Recibo/Extrato do Beta.
 * @param {object} s snapshot (conta real ou recibo_teste)
 * @returns {{ versao: 1, teste: boolean, loja: string, blocos: object[] }}
 */
function montarPreContaBeta(s) {
  const teste = s.recibo_teste === true
  const b = []
  const campo = (rotulo, valor) => {
    const v = texto(valor)
    if (v) b.push({ t: 'campo', rotulo, valor: v })
  }

  if (teste) b.push({ t: 'marcas' })
  b.push({ t: 'cabecalho' })
  b.push({ t: 'faixa', s: 'RECIBO/EXTRATO' })
  if (teste) {
    for (const f of ['TESTE DE IMPRESSÃO', 'SEM VALOR FISCAL', 'CONFERÊNCIA DE CONSUMO', 'NÃO É DOCUMENTO FISCAL', 'PEDIDO DE DEMONSTRAÇÃO']) b.push({ t: 'centro', s: f })
  }

  // Atendimento
  b.push({ t: 'pontilhado' })
  campo('Cliente', s.cliente_nome)
  if (!teste) {
    if (s.tipo === 'balcao') campo('Balcão', s.senha !== undefined && s.senha !== null ? `senha ${s.senha}` : 'sim')
    else {
      campo('Mesa', s.mesa)
      campo('Comanda', s.comanda_numero)
    }
  }
  campo('Abertura', dataHora(s.aberta_em))
  campo('Impressão', dataHora(s.impresso_em))
  campo('Operador', s.operador)
  campo('Via', Number(s.via) > 1 ? `${s.via}ª (reimpressão)` : '1ª')
  if (teste) {
    campo('Telefone', s.cliente_telefone)
    const e = s.endereco && typeof s.endereco === 'object' ? s.endereco : null
    if (e) {
      campo('Endereço', [e.rua, e.numero].map(texto).filter(Boolean).join(', '))
      campo('Complemento', e.complemento)
      campo('Cidade/UF', [texto(e.bairro), [texto(e.cidade), texto(e.uf)].filter(Boolean).join('/')].filter(Boolean).join(' · '))
    }
    campo('Observação', s.observacao)
  }
  b.push({ t: 'pontilhado' })

  // Consumo
  const itens = Array.isArray(s.itens) ? s.itens : []
  const unidades = itens.reduce((t, i) => t + (Number(i.quantidade) || 0), 0)
  b.push({ t: 'faixa', s: `CONSUMO (${unidades})` })
  if (itens.length === 0) b.push({ t: 'linha', s: 'Nenhum item cobrado.' })
  itens.forEach((it, idx) => {
    b.push({ t: 'item', nome: `${it.quantidade}x ${texto(it.nome)}`, valor: brl(it.subtotal) })
    const variacao = [texto(it.tamanho), texto(it.sabor)].filter(Boolean).join(' — ')
    if (variacao) b.push({ t: 'sub', s: variacao })
    if (Number(it.quantidade) > 1) b.push({ t: 'sub', s: `${it.quantidade} × ${brl(it.preco_unitario)}` })
    if (it.borda) b.push({ t: 'sub', s: `+ Borda: ${texto(it.borda)}` })
    if (it.massa) b.push({ t: 'sub', s: `+ Massa: ${texto(it.massa)}` })
    const agrupados = new Map()
    for (const c of Array.isArray(it.complementos) ? it.complementos : []) {
      const cur = agrupados.get(c.nome) ?? { nome: c.nome, preco: Number(c.preco) || 0, qtd: 0 }
      cur.qtd += 1
      agrupados.set(c.nome, cur)
    }
    for (const c of agrupados.values()) {
      const preco = c.preco * c.qtd
      b.push({ t: 'sub', s: `+ ${c.qtd > 1 ? `${c.qtd}x ` : ''}${texto(c.nome)}${preco > 0 ? ` (${brl(preco)})` : ''}` })
    }
    if (texto(it.observacao)) b.push({ t: 'sub', s: `Obs.: ${texto(it.observacao)}` })
    if (idx < itens.length - 1) b.push({ t: 'divisa' })
  })

  // Totais
  b.push({ t: 'faixa', s: 'TOTAIS' })
  b.push({ t: 'valor', rotulo: 'Subtotal', valor: brl(s.subtotal) })
  if (Number(s.taxa) > 0 || Number(s.taxa_percentual) > 0) {
    b.push({ t: 'valor', rotulo: `Taxa de serviço (${String(Number(s.taxa_percentual)).replace('.', ',')}%)`, valor: brl(s.taxa) })
  }
  if (Number(s.desconto) > 0) b.push({ t: 'valor', rotulo: 'Desconto', valor: brlNegativo(s.desconto) })
  if (teste && Number(s.taxa_entrega) > 0) b.push({ t: 'valor', rotulo: 'Taxa de entrega', valor: brl(s.taxa_entrega) })
  b.push({ t: 'total', rotulo: 'TOTAL', valor: brl(s.total) })
  const pagamentos = Array.isArray(s.pagamentos) ? s.pagamentos : []
  if (Number(s.pago) > 0 || pagamentos.length > 0) {
    b.push({ t: 'valor', rotulo: 'Já pago', valor: brl(s.pago) })
    for (const p of pagamentos) b.push({ t: 'valor', rotulo: ROTULO_FORMA[p.forma] ?? texto(p.forma), valor: brl(p.valor), leve: true })
  }
  b.push({ t: 'valor', rotulo: 'Restante a pagar', valor: brl(s.restante), negrito: true })
  b.push({ t: 'valor', rotulo: 'Status', valor: statusPagamento(s) })

  const cancelados = Array.isArray(s.cancelados) ? s.cancelados : []
  if (cancelados.length > 0) {
    b.push({ t: 'pontilhado' })
    b.push({ t: 'centro', s: 'CANCELADOS — NÃO COBRADOS' })
    for (const c of cancelados) b.push({ t: 'sub', s: `${c.quantidade}x ${texto(c.nome)}` })
  }

  // Rodapé
  b.push({ t: 'pontilhado' })
  b.push({ t: 'rodape', s: 'Confira os itens da sua conta.' })
  b.push({ t: 'rodape', s: 'feito por Menuzia.com.br' })
  if (teste) {
    b.push({ t: 'rodape', s: 'TESTE DE IMPRESSÃO — SEM VALOR FISCAL', negrito: true })
    b.push({ t: 'marcas' })
  }
  b.push({ t: 'corte' })

  return { versao: 1, teste, loja: texto(s.loja), blocos: b }
}

/** Texto corrido do documento (registro, busca em teste e impressão de emergência). */
function textoDoDocumento(doc) {
  const out = []
  for (const k of doc.blocos) {
    if (k.t === 'cabecalho') out.push(doc.loja.toUpperCase())
    else if (k.t === 'faixa' || k.t === 'centro' || k.t === 'linha' || k.t === 'sub' || k.t === 'rodape') out.push(k.s)
    else if (k.t === 'campo') out.push(`${k.rotulo}: ${k.valor}`)
    else if (k.t === 'item' || k.t === 'valor' || k.t === 'total') out.push(`${k.nome ?? k.rotulo}  ${k.valor}`)
    else if (k.t === 'pontilhado' || k.t === 'divisa') out.push('- - - - - - - - - - - - - - - -')
  }
  return out.join('\n')
}

module.exports = { montarPreContaBeta, textoDoDocumento, statusPagamento }
