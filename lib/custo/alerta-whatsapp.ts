import type { SupabaseClient } from '@supabase/supabase-js'
import { provedorAtual } from '@/lib/mensageria/provedor'
import { SUPORTE_MENUZIA } from '@/lib/suporte'

/**
 * Alerta de GASTO ALTO nas APIs pagas no WhatsApp do suporte Menuzia (10/10/2026, pedido do dono): 80% do limite,
 * limite atingido, loop (disparo) e teto da IA. Sai pela instância de WhatsApp da loja Menuzia para o número de
 * suporte (SUPORTE_MENUZIA). Uma mensagem por assunto a cada 60 min; nunca derruba nada (falha só vai para o log).
 */
const enviados = new Map<string, number>()
const JANELA_MS = 60 * 60_000

export async function avisarSuporte(admin: SupabaseClient, assunto: string, texto: string): Promise<void> {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return
  const agora = Date.now()
  const antes = enviados.get(assunto)
  if (antes && agora - antes < JANELA_MS) return
  enviados.set(assunto, agora)
  try {
    const { data } = await admin.from('restaurantes').select('evolution_instance').eq('slug', 'menuzia').maybeSingle()
    const instancia = (data as { evolution_instance?: string | null } | null)?.evolution_instance
    if (!instancia) { console.error('[custo] alerta no WhatsApp: a Menuzia não tem WhatsApp conectado'); return }
    const r = await provedorAtual().enviarTexto(instancia, SUPORTE_MENUZIA.whatsapp, `⚠️ Menuzia — custo de API\n${texto}`)
    if (!r.ok) console.error('[custo] alerta no WhatsApp falhou:', r.erro)
  } catch (e) {
    console.error('[custo] alerta no WhatsApp falhou:', (e as Error).message)
  }
}
