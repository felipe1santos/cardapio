import type { SupabaseClient } from '@supabase/supabase-js'
import { provedorAtual } from '@/lib/mensageria/provedor'
import { avisarPainelPedidoNovo } from '@/lib/push/painel-pedidos'
import { SUPORTE_MENUZIA } from '@/lib/suporte'

/**
 * Envio dos alertas do vigia (28/10/2026, Etapa 7). WhatsApp do dono pela instância de alertas do sistema
 * (ALERTAS_WHATSAPP_INSTANCIA, senão "menuzia-alertas"); fora do ar, pela instância da loja Menuzia (o caminho do alerta de
 * custo de 10/10). Conectar a de alertas: `node scripts/saude/qr-alertas.mjs` (mostra o QR).
 * Número: ALERTAS_WHATSAPP_NUMERO, senão o do suporte Menuzia. WhatsApp fora → push no painel da Menuzia.
 */
export type Canal = 'whatsapp' | 'push' | 'nenhum'
export const INSTANCIA_ALERTAS = 'menuzia-alertas'

async function lojaMenuzia(admin: SupabaseClient): Promise<{ id: string; instancia: string | null } | null> {
  const { data } = await admin.from('restaurantes').select('id, evolution_instance').eq('slug', 'menuzia').maybeSingle()
  const l = data as { id: string; evolution_instance: string | null } | null
  return l ? { id: l.id, instancia: l.evolution_instance } : null
}

export async function enviarAlertaSistema(admin: SupabaseClient, titulo: string, texto: string): Promise<{ canal: Canal; erro: string | null }> {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return { canal: 'nenhum', erro: 'teste' }
  const numero = process.env.ALERTAS_WHATSAPP_NUMERO || SUPORTE_MENUZIA.whatsapp
  let erro = 'whatsapp: sem instância de alertas'
  const loja = await lojaMenuzia(admin).catch(() => null)
  // Em ordem: a da variável, a instância própria "menuzia-alertas" (criada em 28/10) e a da loja Menuzia.
  const instancias = [...new Set([process.env.ALERTAS_WHATSAPP_INSTANCIA, INSTANCIA_ALERTAS, loja?.instancia].filter((i): i is string => !!i))]
  for (const instancia of instancias) {
    try {
      const r = await provedorAtual().enviarTexto(instancia, numero, texto, { semPrevia: true })
      if (r.ok) return { canal: 'whatsapp', erro: null }
      erro = `whatsapp ${instancia}: ${r.erro.slice(0, 120)}`
    } catch (e) {
      erro = `whatsapp ${instancia}: ${(e as Error).message}`
    }
  }
  if (loja) {
    try {
      const p = await avisarPainelPedidoNovo(admin, loja.id, { id: 'saude-sistema', numero: null }, undefined, { title: titulo, body: texto.split('\n').slice(1, 3).join(' ') })
      if (p.enviados > 0) return { canal: 'push', erro }
      erro += ' · push: nenhuma assinatura'
    } catch (e) {
      erro += ` · push: ${(e as Error).message}`
    }
  }
  console.error('[saude] alerta não entregue:', erro)
  return { canal: 'nenhum', erro }
}
