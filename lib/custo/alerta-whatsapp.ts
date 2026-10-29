import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarAlertaSistema } from '@/lib/saude/enviar'

/**
 * Alerta de GASTO ALTO nas APIs pagas (10/10/2026, pedido do dono): 80% do limite, limite atingido, loop (disparo) e teto
 * da IA. Uma mensagem por assunto a cada 60 min; nunca derruba nada (falha só vai para o log).
 * 28/10: saía só pelo WhatsApp da loja Menuzia — desconectado desde 23/10, ninguém recebia. Agora usa o mesmo envio do
 * vigia (instância de alertas → Menuzia → push no painel) e grava no histórico do Super Admin › Saúde do sistema.
 */
const enviados = new Map<string, number>()
const JANELA_MS = 60 * 60_000

/** Loop, bloqueio e teto = vermelho; 80% = amarelo. Pura. */
export function nivelDoAssunto(assunto: string): 'vermelho' | 'amarelo' {
  return /:(disparo|bloqueio)|teto/.test(assunto) ? 'vermelho' : 'amarelo'
}

type Enviar = typeof enviarAlertaSistema

export async function avisarSuporte(admin: SupabaseClient, assunto: string, texto: string, janelaMs = JANELA_MS, enviar?: Enviar): Promise<void> {
  if (!enviar && (process.env.VITEST || process.env.NODE_ENV === 'test')) return
  const agora = Date.now()
  const antes = enviados.get(assunto)
  if (antes && agora - antes < janelaMs) return
  enviados.set(assunto, agora)
  try {
    const nivel = nivelDoAssunto(assunto)
    const corpo = `${nivel === 'vermelho' ? '🔴' : '🟡'} Menuzia — custo de API\n${texto}`
    const r = await (enviar ?? enviarAlertaSistema)(admin, 'Custo de API', corpo)
    await admin.from('sistema_alertas').insert({ assunto: `custo:${assunto}`, nivel, texto: corpo, canal: r.canal, enviado: r.canal !== 'nenhum', erro: r.erro })
  } catch (e) {
    console.error('[custo] alerta falhou:', (e as Error).message)
  }
}
