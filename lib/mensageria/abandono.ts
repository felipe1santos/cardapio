import type { SupabaseClient } from '@supabase/supabase-js'
import { enfileirar } from './fila'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Loja assumiu e sumiu (Etapa 4, 20/10): um humano respondeu (pelo painel ou pelo celular) e depois ficou
 * `auto_voltar_min` minutos sem responder a uma mensagem do cliente → o robô/IA volta a atender sozinho, com um pedido
 * de desculpas, e segue com o contexto (a IA lê as últimas mensagens; a pergunta pendente do cliente está lá).
 * Roda no cron da fila do WhatsApp (a cada minuto), antes de processar a fila. Nunca mexe em conversa que a loja
 * ESTÁ respondendo (última mensagem é da loja) nem em conversa sem humano envolvido.
 */
export const TEXTO_RETORNO_ROBO = 'Desculpe a demora! Posso continuar seu pedido por aqui 😊 É só me dizer o que precisa.'
export const VOLTAR_MIN_PADRAO = 5

export interface ConversaParaAbandono {
  id: string
  estado: string | null
  atendimento: string | null
  atendente_nome: string | null
  silenciada_motivo: string | null
  silenciada_em: string | null
  ultima_origem: string | null
  ultima_mensagem_em: string | null
}

/** A loja assumiu (painel ou celular), o cliente mandou a última mensagem e ninguém respondeu em `voltarMin`. Pura. */
export function conversaAbandonada(c: ConversaParaAbandono, agora: number, voltarMin: number): boolean {
  if (c.estado !== 'silenciada' || c.atendimento !== 'humano') return false
  // Humano de verdade na conversa: assumiu no painel (atendente) ou respondeu pelo celular.
  const humano = !!c.atendente_nome || c.silenciada_motivo === 'celular'
  if (!humano) return false
  if (c.ultima_origem !== 'cliente' || !c.ultima_mensagem_em) return false
  // A mensagem do cliente tem que ser DEPOIS de a loja ter assumido (senão é a mensagem que motivou o assumir).
  if (c.silenciada_em && Date.parse(c.ultima_mensagem_em) < Date.parse(c.silenciada_em)) return false
  return agora - Date.parse(c.ultima_mensagem_em) >= voltarMin * 60_000
}

export async function devolverConversasAbandonadas(admin: SupabaseClient, agora = Date.now()): Promise<{ lojas: number; devolvidas: number }> {
  const resumo = { lojas: 0, devolvidas: 0 }
  const { data: cfgs } = await admin.from('whatsapp_robo_config').select('restaurante_id, auto_voltar_min').eq('autoatendimento_ativo', true)
  for (const cfg of (cfgs ?? []) as { restaurante_id: string; auto_voltar_min: number | null }[]) {
    resumo.lojas++
    const voltarMin = Number(cfg.auto_voltar_min ?? VOLTAR_MIN_PADRAO) || VOLTAR_MIN_PADRAO
    const limite = new Date(agora - voltarMin * 60_000).toISOString()
    const { data: convs } = await admin.from('whatsapp_conversas')
      .select('id, telefone, estado, atendimento, atendente_nome, silenciada_motivo, silenciada_em, ultima_origem, ultima_mensagem_em')
      .eq('restaurante_id', cfg.restaurante_id).eq('estado', 'silenciada').eq('atendimento', 'humano').eq('ultima_origem', 'cliente').lte('ultima_mensagem_em', limite)
      .gte('ultima_mensagem_em', new Date(agora - 24 * 3600_000).toISOString()).limit(50)
    for (const c of (convs ?? []) as (ConversaParaAbandono & { telefone: string })[]) {
      if (!conversaAbandonada(c, agora, voltarMin)) continue
      // Volta ao robô (mesmo efeito do "Retomar robô" da central), uma vez só: UPDATE condicional.
      const { data: mudou } = await admin.from('whatsapp_conversas').update({
        estado: 'robo', silenciada_em: null, silenciada_motivo: null, atendimento: 'robo', atendente_id: null, atendente_nome: null, assumida_em: null,
      }).eq('id', c.id).eq('estado', 'silenciada').eq('atendimento', 'humano').select('id').maybeSingle()
      if (!mudou) continue
      await admin.from('whatsapp_eventos').insert({ restaurante_id: cfg.restaurante_id, conversa_id: c.id, tipo: 'retorno_robo_abandono', resultado: { voltarMin, ultimaMensagemEm: c.ultima_mensagem_em, motivoAnterior: c.silenciada_motivo } }).then(() => null, () => null)
      await enfileirar(admin, { restauranteId: cfg.restaurante_id, chave: `retorno:${c.id}:${c.ultima_mensagem_em}`, tipo: 'robo', telefone: c.telefone, texto: TEXTO_RETORNO_ROBO, conversaId: c.id }).catch(() => null)
      await registrarAuditoria(admin, { restauranteId: cfg.restaurante_id, usuarioNome: 'Sistema', acao: 'whatsapp.retorno_automatico', entidade: 'whatsapp_conversa', entidadeId: c.id, dados: { voltarMin, atendente: c.atendente_nome, motivo: c.silenciada_motivo } }).catch(() => null)
      resumo.devolvidas++
    }
  }
  return resumo
}
