/**
 * IMPRESSÃO EM DUAS OPÇÕES (2026-10-05) — regra pura, usada pela tela e pelos testes.
 *
 *   · "Assistente antigo" (padrão): o Assistente 0.1.23 imprime a comanda que já existe.
 *   · "Assistente Beta (novo)": o Beta imprime a COMANDA DA COZINHA e a PRÉ-CONTA no modelo v3;
 *     a via da cozinha sem valores é opcional (desligada).
 *
 * Nada novo no banco: a opção é LIDA do modo do Beta que a loja já tem (0100). "Somente teste"
 * = antigo; "Somente Caixa" e "Cozinha e Caixa" = Beta. Escolher Beta grava "Cozinha e Caixa"
 * (a troca auditada de sempre, impressao_modo_definir); voltar ao antigo grava "Somente teste"
 * — que o banco sempre permite e devolve a cozinha ao Assistente antigo na hora. Por isso o
 * deploy não muda nenhuma loja.
 */
import { compararVersao, VERSAO_IMPRESSAO_V3 } from '@/lib/avisos-painel'
import type { AgenteVisao, DispositivoVisao, Funcao, ModoBeta, TrabalhoVisao } from '@/lib/impressao/servico'

export type OpcaoImpressao = 'antigo' | 'beta'

export function opcaoDaLoja(modo: ModoBeta): OpcaoImpressao {
  return modo === 'teste' ? 'antigo' : 'beta'
}
export const MODO_DA_OPCAO: Record<OpcaoImpressao, ModoBeta> = { antigo: 'teste', beta: 'cozinha_caixa' }

export const TEXTO_OPCAO: Record<OpcaoImpressao, { titulo: string; frase: string }> = {
  antigo: { titulo: 'Assistente antigo', frase: 'O sistema de sempre: imprime a comanda do pedido como hoje.' },
  beta: { titulo: 'Assistente Beta (novo)', frase: 'Comanda e pré-conta no modelo novo, mais fácil de ler e de calibrar.' },
}

export const CONFIRMACAO_OPCAO: Record<OpcaoImpressao, string> = {
  beta: 'Sua loja vai passar a imprimir pelo Assistente Beta. Ele precisa estar instalado e conectado.',
  antigo: 'Sua loja vai voltar a imprimir pelo Assistente antigo. Ele precisa estar aberto no computador da impressora.',
}

export type Sinal = 'ok' | 'atencao' | 'erro'
export interface LinhaSituacao { rotulo: string; valor: string; sinal: Sinal | null; testid: string }
export type AcaoSituacao =
  | 'instalar_beta' | 'atualizar_beta' | 'parear' | 'escolher_impressoras' | 'abrir_beta' | 'passar_comanda' | 'liberar'
  | 'instalar_antigo' | 'abrir_antigo' | 'ativar_antigo'
export interface AvisoSituacao { tipo: 'atencao' | 'erro' | 'info'; titulo: string; texto: string; acao: AcaoSituacao; rotuloAcao: string }
export interface Situacao { sinal: Sinal; linhas: LinhaSituacao[]; aviso: AvisoSituacao | null }

export interface DadosBeta {
  agentes: AgenteVisao[]
  dispositivos: DispositivoVisao[]
  funcoes: Record<Funcao, string | null>
  trabalhos: TrabalhoVisao[]
  modo: ModoBeta
  betaLiberado: boolean
}

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

const nomeDisp = (d: DispositivoVisao | undefined) => (d ? d.apelido || d.nomeSistema : '')

/** Versão mais nova entre os computadores ativos (pareados e não revogados). */
export function versaoInstalada(agentes: AgenteVisao[]): string | null {
  let melhor: string | null = null
  for (const a of agentes) if (!a.revogado && a.versao && (!melhor || compararVersao(a.versao, melhor) > 0)) melhor = a.versao
  return melhor
}

/** O que falta para o Beta imprimir (passo a passo de ativação). */
export function prontidaoBeta(p: DadosBeta) {
  const ativos = p.agentes.filter((a) => !a.revogado)
  const conectado = ativos.some((a) => a.online)
  const dCozinha = p.dispositivos.find((d) => d.id === p.funcoes.cozinha)
  const agCozinha = dCozinha ? ativos.find((a) => a.id === dCozinha.agenteId) : undefined
  const passos = [
    { id: 'instalar', titulo: 'Instalar o Assistente Beta no computador da impressora', feito: ativos.length > 0 },
    { id: 'parear', titulo: 'Conectar o computador à sua loja (código de 8 letras)', feito: conectado },
    { id: 'impressoras', titulo: 'Escolher a impressora da Cozinha (e a do Recibo/Extrato)', feito: !!dCozinha && !!agCozinha?.online },
  ] as const
  return {
    liberado: p.betaLiberado,
    temComputador: ativos.length > 0,
    conectado,
    cozinha: !!dCozinha,
    pronto: p.betaLiberado && passos.every((x) => x.feito),
    passos,
  }
}

/** Situação do Assistente Beta: selo geral, linhas (computador, versão, impressoras, última impressão) e UM aviso com UMA ação. */
export function situacaoBeta(p: DadosBeta, alvo = VERSAO_IMPRESSAO_V3): Situacao {
  const ativos = p.agentes.filter((a) => !a.revogado)
  const online = ativos.filter((a) => a.online)
  const versao = versaoInstalada(p.agentes)
  const desatualizado = !!versao && compararVersao(versao, alvo) < 0
  const dCozinha = p.dispositivos.find((d) => d.id === p.funcoes.cozinha)
  const dCaixa = p.dispositivos.find((d) => d.id === p.funcoes.caixa)
  const usadas = [dCozinha, dCaixa].filter((d): d is DispositivoVisao => !!d)
  const ultimoUso = usadas.map((d) => d.ultimoUsoEm).filter((x): x is string => !!x).sort().at(-1) ?? null
  const ultimoErro = usadas.map((d) => d.ultimoErroEm).filter((x): x is string => !!x).sort().at(-1) ?? null
  const ultimoTrab = p.trabalhos[0] ?? null
  const erroRecente = !!ultimoErro && (!ultimoUso || ultimoErro > ultimoUso)

  const linhas: LinhaSituacao[] = [
    {
      rotulo: 'Assistente', testid: 'sit-assistente',
      valor: ativos.length === 0 ? 'Não instalado' : online.length ? `Conectado (${online.map((a) => a.nome).join(', ')})` : `Sem sinal desde ${quando(ativos.map((a) => a.vistoEm ?? '').sort().at(-1) ?? null) || '—'}`,
      sinal: ativos.length === 0 ? 'erro' : online.length ? 'ok' : 'erro',
    },
    { rotulo: 'Versão', testid: 'sit-versao', valor: versao ?? '—', sinal: !versao ? null : desatualizado ? 'atencao' : 'ok' },
    { rotulo: 'Cozinha', testid: 'sit-cozinha', valor: nomeDisp(dCozinha) || 'Não escolhida', sinal: dCozinha ? 'ok' : 'erro' },
    { rotulo: 'Recibo/Extrato', testid: 'sit-caixa', valor: nomeDisp(dCaixa) || 'Não escolhida', sinal: dCaixa ? 'ok' : 'atencao' },
    {
      rotulo: 'Última impressão', testid: 'sit-ultima',
      valor: erroRecente ? `Erro em ${quando(ultimoErro)}` : ultimoUso ? quando(ultimoUso) : ultimoTrab ? quando(ultimoTrab.criadoEm) : 'Nenhuma ainda',
      sinal: erroRecente ? 'erro' : ultimoUso || ultimoTrab?.estado === 'enviado_spooler' ? 'ok' : null,
    },
  ]

  let aviso: AvisoSituacao | null = null
  if (!p.betaLiberado) aviso = { tipo: 'info', titulo: 'O Assistente Beta ainda não foi liberado para a sua loja', texto: 'Fale com o suporte Menuzia para liberar. Enquanto isso, a impressão continua pelo Assistente antigo.', acao: 'liberar', rotuloAcao: 'Falar com o suporte' }
  else if (ativos.length === 0) aviso = { tipo: 'erro', titulo: 'O Assistente Beta não está instalado', texto: 'Instale no computador ligado à impressora e conecte à sua loja.', acao: 'instalar_beta', rotuloAcao: 'Baixar e instalar o Assistente' }
  else if (!online.length) aviso = { tipo: 'erro', titulo: 'O Assistente Beta está sem sinal', texto: 'Ligue o computador da impressora e abra o "Assistente Menuzia Beta". Se ele estiver aberto, confira a internet.', acao: 'abrir_beta', rotuloAcao: 'Ver como resolver' }
  else if (!dCozinha) aviso = { tipo: 'atencao', titulo: 'Falta escolher a impressora da Cozinha', texto: 'Diga em qual impressora sai a comanda (e a pré-conta).', acao: 'escolher_impressoras', rotuloAcao: 'Escolher impressoras' }
  else if (desatualizado) aviso = { tipo: 'atencao', titulo: `Atualize o Assistente para o ${alvo}`, texto: 'A versão nova traz a comanda e a pré-conta no modelo novo. Instale por cima, sem desinstalar.', acao: 'atualizar_beta', rotuloAcao: `Atualizar para o ${alvo.replace('0.2.0-', '')}` }
  else if (p.modo === 'caixa') aviso = { tipo: 'atencao', titulo: 'Modo misto: a comanda da cozinha sai pelo Assistente antigo', texto: 'O Beta imprime só a pré-conta. Se o Assistente antigo estiver desligado, a comanda não sai. Passe a comanda para o Beta.', acao: 'passar_comanda', rotuloAcao: 'Passar a comanda para o Beta' }
  else if (erroRecente) aviso = { tipo: 'erro', titulo: 'A última impressão deu erro', texto: 'Confira papel, tampa e cabo. Se continuar, use "Configurações avançadas › Calibrar".', acao: 'abrir_beta', rotuloAcao: 'Ver como resolver' }

  const sinal: Sinal = linhas.some((l) => l.sinal === 'erro') ? 'erro' : aviso || linhas.some((l) => l.sinal === 'atencao') ? 'atencao' : 'ok'
  return { sinal, linhas, aviso }
}

/** Situação do Assistente antigo (sinal a cada 5 s, impressora em uso). */
export function situacaoAntigo(a: { ativado: boolean; vistoEm: string | null; online: boolean; impressora: string | null }): Situacao {
  const linhas: LinhaSituacao[] = [
    { rotulo: 'Assistente', testid: 'sit-assistente', valor: !a.ativado ? 'Desativado' : a.online ? 'Conectado' : a.vistoEm ? `Sem sinal desde ${quando(a.vistoEm)}` : 'Não conectado', sinal: !a.ativado ? 'erro' : a.online ? 'ok' : 'erro' },
    { rotulo: 'Versão', testid: 'sit-versao', valor: '0.1.23', sinal: null },
    { rotulo: 'Impressora', testid: 'sit-cozinha', valor: a.impressora || 'Não escolhida', sinal: a.impressora ? 'ok' : 'atencao' },
    { rotulo: 'Último sinal', testid: 'sit-ultima', valor: a.vistoEm ? quando(a.vistoEm) : 'Nenhum ainda', sinal: a.online ? 'ok' : null },
  ]
  let aviso: AvisoSituacao | null = null
  if (!a.ativado) aviso = { tipo: 'erro', titulo: 'O Assistente de Impressão está desativado', texto: 'Ative para os pedidos voltarem a sair no papel.', acao: 'ativar_antigo', rotuloAcao: 'Ativar o Assistente' }
  else if (!a.vistoEm) aviso = { tipo: 'erro', titulo: 'O Assistente antigo ainda não se conectou', texto: 'Instale no computador ligado à impressora e cole o token da loja (Configurações avançadas).', acao: 'instalar_antigo', rotuloAcao: 'Baixar e instalar o Assistente' }
  else if (!a.online) aviso = { tipo: 'erro', titulo: 'O Assistente antigo está sem sinal', texto: 'Ligue o computador da impressora e abra o "Assistente de Impressão Menuzia".', acao: 'abrir_antigo', rotuloAcao: 'Ver como resolver' }
  const sinal: Sinal = linhas.some((l) => l.sinal === 'erro') ? 'erro' : aviso || linhas.some((l) => l.sinal === 'atencao') ? 'atencao' : 'ok'
  return { sinal, linhas, aviso }
}
