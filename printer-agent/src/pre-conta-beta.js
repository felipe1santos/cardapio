// ─────────────────────────────────────────────────────────────────────────────
// PRÉ-CONTA (Recibo/Extrato) do ASSISTENTE BETA — modelo oficial (2026-09-28,
// pre-conta-menuzia-v4): data e logo no topo, faixa PRE-CONTA, "*** NAO E DOCUMENTO
// FISCAL ***", a mesa grande à esquerda com o número embaixo, comanda/atendente/abertura
// à direita, ITENS CONSUMIDOS em tabela (QTD, DESCRICAO, UNIT., TOTAL) sem linha entre
// os itens, subtotal, serviço, taxa manual, desconto, TOTAL A PAGAR grande e o rodapé.
//
// Só o Beta usa este arquivo. O Recibo/Extrato do Assistente atual (pre-conta.js +
// print.ps1) e a ficha da cozinha antiga (recibo.js) não mudam.
//
// Monta BLOCOS (JSON); quem mede e desenha é o print-beta.ps1. Tudo vem do SNAPSHOT do
// servidor; o agente não calcula valor. Telefone, endereço, observação do pedido e frete
// só saem no documento de TESTE — a conta real nunca os imprime.
// ─────────────────────────────────────────────────────────────────────────────

const { brl } = require('./pre-conta')

const texto = (v) => (v === undefined || v === null ? '' : String(v).trim())
const maiusculo = (v) => texto(v).toLocaleUpperCase('pt-BR')

function data(iso) {
  const d = iso ? new Date(iso) : null
  if (!d || isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function hora(iso) {
  const d = iso ? new Date(iso) : null
  if (!d || isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
}

/** Valor da tabela, sem "R$" (como no modelo). */
function num(v) {
  return brl(v).replace(/^R\$\s*/, '')
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

const pct = (v) => String(Number(v) || 0).replace('.', ',')

/**
 * Documento da pré-conta do Beta.
 * @param {object} s snapshot (conta real ou recibo_teste)
 * @returns {{ versao: 2, modelo: 'pre_conta', teste: boolean, loja: string, blocos: object[] }}
 */
function montarPreContaBeta(s) {
  const teste = s.recibo_teste === true
  const b = []

  if (teste) b.push({ t: 'marcas' })
  const via = Number(s.via) > 1 ? `${s.via}a VIA` : ''
  b.push({ t: 'topo_data', data: data(s.impresso_em), via, logo: 'quadrado' })
  b.push({ t: 'linha_grossa' })
  b.push({ t: 'faixa_arred', s: 'PRE-CONTA' })
  b.push({ t: 'centro', s: '*** NAO E DOCUMENTO FISCAL ***', negrito: true })
  if (teste) b.push({ t: 'centro', s: 'TESTE DE IMPRESSAO - PEDIDO DE DEMONSTRACAO', negrito: true })

  // Mesa grande à esquerda; comanda, atendente e abertura à direita.
  let titulo
  if (teste) titulo = 'Mesa 34'
  else if (s.tipo === 'balcao') titulo = s.senha !== undefined && s.senha !== null ? `Senha ${s.senha}` : 'Balcao'
  // Mesa cadastrada como "Mesa 01" já traz a palavra; "01" ganha o prefixo.
  else titulo = !texto(s.mesa) ? 'Conta' : /^mesa( |$)/i.test(texto(s.mesa)) ? texto(s.mesa) : `Mesa ${texto(s.mesa)}`
  const numero = s.pedido_numero ?? s.comanda_numero
  const pares = []
  if (s.comanda_numero !== undefined && s.comanda_numero !== null) pares.push(['Comanda', String(s.comanda_numero)])
  const atendente = texto(s.atendente) || texto(s.operador)
  if (atendente) pares.push(['Atendente', atendente.split(/\s+/)[0]])
  if (hora(s.aberta_em)) pares.push(['Abertura', hora(s.aberta_em)])
  if (texto(s.cliente_nome)) pares.push(['Cliente', texto(s.cliente_nome).split(/\s+/)[0]])
  b.push({ t: 'mesa', titulo, sub: numero !== undefined && numero !== null ? `#${String(numero).padStart(6, '0')}` : '', pares })

  if (teste) {
    const e = s.endereco && typeof s.endereco === 'object' ? s.endereco : null
    const linhas = []
    if (texto(s.cliente_telefone)) linhas.push(['Telefone:', texto(s.cliente_telefone)])
    if (e) linhas.push(['Endereco:', [texto(e.rua), texto(e.numero)].filter(Boolean).join(', ')])
    if (texto(s.observacao)) linhas.push(['Obs.:', texto(s.observacao)])
    for (const [r, v] of linhas) b.push({ t: 'dado', rotulo: r, valor: v, negrito: false })
  }
  // Itens: faixa preta da seção e tabela compacta, sem linha entre os itens.
  b.push({ t: 'secao', s: 'ITENS CONSUMIDOS' })
  b.push({ t: 'tabela_cab' })
  b.push({ t: 'regua' })
  const itens = Array.isArray(s.itens) ? s.itens : []
  if (itens.length === 0) b.push({ t: 'centro', s: 'Nenhum item cobrado.' })
  for (const it of itens) {
    const variacao = [texto(it.tamanho), texto(it.sabor)].filter(Boolean).join(' - ')
    const subs = []
    if (variacao) subs.push(variacao)
    if (texto(it.borda)) subs.push(`+ Borda: ${texto(it.borda)}`)
    if (texto(it.massa)) subs.push(`+ Massa: ${texto(it.massa)}`)
    const agrupados = new Map()
    for (const c of Array.isArray(it.complementos) ? it.complementos : []) {
      const cur = agrupados.get(c.nome) || { nome: c.nome, n: 0 }
      cur.n += 1
      agrupados.set(c.nome, cur)
    }
    for (const c of agrupados.values()) subs.push(`+ ${c.n > 1 ? `${c.n}x ` : ''}${texto(c.nome)}`)
    if (texto(it.observacao)) subs.push(`Obs.: ${texto(it.observacao)}`)
    b.push({ t: 'tabela_item', qtd: String(it.quantidade), desc: maiusculo(it.nome), unit: num(it.preco_unitario), total: num(it.subtotal), subs })
  }
  // Valores: faixa preta da seção.
  b.push({ t: 'secao', s: 'VALORES' })
  b.push({ t: 'par_pc', rotulo: 'Subtotal', valor: brl(s.subtotal) })
  if (Number(s.taxa) > 0 || Number(s.taxa_percentual) > 0) {
    b.push({ t: 'par_pc', rotulo: `Servico ${pct(s.taxa_percentual)}% opcional`, valor: brl(s.taxa) })
  }
  if (Number(s.taxa_extra) > 0) b.push({ t: 'par_pc', rotulo: texto(s.taxa_extra_nome) || 'Taxa', valor: brl(s.taxa_extra) })
  if (teste && Number(s.taxa_entrega) > 0) b.push({ t: 'par_pc', rotulo: 'Taxa de entrega', valor: brl(s.taxa_entrega) })
  b.push({ t: 'par_pc', rotulo: 'Desconto', valor: brl(s.desconto) })
  const pago = Number(s.pago) || 0
  if (pago > 0) {
    b.push({ t: 'par_pc', rotulo: 'Total da conta', valor: brl(s.total) })
    b.push({ t: 'par_pc', rotulo: 'Ja pago', valor: brl(pago) })
  }
  // TOTAL A PAGAR numa faixa preta, grande (o que o cliente procura primeiro).
  b.push({ t: 'faixa_total', rotulo: 'TOTAL A PAGAR', valor: brl(pago > 0 ? s.restante : s.total) })

  // Rodapé
  b.push({ t: 'centro', s: 'CONFIRA OS ITENS ANTES DO PAGAMENTO', negrito: true })
  b.push({ t: 'tracejado' })
  b.push({ t: 'centro', s: 'Esta pre-conta pode ser paga no caixa' })
  b.push({ t: 'espaco' })
  b.push({ t: 'centro', s: 'Obrigado pela preferencia!', maior: true })
  if (teste) {
    b.push({ t: 'centro', s: 'TESTE DE IMPRESSAO - SEM VALOR FISCAL', negrito: true })
    b.push({ t: 'marcas' })
  }
  b.push({ t: 'corte' })

  return { versao: 2, modelo: 'pre_conta', teste, loja: texto(s.loja), blocos: b }
}

/** Texto corrido do documento (registro, busca em teste e impressão de emergência). */
function textoDoDocumento(doc) {
  const out = []
  for (const k of doc.blocos) {
    switch (k.t) {
      case 'topo':
        out.push([...(k.linhas || []).map(([r, v]) => `${r} ${v}`), k.direita].filter(Boolean).join('  '))
        break
      case 'topo_data': out.push([k.data, k.via].filter(Boolean).join('  ')); break
      case 'faixa_num': out.push(`${k.esq}  ${k.dir}`); break
      case 'faixa_arred': case 'secao': case 'secao_sem_linha': case 'centro': case 'rodape': case 'obs_pedido':
        out.push(k.s)
        break
      case 'item_bola': out.push(`${k.qtd} ${k.nome}  ${k.valor}`); break
      case 'detalhes':
        for (const l of k.linhas || []) out.push(`   ${l.s}${l.valor ? `  ${l.valor}` : ''}`)
        if (k.obs) out.push(`   ${k.obs}`)
        break
      case 'par': case 'par_pc': case 'faixa_total': case 'total_grande': out.push(`${k.rotulo}  ${k.valor}`); break
      case 'rotulo_valor': case 'dado': out.push(`${k.rotulo} ${k.valor}`); break
      case 'mesa':
        out.push([k.titulo, k.sub].filter(Boolean).join('  '))
        for (const [r, v] of k.pares || []) out.push(`${r}: ${v}`)
        break
      case 'tabela_cab': out.push('QTD  DESCRICAO  UNIT.  TOTAL'); break
      case 'tabela_item':
        out.push(`${k.qtd}  ${k.desc}  ${k.unit}  ${k.total}`)
        for (const x of k.subs || []) out.push(`     ${x}`)
        break
      case 'regua': case 'linha_grossa': case 'tracejado': out.push('- - - - - - - - - - - - - - - -'); break
      case 'qr': out.push('[QR]'); break
      default: break
    }
  }
  return out.join('\n')
}

module.exports = { montarPreContaBeta, textoDoDocumento, statusPagamento }
