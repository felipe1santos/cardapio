/**
 * Agente de IA — o laço da conversa com o Claude (sem banco: o modelo e as ferramentas entram por parâmetro, então os
 * testes rodam com uma IA simulada). Regras de custo: no máximo 4 ferramentas por resposta, prazo total de 15 s,
 * nenhuma nova tentativa. Qualquer falha devolve { ok: false } e quem chama usa o robô padrão.
 */
import type { BlocoConteudo, BlocoTexto, BlocoUsoFerramenta, FerramentaClaude, MensagemClaude, PedidoClaude, ResultadoClaude } from '@/lib/custo/anthropic'
import { MAX_FERRAMENTAS_POR_RESPOSTA } from './ferramentas'

export const PRAZO_IA_MS = 15_000

export interface EntradaConversa {
  system: BlocoTexto[]
  mensagens: MensagemClaude[]
  ferramentas: FerramentaClaude[]
  executar: (nome: string, input: Record<string, unknown>) => Promise<{ conteudo: string; erro?: boolean }>
  chamarModelo: (pedido: PedidoClaude, timeoutMs: number) => Promise<ResultadoClaude>
  prazoMs?: number
  agora?: () => number
}

export type ResultadoConversa =
  | { ok: true; texto: string; custoMicroUsd: number; chamadas: number; ferramentas: string[] }
  | { ok: false; motivo: string; custoMicroUsd: number; chamadas: number }

export async function conversarComIa(e: EntradaConversa): Promise<ResultadoConversa> {
  const agora = e.agora ?? Date.now
  const fim = agora() + (e.prazoMs ?? PRAZO_IA_MS)
  const mensagens = [...e.mensagens]
  let custo = 0
  let chamadas = 0
  let usadas = 0
  let soTexto = false
  const nomes: string[] = []
  // 4 rodadas de ferramentas + a resposta final = no máximo 6 chamadas.
  for (let volta = 0; volta < MAX_FERRAMENTAS_POR_RESPOSTA + 2; volta++) {
    const resta = fim - agora()
    if (resta < 500) return { ok: false, motivo: 'tempo', custoMicroUsd: custo, chamadas }
    const r = await e.chamarModelo({ system: e.system, messages: mensagens, tools: e.ferramentas, toolChoice: soTexto ? 'none' : 'auto' }, resta)
    chamadas++
    if (!r.ok) return { ok: false, motivo: r.motivo, custoMicroUsd: custo, chamadas }
    custo += r.custoMicroUsd
    const blocos = r.resposta.content ?? []
    const usos = blocos.filter((b): b is BlocoUsoFerramenta => b.type === 'tool_use')
    if (r.resposta.stop_reason !== 'tool_use' || !usos.length) {
      const texto = blocos.filter((b): b is BlocoTexto => b.type === 'text').map((b) => b.text).join('\n').trim()
      return { ok: true, texto, custoMicroUsd: custo, chamadas, ferramentas: nomes }
    }
    mensagens.push({ role: 'assistant', content: blocos as BlocoConteudo[] })
    const resultados: BlocoConteudo[] = []
    for (const u of usos) {
      if (usadas >= MAX_FERRAMENTAS_POR_RESPOSTA) {
        resultados.push({ type: 'tool_result', tool_use_id: u.id, content: 'Limite de consultas desta resposta. Responda ao cliente com o que já sabe.', is_error: true })
        soTexto = true
        continue
      }
      usadas++
      nomes.push(u.name)
      const x = await e.executar(u.name, (u.input ?? {}) as Record<string, unknown>)
      resultados.push({ type: 'tool_result', tool_use_id: u.id, content: x.conteudo, ...(x.erro ? { is_error: true } : {}) })
    }
    if (usadas >= MAX_FERRAMENTAS_POR_RESPOSTA) soTexto = true
    mensagens.push({ role: 'user', content: resultados })
  }
  return { ok: false, motivo: 'sem_resposta', custoMicroUsd: custo, chamadas }
}
