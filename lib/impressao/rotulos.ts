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
  pre_conta: 'Pré-conta',
  teste_impressora: 'Teste',
}

export const ROTULO_FUNCAO: Record<'cozinha' | 'caixa', string> = {
  cozinha: 'Cozinha',
  caixa: 'Caixa / Pré-conta',
}

export const AVISO_PAPEL =
  'O sistema confirma que o Windows aceitou o trabalho. A impressora não informa se o papel saiu: sem papel, tampa aberta ou offline, o trabalho fica na fila do Windows.'
