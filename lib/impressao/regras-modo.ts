/**
 * Quando um modo REAL do Assistente Beta pode ser ligado — regra única, usada pelo servidor
 * (definirModo recusa) e pela tela (botão desabilitado com o motivo). Sem banco: recebe o
 * que o painel já tem (computadores, impressoras, funções).
 *
 * Origem: a tela deixava ligar "Somente Caixa"/"Cozinha e Caixa" sem impressora de
 * Recibo/Extrato válida, e o erro só aparecia no PDV, na frente do cliente (2026-09-27).
 *
 *   · Somente teste   → sempre pode.
 *   · Somente Caixa   → Recibo/Extrato válido.
 *   · Cozinha e Caixa → Cozinha E Recibo/Extrato válidos.
 * Válido = escolhida, computador pareado, não substituído por um pareamento mais novo e
 * com sinal agora. Impressora VIRTUAL do Windows (PDF/XPS/Fax/OneNote) vale igual à
 * física: o dono decide (2026-09-27) — a tela só avisa que ela pode abrir janela de arquivo.
 */
import type { Funcao, ModoBeta } from './servico'

export const ONLINE_MS = 30_000

/** Impressoras que o próprio Windows cria (PDF, XPS, Fax, OneNote): só para o selo/aviso. */
const VIRTUAL = /^(fax|microsoft print to pdf|microsoft xps document writer|onenote.*|enviar para o onenote.*|send to onenote.*)$/i
export const ehImpressoraVirtual = (nomeSistema: string) => VIRTUAL.test(nomeSistema.trim())

export interface AgenteRegra { id: string; nome: string; vistoEm: string | null; revogado: boolean; criadoEm: string }
export interface DispositivoRegra { id: string; agenteId: string; nomeSistema: string }

export type ProblemaFuncao = 'vazia' | 'desconectado' | 'pareamento_antigo' | 'sem_sinal' | 'inexistente'

export const agenteOnline = (a: AgenteRegra, agora = Date.now()) =>
  !a.revogado && !!a.vistoEm && agora - new Date(a.vistoEm).getTime() < ONLINE_MS

/** O mesmo computador foi pareado de novo depois e este registro está sem sinal. */
export function pareamentoAntigo(a: AgenteRegra, todos: AgenteRegra[], agora = Date.now()): boolean {
  if (a.revogado || agenteOnline(a, agora)) return false
  const nome = a.nome.trim().toLowerCase()
  return todos.some((b) => b.id !== a.id && !b.revogado && b.nome.trim().toLowerCase() === nome && new Date(b.criadoEm) > new Date(a.criadoEm))
}

export function problemaDoDispositivo(dispositivoId: string | null, agentes: AgenteRegra[], dispositivos: DispositivoRegra[], agora = Date.now(), exigirSinal = true): ProblemaFuncao | null {
  if (!dispositivoId) return 'vazia'
  const d = dispositivos.find((x) => x.id === dispositivoId)
  if (!d) return 'inexistente'
  const a = agentes.find((x) => x.id === d.agenteId)
  if (!a || a.revogado) return 'desconectado'
  if (pareamentoAntigo(a, agentes, agora)) return 'pareamento_antigo'
  if (exigirSinal && !agenteOnline(a, agora)) return 'sem_sinal'
  return null
}

const ROTULO: Record<Funcao, string> = { cozinha: 'Cozinha', caixa: 'Recibo/Extrato' }

export function motivoProblema(funcao: Funcao, p: ProblemaFuncao): string {
  switch (p) {
    case 'vazia': return `Escolha uma impressora para ${ROTULO[funcao]}`
    case 'inexistente': return `Escolha de novo a impressora de ${ROTULO[funcao]}`
    case 'desconectado': return `O computador da impressora de ${ROTULO[funcao]} está desconectado`
    case 'pareamento_antigo': return 'Remova o pareamento antigo e pareie novamente'
    case 'sem_sinal': return `O computador da impressora de ${ROTULO[funcao]} está sem sinal — abra o Assistente Beta nele`
  }
}

export interface AvaliacaoModos {
  funcoes: Record<Funcao, ProblemaFuncao | null>
  modos: Record<ModoBeta, { ok: boolean; motivo: string | null; codigo: string | null }>
}

/**
 * `exigirSinal`: ligar um modo exige o computador com sinal AGORA. Para decidir se um modo
 * que já está ligado continua de pé, não (um reinício do PC não derruba a loja para teste).
 */
export function avaliarModos(e: { agentes: AgenteRegra[]; dispositivos: DispositivoRegra[]; funcoes: Record<Funcao, string | null> }, agora = Date.now(), exigirSinal = true): AvaliacaoModos {
  const cozinha = problemaDoDispositivo(e.funcoes.cozinha, e.agentes, e.dispositivos, agora, exigirSinal)
  const caixa = problemaDoDispositivo(e.funcoes.caixa, e.agentes, e.dispositivos, agora, exigirSinal)
  const bloqueio = (funcao: Funcao, p: ProblemaFuncao) => ({ ok: false, motivo: motivoProblema(funcao, p), codigo: `${funcao}_${p}` })
  return {
    funcoes: { cozinha, caixa },
    modos: {
      teste: { ok: true, motivo: null, codigo: null },
      caixa: caixa ? bloqueio('caixa', caixa) : { ok: true, motivo: null, codigo: null },
      // Cozinha primeiro (é o que este modo acrescenta); depois o Recibo/Extrato.
      cozinha_caixa: cozinha ? bloqueio('cozinha', cozinha) : caixa ? bloqueio('caixa', caixa) : { ok: true, motivo: null, codigo: null },
    },
  }
}

/** Com este computador desconectado, o modo ativo ainda funciona? (senão: volta para teste) */
export function modoDependeDoAgente(modo: ModoBeta, agenteId: string, dispositivos: DispositivoRegra[], funcoes: Record<Funcao, string | null>): boolean {
  const doAgente = (id: string | null) => !!id && dispositivos.some((d) => d.id === id && d.agenteId === agenteId)
  if (modo === 'caixa') return doAgente(funcoes.caixa)
  if (modo === 'cozinha_caixa') return doAgente(funcoes.caixa) || doAgente(funcoes.cozinha)
  return false
}
