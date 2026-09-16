import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Trilha de auditoria — append-only.
 *
 * `eventos_auditoria` não aceita escrita de usuário autenticado (0062): só passa por
 * `service_role`, ou seja, por este helper, chamado de rotas de servidor.
 */

/** Chaves que nunca entram em `dados`, nem aninhadas. */
const PROIBIDAS = [
  'senha', 'password', 'token', 'cookie', 'secret', 'chave', 'apikey', 'api_key',
  'authorization', 'email', 'telefone', 'payload', 'body',
]

/**
 * Remove o que não pode ser gravado.
 *
 * A auditoria registra QUEM fez O QUÊ — não o conteúdo da requisição. Um `dados` com
 * senha ou token viraria um vazamento com carimbo de data.
 */
export function sanearDados(dados: unknown, profundidade = 0): Record<string, unknown> {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados) || profundidade > 3) return {}
  const saida: Record<string, unknown> = {}

  for (const [chave, valor] of Object.entries(dados as Record<string, unknown>)) {
    const nome = chave.toLowerCase()
    if (PROIBIDAS.some((p) => nome.includes(p))) continue

    if (valor === null || ['string', 'number', 'boolean'].includes(typeof valor)) {
      saida[chave] = typeof valor === 'string' ? valor.slice(0, 200) : valor
    } else if (typeof valor === 'object' && !Array.isArray(valor)) {
      saida[chave] = sanearDados(valor, profundidade + 1)
    }
    // Arrays ficam de fora: o que interessa é o resumo (quantos), não o conteúdo.
  }
  return saida
}

export interface EventoAuditoria {
  restauranteId: string
  /** Ausente = evento do sistema (cron, webhook), sem inventar usuário. */
  usuarioId?: string | null
  usuarioNome: string
  acao: string
  entidade: string
  entidadeId?: string | null
  dados?: unknown
}

export async function registrarAuditoria(admin: SupabaseClient, evento: EventoAuditoria): Promise<void> {
  const { error } = await admin.from('eventos_auditoria').insert({
    restaurante_id: evento.restauranteId,
    ator: evento.usuarioId ? 'usuario' : 'sistema',
    usuario_id: evento.usuarioId ?? null,
    usuario_nome: evento.usuarioNome,
    acao: evento.acao,
    entidade: evento.entidade,
    entidade_id: evento.entidadeId ?? null,
    dados: sanearDados(evento.dados),
  })
  // Auditoria não pode derrubar a operação que ela observa: registra e segue.
  if (error) console.error('[auditoria] falhou ao registrar', evento.acao, error.message)
}
