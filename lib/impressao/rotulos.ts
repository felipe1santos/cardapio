/**
 * Rótulos dos estados de impressão — usados no painel e no PDV.
 *
 * `enviado_spooler` NÃO é "impresso": o Windows aceitou o trabalho. Impressora térmica
 * comum não informa se o papel saiu (sem papel, tampa aberta e offline ficam na fila
 * do Windows). A tela diz exatamente o que o sistema sabe.
 */
export const ROTULO_ESTADO_IMPRESSAO: Record<string, string> = {
  pendente: 'Pendente',
  reservado: 'Enviando…',
  enviado_spooler: 'Aceito pela fila do Windows',
  falhou: 'Falha ao enviar',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
}

export const TOM_ESTADO_IMPRESSAO: Record<string, 'pending' | 'preparing' | 'ok' | 'danger' | 'alert'> = {
  pendente: 'pending',
  reservado: 'preparing',
  enviado_spooler: 'ok',
  falhou: 'danger',
  expirado: 'alert',
  cancelado: 'alert',
}

export const ROTULO_TIPO_TRABALHO: Record<string, string> = {
  pre_conta: 'Recibo/Extrato',
  teste_impressora: 'Teste',
}

export const ROTULO_FUNCAO: Record<'cozinha' | 'caixa', string> = {
  cozinha: 'Cozinha',
  caixa: 'Caixa — Recibo/Extrato',
}

export const AVISO_PAPEL =
  'O sistema confirma que o Windows aceitou o trabalho. A impressora não informa se o papel saiu: sem papel, tampa aberta ou offline, o trabalho fica na fila do Windows.'

/** O que o Assistente Beta imprime (0100). */
export const ROTULO_MODO_BETA: Record<'teste' | 'caixa' | 'cozinha_caixa', string> = {
  teste: 'Somente teste',
  caixa: 'Somente Caixa',
  cozinha_caixa: 'Cozinha e Caixa',
}

export const EXPLICACAO_RECIBO_EXTRATO = 'Documento não fiscal usado para o cliente conferir a conta antes ou depois do pagamento.'

/** Instaladores. O atual é o que as lojas já usam; o Beta só aparece para loja liberada. */
export const DOWNLOAD_ASSISTENTE_ATUAL = {
  versao: '0.1.23',
  url: 'https://github.com/felipe1santos/cardapio/releases/download/printer-agent-v0.1.23/AssistenteImpressaoMenuzia-Setup-0.1.23.exe',
}
export const DOWNLOAD_ASSISTENTE_BETA = {
  versao: '0.2.0-beta.1',
  url: 'https://github.com/felipe1santos/cardapio/releases/download/printer-agent-v0.2.0-beta.1/AssistenteMenuziaBeta-Setup-0.2.0-beta.1.exe',
}
