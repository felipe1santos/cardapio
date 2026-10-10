import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lerAgenteToken } from '@/lib/agente-token'
import { resolverRestauranteIdPorToken } from '@/lib/queries/impressao'
import { deveGravarIp, ipDoRequest } from '@/lib/impressao/atualizacao-bloqueio'

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

/**
 * Convite de pareamento SEM código (noite 5, Assistente 0.2.0-beta.10): 24 caracteres do mesmo
 * alfabeto, vale 24 h e uma vez. Viaja dentro do link menuzia://parear?c=… ou no nome do
 * instalador baixado pelo painel — ninguém digita. Mesmo hash e mesma tabela do código.
 */
export const VALIDADE_CONVITE_H = 24
export function gerarConvitePareamento(): { convite: string; hash: string } {
  let bruto = ''
  for (let i = 0; i < 24; i++) bruto += ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)]
  return { convite: bruto, hash: hashCodigo(bruto) }
}
export function conviteValido(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const n = v.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return n.length === 24 && [...n].every((c) => ALFABETO_CODIGO.includes(c))
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
// IP de cada computador (0172): o latest.yml da atualização automática reconhece a loja que não atualiza (Villa).
// Em memória por instância, no máximo a cada 10 min; best-effort (nunca atrasa nem derruba a busca de pedidos).
const ultimoIp = new Map<string, { ip: string; em: number }>()
function gravarIp(admin: SupabaseClient, agenteId: string, ip: string | null) {
  if (!ip) return
  const agora = Date.now()
  if (!deveGravarIp(ultimoIp.get(agenteId), ip, agora)) return
  ultimoIp.set(agenteId, { ip, em: agora })
  void admin.from('impressao_agentes').update({ visto_ip: ip }).eq('id', agenteId).then(() => {}, () => {})
}

export async function identificarAgente(admin: SupabaseClient, request: Request): Promise<IdentidadeAgente | null> {
  const bruto = lerAgenteToken(request)
  if (!bruto) return null
  if (bruto.startsWith(PREFIXO_CREDENCIAL)) {
    if (bruto.length < 40 || bruto.length > 80) return null
    const versao = (request.headers.get('x-agente-versao') ?? '').slice(0, 20) || null
    const { data, error } = await admin.rpc('impressao_agente_autenticar', { p_credencial_hash: hashSha256(bruto), p_versao: versao })
    if (error) throw error
    const linha = ((data ?? []) as { agente_id: string; restaurante_id: string; nome: string }[])[0]
    if (linha) gravarIp(admin, linha.agente_id, ipDoRequest(request.headers))
    return linha ? { tipo: 'agente', agenteId: linha.agente_id, restauranteId: linha.restaurante_id, nome: linha.nome } : null
  }
  const restauranteId = await resolverRestauranteIdPorToken(admin, bruto)
  return restauranteId ? { tipo: 'legado', restauranteId } : null
}
