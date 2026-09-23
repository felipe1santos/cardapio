import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lerAgenteToken } from '@/lib/agente-token'
import { resolverRestauranteIdPorToken } from '@/lib/queries/impressao'

/**
 * Credenciais do Assistente de Impressão — SÓ SERVIDOR.
 *
 * Dois jeitos de um Assistente se identificar:
 *   · agente (0.1.26+): `Authorization: Bearer mza_ag_<segredo>` — credencial própria do
 *     computador, trocada por um código de pareamento de uso único. O banco guarda só o
 *     sha256 (0088). Revogável sozinha.
 *   · legado: o token da loja (uuid), igual para todos os computadores. Continua valendo
 *     durante a transição; não identifica o computador.
 *
 * Nenhum valor de credencial, código ou token vai para log, auditoria ou resposta —
 * exceto a credencial nova, uma única vez, na resposta do pareamento.
 */

export const PREFIXO_CREDENCIAL = 'mza_ag_'
/** Sem 0/O, 1/I/L: o gerente dita o código em voz alta para quem está no computador. */
const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const VALIDADE_CODIGO_MIN = 10

export const hashSha256 = (valor: string) => createHash('sha256').update(valor, 'utf8').digest('hex')

/** Código de pareamento: 8 caracteres, mostrado como XXXX-XXXX. */
export function gerarCodigoPareamento(): { codigo: string; hash: string } {
  let bruto = ''
  for (let i = 0; i < 8; i++) bruto += ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)]
  return { codigo: `${bruto.slice(0, 4)}-${bruto.slice(4)}`, hash: hashCodigo(bruto) }
}

/** Normaliza o que foi digitado (minúscula, hífen, espaço) antes do hash. */
export function hashCodigo(digitado: string): string {
  return hashSha256(digitado.toUpperCase().replace(/[^A-Z0-9]/g, ''))
}

export function codigoValido(digitado: unknown): digitado is string {
  if (typeof digitado !== 'string') return false
  const n = digitado.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return n.length === 8 && [...n].every((c) => ALFABETO_CODIGO.includes(c))
}

export function gerarCredencial(): { credencial: string; hash: string } {
  const credencial = PREFIXO_CREDENCIAL + randomBytes(32).toString('base64url')
  return { credencial, hash: hashSha256(credencial) }
}

export type IdentidadeAgente =
  | { tipo: 'agente'; agenteId: string; restauranteId: string; nome: string }
  | { tipo: 'legado'; restauranteId: string }

/**
 * Quem está chamando. `null` = sem credencial ou credencial inválida/revogada.
 * Agente autenticado registra sinal de vida e versão (cabeçalho X-Agente-Versao).
 */
export async function identificarAgente(admin: SupabaseClient, request: Request): Promise<IdentidadeAgente | null> {
  const bruto = lerAgenteToken(request)
  if (!bruto) return null
  if (bruto.startsWith(PREFIXO_CREDENCIAL)) {
    if (bruto.length < 40 || bruto.length > 80) return null
    const versao = (request.headers.get('x-agente-versao') ?? '').slice(0, 20) || null
    const { data, error } = await admin.rpc('impressao_agente_autenticar', { p_credencial_hash: hashSha256(bruto), p_versao: versao })
    if (error) throw error
    const linha = ((data ?? []) as { agente_id: string; restaurante_id: string; nome: string }[])[0]
    return linha ? { tipo: 'agente', agenteId: linha.agente_id, restauranteId: linha.restaurante_id, nome: linha.nome } : null
  }
  const restauranteId = await resolverRestauranteIdPorToken(admin, bruto)
  return restauranteId ? { tipo: 'legado', restauranteId } : null
}
