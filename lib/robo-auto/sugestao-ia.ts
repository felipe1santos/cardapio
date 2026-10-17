import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarClaude, type BlocoUsoFerramenta } from '@/lib/custo/anthropic'
import { moduloLiberado } from '@/lib/modulos'
import { ASSUNTOS, normalizarTexto, type Assunto } from './classificador'
import type { Sugestao } from './aprender'

/**
 * Sugestão pela IA para "Perguntas que o robô não entendeu" (16/10/2026). As regras sugerem primeiro (sem custo); a IA só
 * revê as que as regras mandaram para "IA responde" — em LOTE, no máximo 1x por dia por loja, só com o módulo Agente de
 * IA liberado e ligado, e sempre pela guarda de custo (chamarClaude → chamarIa: teto da loja e do sistema).
 */
export const MAX_LOTE = 10

export function hojeSaoPaulo(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora)
}

const FERRAMENTA = {
  name: 'sugerir',
  description: 'Para cada mensagem, sugere o que o dono da loja deve fazer.',
  input_schema: {
    type: 'object',
    properties: {
      itens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer', description: 'número da mensagem na lista' },
            acao: { type: 'string', enum: ['robo', 'ia', 'pedido', 'ignorar'] },
            assunto: { type: 'string', enum: ASSUNTOS },
            palavras: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          },
          required: ['n', 'acao'],
        },
      },
    },
    required: ['itens'],
  },
}

const INSTRUCOES = `Você ajuda o dono de um restaurante a ensinar o robô do WhatsApp. Para cada mensagem de cliente que o robô não entendeu, escolha:
- "robo": é uma pergunta simples que um destes assuntos responde: ${ASSUNTOS.join(', ')}. Diga o assunto e 1 a 3 palavras da mensagem que mostram isso (copie as palavras como estão).
- "ia": pergunta sobre a loja ou o cardápio que precisa de uma resposta escrita pelo dono (ex.: "fazem suco?").
- "pedido": o cliente está fazendo um pedido (itens, quantidades).
- "ignorar": não pede nada (ex.: "ah", "pode deixar", "hoje", "ok").
Responda só chamando a ferramenta sugerir.`

/** Lote do dia de uma loja. Devolve quantas sugestões gravou (ou o motivo de não ter feito). */
export async function sugerirComIa(admin: SupabaseClient, restauranteId: string, agora = new Date()): Promise<{ feitas: number; motivo?: string }> {
  const dia = hojeSaoPaulo(agora)
  const { data: cfg } = await admin.from('whatsapp_robo_config').select('ia_ativo, ia_teto_usd_dia, auto_sugestao_ia_em').eq('restaurante_id', restauranteId).maybeSingle()
  if (!cfg || cfg.ia_ativo === false) return { feitas: 0, motivo: 'ia_desligada' }
  if (cfg.auto_sugestao_ia_em === dia) return { feitas: 0, motivo: 'ja_hoje' }
  if (!(await moduloLiberado(admin, restauranteId, 'agente_ia'))) return { feitas: 0, motivo: 'sem_modulo' }
  // Marca o dia ANTES de chamar: falhou ou não, a loja só tenta de novo amanhã (nunca repete no mesmo dia).
  await admin.from('whatsapp_robo_config').update({ auto_sugestao_ia_em: dia }).eq('restaurante_id', restauranteId)
  const { data } = await admin.from('whatsapp_auto_nao_entendidas').select('id, texto, exemplo, sugestao')
    .eq('restaurante_id', restauranteId).is('acao', null).order('vezes', { ascending: false }).limit(60)
  const lote = ((data ?? []) as { id: string; texto: string; exemplo: string | null; sugestao: Sugestao | null }[])
    .filter((l) => l.sugestao?.fonte === 'regras' && l.sugestao.acao === 'ia').slice(0, MAX_LOTE)
  if (!lote.length) return { feitas: 0, motivo: 'nada' }
  const lista = lote.map((l, i) => `${i + 1}. ${(l.exemplo || l.texto).slice(0, 160)}`).join('\n')
  const r = await chamarClaude(admin, { loja: restauranteId, conversa: 'sugestao-nao-entendidas', tetoLojaUsd: cfg.ia_teto_usd_dia === null ? null : Number(cfg.ia_teto_usd_dia) }, {
    system: [{ type: 'text', text: INSTRUCOES }],
    messages: [{ role: 'user', content: lista }],
    tools: [FERRAMENTA],
  }, { timeoutMs: 15_000 })
  if (!r.ok) return { feitas: 0, motivo: r.motivo }
  const uso = r.resposta.content.find((b): b is BlocoUsoFerramenta => b.type === 'tool_use' && b.name === 'sugerir')
  const itens = (uso?.input?.itens ?? []) as { n?: number; acao?: string; assunto?: string; palavras?: string[] }[]
  let feitas = 0
  for (const it of itens) {
    const l = lote[(it.n ?? 0) - 1]
    if (!l || !['robo', 'ia', 'pedido', 'ignorar'].includes(String(it.acao))) continue
    const assunto = (ASSUNTOS as string[]).includes(String(it.assunto)) ? (it.assunto as Assunto) : undefined
    if (it.acao === 'robo' && !assunto) continue
    // Só palavras que existem na mensagem (a IA não inventa palavra-chave).
    const naFrase = new Set(normalizarTexto(l.exemplo || l.texto).split(' '))
    const palavras = (it.palavras ?? []).map((p) => normalizarTexto(String(p))).filter((p) => p && p.split(' ').every((w) => naFrase.has(w))).slice(0, 3)
    const sugestao: Sugestao = { acao: it.acao as Sugestao['acao'], ...(assunto ? { assunto } : {}), ...(palavras.length ? { palavras } : {}), fonte: 'ia' }
    await admin.from('whatsapp_auto_nao_entendidas').update({ sugestao }).eq('id', l.id).eq('restaurante_id', restauranteId)
    feitas++
  }
  return { feitas }
}

/** Cron: no máximo UMA loja por rodada, a primeira que ainda não teve o lote de hoje. */
export async function sugerirComIaUmaLoja(admin: SupabaseClient, agora = new Date()): Promise<{ loja: string | null; feitas: number; motivo?: string }> {
  const dia = hojeSaoPaulo(agora)
  const { data: libs } = await admin.from('loja_modulos').select('restaurante_id').eq('modulo', 'agente_ia').eq('liberado', true)
  const ids = ((libs ?? []) as { restaurante_id: string }[]).map((x) => x.restaurante_id)
  if (!ids.length) return { loja: null, feitas: 0 }
  const { data: cfgs } = await admin.from('whatsapp_robo_config').select('restaurante_id, ia_ativo, auto_sugestao_ia_em').in('restaurante_id', ids)
  const alvo = ((cfgs ?? []) as { restaurante_id: string; ia_ativo: boolean | null; auto_sugestao_ia_em: string | null }[])
    .find((c) => c.ia_ativo !== false && c.auto_sugestao_ia_em !== dia)
  if (!alvo) return { loja: null, feitas: 0 }
  return { loja: alvo.restaurante_id, ...(await sugerirComIa(admin, alvo.restaurante_id, agora)) }
}
