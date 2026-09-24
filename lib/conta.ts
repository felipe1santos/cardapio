/**
 * Regras puras da conta da mesa — o que a tela precisa e não é dinheiro cobrado.
 *
 * O TOTAL não é calculado aqui: ele vem de `comanda_totais()` no banco, a mesma função
 * que o pagamento e o fechamento usam. Calcular em dois lugares seria pedir para o valor
 * da tela divergir do valor cobrado. Aqui ficam só divisão sugerida, troco de exibição,
 * rótulos e tradução de erro.
 */

export const FORMAS_PAGAMENTO = ['dinheiro', 'pix', 'credito', 'debito', 'vale', 'fiado'] as const
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number]

export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  credito: 'Crédito',
  debito: 'Débito',
  vale: 'Vale-refeição',
  fiado: 'Fiado',
}

export function ehForma(valor: unknown): valor is FormaPagamento {
  return typeof valor === 'string' && (FORMAS_PAGAMENTO as readonly string[]).includes(valor)
}

/**
 * O que a loja pode OFERECER hoje. `fiado` saiu da tela: continua no tipo e em
 * `ROTULO_FORMA` porque o banco (0067/0072) ainda aceita a forma e contas antigas
 * gravaram pagamentos com ela — tirar o rótulo deixaria o histórico sem nome. Nada
 * novo nasce com `fiado`: a configuração, a tela de receber e a rota filtram.
 */
export const FORMAS_PAGAMENTO_OFERECIDAS = FORMAS_PAGAMENTO.filter((f) => f !== 'fiado')

export function ehFormaOferecida(valor: unknown): valor is FormaPagamento {
  return ehForma(valor) && (FORMAS_PAGAMENTO_OFERECIDAS as readonly string[]).includes(valor)
}

/** Resumo de um pagamento para a trilha de auditoria. Sem dado sensível: forma e valores. */
export function formatarResumoPagamento(forma: FormaPagamento, valor: number, troco: number): string {
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return troco > 0 ? `${ROTULO_FORMA[forma]} ${brl(valor)} (troco ${brl(troco)})` : `${ROTULO_FORMA[forma]} ${brl(valor)}`
}

/** Arredonda para centavos sem o erro de ponto flutuante de `Math.round(x * 100) / 100`. */
export function centavos(valor: number): number {
  return Math.round(Number((valor * 100).toFixed(6))) / 100
}

/**
 * Divide um valor por pessoas, fechando o centavo.
 *
 * R$ 100 para 3 dá 33,34 + 33,33 + 33,33 — a diferença cai na primeira parte, e a soma
 * das partes é SEMPRE o valor original. Dividir e arredondar cada parte perderia ou
 * criaria um centavo.
 */
export function dividirPorPessoas(total: number, pessoas: number): number[] {
  const n = Math.floor(pessoas)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(n) || n < 1) return []
  const emCentavos = Math.round(total * 100)
  const base = Math.floor(emCentavos / n)
  const sobra = emCentavos - base * n
  return Array.from({ length: n }, (_, i) => (base + (i < sobra ? 1 : 0)) / 100)
}

/** Troco para exibir enquanto o garçom digita. O servidor recalcula ao gravar. */
export function trocoPara(valor: number, recebido: number): number {
  if (!Number.isFinite(valor) || !Number.isFinite(recebido) || recebido < valor) return 0
  return centavos(recebido - valor)
}

/** Etapa de cozinha em português, para mensagens de conflito. */
const ROTULO_STATUS_COZINHA: Record<string, string> = {
  recebido: 'aguardando aceite',
  preparando: 'em preparo',
  pronto: 'pronto',
  entregue: 'entregue',
  cancelado: 'cancelado',
}

/**
 * Traduz o erro que as funções do banco levantam (`raise exception 'codigo:detalhe'`)
 * para uma frase que o garçom entende. Código desconhecido não vaza para a tela.
 */
export function mensagemDeErroConta(bruto: string | null | undefined): string {
  const texto = (bruto ?? '').trim()
  // As funções do banco levantam `codigo` ou `codigo:detalhe`, e o detalhe não é sempre
  // um número (`ja_assumido:Maria`). Por isso o código é lido como snake_case e o valor
  // em reais só é formatado quando o detalhe realmente é numérico.
  const casado = /([a-z][a-z_]*)(?::(.*))?$/.exec(texto)
  const codigo = casado?.[1] ?? ''
  const detalhe = casado?.[2] ?? ''
  const numerico = detalhe !== '' && Number.isFinite(Number(detalhe))
  const reais = numerico ? Number(detalhe).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''

  const mapa: Record<string, string> = {
    saldo_restante: `Ainda falta receber ${reais}. Registre os pagamentos antes de fechar.`,
    valor_acima_do_restante: `O valor passa do que falta pagar (${reais}).`,
    comanda_nao_aberta: 'Esta conta já foi fechada ou transferida.',
    comanda_inexistente: 'Conta não encontrada.',
    forma_invalida: 'Forma de pagamento inválida.',
    valor_invalido: 'Informe um valor maior que zero.',
    recebido_menor_que_valor: 'O valor recebido é menor que o valor a pagar.',
    motivo_obrigatorio: 'Informe o motivo.',
    pagamento_inexistente: 'Pagamento não encontrado ou já estornado.',
    destino_ocupado: 'A mesa de destino já tem conta aberta. Confirme para juntar as duas.',
    destino_inativo: 'A mesa de destino está desativada.',
    destino_bloqueado: 'A mesa de destino está bloqueada.',
    destino_inexistente: 'Mesa de destino não encontrada.',
    origem_sem_comanda: 'Esta mesa não tem conta aberta para transferir.',
    mesma_mesa: 'Escolha outra mesa.',
    nenhum_item: 'Selecione pelo menos um item.',
    nenhum_item_transferivel: 'Nenhum dos itens selecionados pode ser transferido.',
    item_inexistente: 'Item não encontrado ou já cancelado.',
    comanda_com_pagamento: `Esta conta já recebeu ${reais}. Estorne o pagamento antes de cancelar.`,
    quantidade_invalida: 'Informe uma quantidade de 1 até o total da linha.',
    quantidades_incompativeis: 'Quantidades não correspondem aos itens selecionados.',
    // Conta (0072).
    fiado_sem_observacao: 'No fiado, informe de quem é a conta (nome e contato).',
    pagamento_excede_total: `A conta já recebeu ${reais}, mais do que ficaria valendo. Estorne um pagamento antes.`,
    cancelamento_pendente: 'Há pedido de cancelamento aguardando decisão da gestão. Aprove ou recuse antes de fechar.',
    taxa_invalida: 'Taxa de serviço entre 0% e 30%.',
    desconto_invalido: 'Desconto inválido: em reais, maior ou igual a zero; em %, de 0 a 100.',
    solicitacao_inexistente: 'Pedido de cancelamento não encontrado.',
    solicitacao_decidida: 'Este pedido de cancelamento já foi decidido.',
    ja_cancelado: 'Este lançamento já foi cancelado.',
    // Mesa (0071).
    comanda_aberta: 'Esta mesa tem conta aberta. Feche, transfira ou cancele a conta antes.',
    mesa_com_historico: 'Esta mesa tem histórico de contas e não pode ser excluída. Desative-a.',
    // Chamados (0068).
    mesa_inexistente: 'Mesa não encontrada.',
    mesa_indisponivel: 'Esta mesa está bloqueada ou desativada.',
    motivo_invalido: 'Tipo de chamado inválido.',
    muito_rapido: `Aguarde ${detalhe || 'alguns'} segundos para chamar de novo.`,
    chamado_inexistente: 'Chamado não encontrado.',
    ja_assumido: `Outro atendente já assumiu este chamado${detalhe ? ` (${detalhe})` : ''}.`,
    chamado_encerrado: 'Este chamado já foi encerrado.',
    // PDV v2 (0085).
    nome_obrigatorio: 'Informe o nome do cliente.',
    nome_longo: 'Nome do cliente com no máximo 60 caracteres.',
    telefone_invalido: 'Telefone inválido. Use DDD + número, ou deixe em branco.',
    chave_invalida: 'Operação sem identificador. Recarregue a tela e tente de novo.',
    chave_em_outra_comanda: 'Este pagamento já foi usado em outra conta. Recarregue a tela e tente de novo.',
    origem_invalida: 'Origem da operação inválida.',
    pedido_inexistente: 'Pedido não encontrado nesta conta.',
    conflito_status: `Outra tela mexeu neste pedido antes${ROTULO_STATUS_COZINHA[detalhe] ? ` — agora ele está "${ROTULO_STATUS_COZINHA[detalhe]}"` : ''}. A tela foi atualizada.`,
    transicao_invalida: 'Esta mudança de etapa não é permitida.',
    pedido_nao_pronto: `O pedido ainda não está pronto${ROTULO_STATUS_COZINHA[detalhe] ? ` (está "${ROTULO_STATUS_COZINHA[detalhe]}")` : ''}.`,
    cancelamento_requer_gestao:
      'Este pedido já começou a ser preparado ou a conta já recebeu pagamento. Peça o cancelamento à gerência.',
    pendencias_abertas: 'Ainda há pedido na cozinha ou pronto sem entregar. Veja as pendências.',
    ajuste_financeiro_necessario: `A conta já recebeu mais do que ficaria valendo (sobram ${reais}). Registre antes um estorno ou um ajuste.`,
    nenhuma_acao: 'Escolha o que fazer com pelo menos um pedido.',
    acao_invalida: 'Ação não permitida para este pedido.',
    comanda_nao_fechada: 'Só dá para reabrir uma conta fechada.',
    mesa_ocupada: 'A mesa já tem outra conta aberta. Feche ou transfira antes de reabrir esta.',
    // Atendimento identificado, entrega manual, limpeza e fechamento (0094–0096).
    comanda_sem_nome: 'Esta conta foi aberta sem o nome do cliente. Informe o nome antes de continuar.',
    mesa_em_limpeza: 'Esta mesa está em limpeza. Libere a mesa antes de abrir um novo atendimento.',
    taxa_entrega_invalida: 'Taxa de entrega inválida.',
    endereco_incompleto: 'Endereço de entrega incompleto: informe rua, número e bairro.',
    cupom_exige_telefone: 'Para usar cupom, informe o telefone do cliente.',
    cupom_invalido: 'Cupom não encontrado ou inativo.',
    cupom_item_gratis_pdv: 'Cupom de item grátis só vale no cardápio digital.',
    cupom_so_entrega: 'Este cupom é de entrega grátis e esta conta não é de entrega.',
    cupom_esgotado: 'O cupom atingiu o limite de usos. Remova o cupom para fechar a conta.',
    cupom_ja_usado: 'Este cliente já usou este cupom.',
  }
  return mapa[codigo] ?? 'Não foi possível concluir a operação.'
}
