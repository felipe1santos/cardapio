import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Alertas para o dono (0132): ficam no painel (Financeiro › Auditoria e Alertas) e, se a loja
 * configurou o número do dono, os GRAVES também vão pelo WhatsApp da própria loja — só para esse
 * número (nunca para cliente). Falha no WhatsApp não derruba nada.
 */
export type Gravidade = 'info' | 'atencao' | 'grave'

export interface NovoAlerta {
  restauranteId: string
  tipo: string
  gravidade: Gravidade
  mensagem: string
  dados?: Record<string, unknown>
  usuario?: { id: string | null; nome: string } | null
  /** Não repete o mesmo tipo+chave dentro desta janela (minutos). */
  dedupeMin?: number
  dedupeChave?: string
}

export async function criarAlerta(admin: SupabaseClient, a: NovoAlerta): Promise<string | null> {
  try {
    if (a.dedupeMin) {
      const desde = new Date(Date.now() - a.dedupeMin * 60_000).toISOString()
      let q = admin.from('fin_alertas').select('id').eq('restaurante_id', a.restauranteId).eq('tipo', a.tipo).gte('criado_em', desde)
      if (a.dedupeChave) q = q.eq('dados->>chave', a.dedupeChave)
      const { data } = await q.limit(1)
      if (data?.length) return null
    }
    const { data, error } = await admin.from('fin_alertas').insert({
      restaurante_id: a.restauranteId, tipo: a.tipo, gravidade: a.gravidade, mensagem: a.mensagem.slice(0, 500),
      dados: { ...(a.dados ?? {}), ...(a.dedupeChave ? { chave: a.dedupeChave } : {}) },
      usuario_id: a.usuario?.id ?? null, usuario_nome: a.usuario?.nome ?? null,
    }).select('id').single()
    if (error) throw error
    if (a.gravidade === 'grave') void avisarDonoNoWhatsapp(admin, a.restauranteId, data.id as string, a.mensagem)
    return data.id as string
  } catch (e) {
    console.error('[financeiro] alerta não registrado:', (e as Error).message?.slice(0, 160))
    return null
  }
}

async function avisarDonoNoWhatsapp(admin: SupabaseClient, restauranteId: string, alertaId: string, mensagem: string) {
  try {
    const [{ data: cfg }, { data: loja }] = await Promise.all([
      admin.from('fin_config').select('alerta_whatsapp').eq('restaurante_id', restauranteId).maybeSingle(),
      admin.from('restaurantes').select('evolution_instance, nome').eq('id', restauranteId).maybeSingle(),
    ])
    const numero = cfg?.alerta_whatsapp as string | undefined
    if (!numero || !loja?.evolution_instance) return
    const { enviarWhatsapp } = await import('@/lib/whatsapp')
    const ok = await enviarWhatsapp(numero, `⚠️ *Alerta do financeiro — ${loja.nome}*\n${mensagem}`, loja.evolution_instance as string, { admin, origem: 'automatico', restauranteId })
    if (ok) await admin.from('fin_alertas').update({ whatsapp_enviado_em: new Date().toISOString() }).eq('id', alertaId)
  } catch (e) {
    console.error('[financeiro] WhatsApp do alerta falhou:', (e as Error).message?.slice(0, 160))
  }
}
