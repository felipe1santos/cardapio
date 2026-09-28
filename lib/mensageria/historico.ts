/**
 * Histórico das conversas (central de atendimento, 0107): toda mensagem que a Menuzia
 * manda pelo WhatsApp da loja entra na conversa do cliente com a ORIGEM marcada —
 * atendente, robô, automático (avisos de pedido, fidelidade, código do checkout) ou
 * disparo (campanhas).
 *
 * A saída é gravada ANTES de enviar (wa_id provisório) e concluída depois com o id do
 * provedor. Assim o eco que volta pelo webhook (fromMe) é reconhecido — pelo id ou pelo
 * hash do texto — e não vira "a loja respondeu pelo celular".
 *
 * Registro é melhor esforço: falha aqui nunca impede o envio nem muda o resultado dele.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type OrigemSaida = 'atendente' | 'robo' | 'automatico' | 'disparo'

/** SHA-256 do texto (Web Crypto: vale no servidor e não quebra o bundle do navegador). */
export async function hashTexto(texto: string | null | undefined): Promise<string | null> {
  const t = (texto ?? '').trim()
  if (!t) return null
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Só dígitos, 10 a 15 (o formato de whatsapp_conversas.telefone). */
export function telefoneConversa(numero: string | null | undefined): string | null {
  const d = String(numero ?? '').replace(/\D/g, '')
  return d.length >= 10 && d.length <= 15 ? d : null
}

export interface NovaSaida {
  restauranteId: string
  telefone: string
  /** O que foi para o cliente (vira o hash que reconhece o eco). */
  texto: string
  /** O que aparece no histórico, quando não pode ser o texto (ex.: código de verificação). */
  textoExibido?: string
  origem: OrigemSaida
  tipo?: 'texto' | 'imagem' | 'audio'
  midiaUrl?: string | null
  autorId?: string | null
  autorNome?: string | null
}

export async function registrarSaida(admin: SupabaseClient, s: NovaSaida): Promise<{ mensagemId: string; conversaId: string } | null> {
  const telefone = telefoneConversa(s.telefone)
  if (!telefone) return null
  try {
    const { data, error } = await admin.rpc('whatsapp_registrar_saida', {
      p_restaurante: s.restauranteId,
      p_telefone: telefone,
      p_texto: s.textoExibido ?? s.texto,
      p_texto_hash: await hashTexto(s.texto),
      p_origem: s.origem,
      p_tipo: s.tipo ?? 'texto',
      p_midia_url: s.midiaUrl ?? null,
      p_autor_id: s.autorId ?? null,
      p_autor_nome: s.autorNome ?? null,
    })
    if (error) throw error
    const d = data as { mensagem_id: string; conversa_id: string }
    return { mensagemId: d.mensagem_id, conversaId: d.conversa_id }
  } catch (err) {
    console.warn('[whatsapp] histórico: não foi possível registrar a saída', (err as Error)?.message ?? err)
    return null
  }
}

export async function concluirSaida(admin: SupabaseClient, mensagemId: string | null | undefined, ok: boolean, waId: string | null, erro?: string | null) {
  if (!mensagemId) return
  try {
    const { error } = await admin.rpc('whatsapp_concluir_saida', { p_mensagem: mensagemId, p_ok: ok, p_wa_id: waId, p_erro: erro ?? null })
    if (error) throw error
  } catch (err) {
    console.warn('[whatsapp] histórico: não foi possível concluir a saída', (err as Error)?.message ?? err)
  }
}

/**
 * O eco de uma mensagem nossa? (fromMe no webhook) Pelo id do provedor ou pelo mesmo
 * texto para o mesmo número há menos de 2 minutos.
 */
export async function ehSaidaNossa(admin: SupabaseClient, restauranteId: string, telefone: string, waId: string, texto: string | null): Promise<boolean> {
  const { data: porId } = await admin.from('whatsapp_mensagens').select('id').eq('restaurante_id', restauranteId).eq('wa_id', waId).neq('origem', 'loja').limit(1)
  if ((porId ?? []).length) return true
  const h = await hashTexto(texto)
  if (!h) return false
  const { data: conversa } = await admin.from('whatsapp_conversas').select('id').eq('restaurante_id', restauranteId).eq('telefone', telefone).maybeSingle()
  if (!conversa) return false
  const { data } = await admin
    .from('whatsapp_mensagens')
    .select('id')
    .eq('conversa_id', conversa.id)
    .eq('texto_hash', h)
    .in('origem', ['atendente', 'robo', 'automatico', 'disparo'])
    .gte('criado_em', new Date(Date.now() - 2 * 60_000).toISOString())
    .limit(1)
  return (data ?? []).length > 0
}
