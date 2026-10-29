import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Alerta de GASTO ALTO nas APIs pagas (10/10/2026, pedido do dono): 80% do limite, limite atingido, loop (disparo) e teto
 * da IA. Um por assunto a cada 60 min; nunca derruba nada (falha só vai para o log).
 * 28/10: saía só pelo WhatsApp da loja Menuzia — desconectado desde 23/10, ninguém recebia. Agora fica PENDENTE no
 * histórico do Super Admin › Saúde do sistema e o cron do servidor envia (lib/saude/vigia.ts › despacharPendentes:
 * instância de alertas → Menuzia → push). Sem importar o envio aqui: a guarda também entra no código do navegador
 * (frete), que não pode puxar o web-push (B6, lib/guardas/bundle-cliente.test.ts).
 */
const enviados = new Map<string, number>()
const JANELA_MS = 60 * 60_000

/** Loop, bloqueio e teto = vermelho; 80% = amarelo. Pura. */
export function nivelDoAssunto(assunto: string): 'vermelho' | 'amarelo' {
  return /:(disparo|bloqueio)|teto/.test(assunto) ? 'vermelho' : 'amarelo'
}

export async function avisarSuporte(admin: SupabaseClient, assunto: string, texto: string, janelaMs = JANELA_MS, emTeste = false): Promise<void> {
  if (!emTeste && (process.env.VITEST || process.env.NODE_ENV === 'test')) return
  const agora = Date.now()
  const antes = enviados.get(assunto)
  if (antes && agora - antes < janelaMs) return
  enviados.set(assunto, agora)
  try {
    const nivel = nivelDoAssunto(assunto)
    await admin.from('sistema_alertas').insert({
      assunto: `custo:${assunto}`, nivel, texto: `${nivel === 'vermelho' ? '🔴' : '🟡'} Menuzia — custo de API\n${texto}`, canal: null, enviado: false,
    })
    // O cron envia na próxima rodada (1 min) em vez de esperar a conferência de 5 min.
    ;(globalThis as unknown as { __menuziaAlertaPendente?: boolean }).__menuziaAlertaPendente = true
  } catch (e) {
    console.error('[custo] alerta falhou:', (e as Error).message)
  }
}
