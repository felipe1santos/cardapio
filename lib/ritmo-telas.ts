/**
 * Ritmo das telas que consultam o servidor (01/11/2026, Fase 3 da auditoria de infraestrutura). Regras puras:
 * espera crescente com teto (regra 1 de docs/CORRECOES-DE-BUGS.md), pausa com a aba escondida e recurso desligado = quase
 * zero consulta (regra 3). Cada função diz de onde veio o número.
 */

/** Pré-conta do PDV: 700 ms nos primeiros 15 s (o papel sai em 1–2 s), 2 s até 1 min, 5 s depois; escondida 5 s; para aos 10 min. Antes: 0,7→2 s sem teto. */
export const PRE_CONTA_TETO_MS = 10 * 60_000
export function intervaloPreConta(idadeMs: number, visivel: boolean): number | null {
  if (idadeMs >= PRE_CONTA_TETO_MS) return null
  if (!visivel) return 5_000
  if (idadeMs < 15_000) return 700
  if (idadeMs < 60_000) return 2_000
  return 5_000
}

/** "O Assistente desta loja toca o alarme?": 15 s com Assistente; 5 min quando a loja nem tem Assistente pareado (antes: 15 s em toda loja). */
export const ASSISTENTE_MS = 15_000
export const ASSISTENTE_SEM_MS = 5 * 60_000
export function intervaloPerguntaAssistente(resposta: { assistente: boolean; semAssistente?: boolean } | null): number {
  return resposta?.semAssistente ? ASSISTENTE_SEM_MS : ASSISTENTE_MS
}

/** Telas de operação: trocar entre elas não muda a configuração da loja, então o checklist (9 consultas) não precisa reler. */
const TELAS_DE_OPERACAO = ['/admin/pedidos', '/admin/kds', '/admin/pdv', '/admin/dashboard', '/admin/mesas', '/admin/lista-pedidos', '/admin/financeiro', '/admin/atendimento']
export function deveRecarregarChecklist(anterior: string | null, atual: string): boolean {
  if (anterior === null || anterior === atual) return anterior === null
  return !TELAS_DE_OPERACAO.some((t) => anterior === t || anterior.startsWith(`${t}/`))
}

/** Junta chamadas numa janela curta (contada da PRIMEIRA) numa só — como o coletor do Kanban, para quem só relê tudo. */
export function criarAgrupador(esperaMs: number, fn: () => void): { chamar: () => void; cancelar: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    chamar() {
      if (timer) return
      timer = setTimeout(() => { timer = null; fn() }, esperaMs)
    },
    cancelar() {
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
