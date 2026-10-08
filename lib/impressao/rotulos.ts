import { compararVersao } from '@/lib/avisos-painel'
/**
 * Rótulos dos estados de impressão — usados no painel e no PDV.
 *
 * `enviado_spooler` = o Windows (ou a impressora, no envio direto) aceitou o trabalho — a
 * tela diz "Impresso". Antes disso: "Enviado para a impressora" (o Assistente pegou).
 * Observação: pelo driver, o Windows aceitar não garante papel na mão. Impressora térmica
 * comum não informa se o papel saiu (sem papel, tampa aberta e offline ficam na fila
 * do Windows). A tela diz exatamente o que o sistema sabe.
 */
export const ROTULO_ESTADO_IMPRESSAO: Record<string, string> = {
  pendente: 'Aguardando o Assistente…',
  reservado: 'Enviado para a impressora',
  enviado_spooler: 'Impresso',
  falhou: 'Erro ao imprimir',
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

/** Subtipo do teste_impressora no histórico. */
export const ROTULO_SUBTIPO_TESTE: Record<'calibracao' | 'recibo_teste' | 'cozinha_teste', string> = {
  calibracao: 'Teste de largura',
  recibo_teste: 'Recibo/Extrato de teste',
  cozinha_teste: 'Comanda da cozinha de teste',
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
  versao: '0.2.0-beta.11',
  url: 'https://github.com/felipe1santos/cardapio/releases/download/printer-agent-v0.2.0-beta.11/AssistenteMenuziaBeta-Setup-0.2.0-beta.11.exe',
}

/**
 * Pareamento sem código (noite 5): o Assistente lê o convite do link menuzia:// e do nome do
 * instalador a partir desta versão. Enquanto o link oficial for anterior, o painel não oferece.
 */
export const VERSAO_CONVITE = '0.2.0-beta.10'
export const instaladorConectado = (versao: string = DOWNLOAD_ASSISTENTE_BETA.versao) => compararVersao(versao, VERSAO_CONVITE) >= 0
