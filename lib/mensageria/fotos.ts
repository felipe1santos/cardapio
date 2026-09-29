/**
 * Foto de perfil dos contatos na central de atendimento (0108).
 *
 * Feito para NÃO pesar:
 * - só o LINK é guardado (a imagem mora no WhatsApp e o navegador carrega de lá);
 * - o navegador só pede foto de quem está aparecendo na lista, no máximo 10 por vez;
 * - cada link vale 3 dias; falha na consulta espera 1 h para tentar de novo;
 * - link que quebrou na tela (o do WhatsApp expira) só é renovado se tiver mais de 1 h;
 * - no máximo 3 consultas ao mesmo tempo e 30 por minuto por loja (as que passarem
 *   do limite ficam para o próximo pedido, sem erro);
 * - tabela própria, fora do Realtime: gravar foto não acorda painel nenhum.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProvedorWhatsapp } from './provedor'

export const VALIDADE_FOTO_MS = 3 * 24 * 60 * 60_000
export const RETENTAR_FALHA_MS = 60 * 60_000
export const RENOVAR_QUEBRADA_MS = 60 * 60_000
export const MAX_FOTOS_POR_PEDIDO = 10
export const MAX_CONSULTAS_POR_MINUTO = 30
const CONSULTAS_SIMULTANEAS = 3

export interface FotoGuardada {
  url: string | null
  buscadaEm: string
}

/** Precisa consultar o WhatsApp? (puro, testado) */
export function precisaBuscar(guardada: FotoGuardada | undefined, agora: number, quebrouNaTela = false): boolean {
  if (!guardada) return true
  const idade = agora - new Date(guardada.buscadaEm).getTime()
  if (!(idade >= 0)) return false
  if (quebrouNaTela) return idade >= RENOVAR_QUEBRADA_MS
  return idade >= VALIDADE_FOTO_MS
}

/** Janela de 1 minuto por loja, na memória do processo (proteção, não contabilidade). */
const consultas = new Map<string, number[]>()
export function reservarConsultas(loja: string, quantas: number, agora = Date.now()): number {
  const recentes = (consultas.get(loja) ?? []).filter((t) => agora - t < 60_000)
  const livres = Math.max(0, Math.min(quantas, MAX_CONSULTAS_POR_MINUTO - recentes.length))
  for (let i = 0; i < livres; i++) recentes.push(agora)
  consultas.set(loja, recentes)
  return livres
}

export async function fotosGuardadas(admin: SupabaseClient, restauranteId: string, telefones: string[]): Promise<Map<string, FotoGuardada>> {
  const mapa = new Map<string, FotoGuardada>()
  if (!telefones.length) return mapa
  const { data } = await admin.from('whatsapp_contato_fotos').select('telefone, url, buscada_em').eq('restaurante_id', restauranteId).in('telefone', telefones)
  for (const f of (data ?? []) as { telefone: string; url: string | null; buscada_em: string }[]) mapa.set(f.telefone, { url: f.url, buscadaEm: f.buscada_em })
  return mapa
}

/**
 * Devolve a foto (ou null) de cada telefone pedido — do cache quando ainda vale, do
 * WhatsApp quando precisa. Telefones que não são conversas desta loja são ignorados.
 */
export async function obterFotos(
  admin: SupabaseClient,
  provedor: ProvedorWhatsapp,
  restauranteId: string,
  instancia: string | null,
  telefones: string[],
  quebradas: string[] = [],
): Promise<Record<string, string | null>> {
  const pedidos = [...new Set([...telefones, ...quebradas])].filter((t) => /^[0-9]{10,15}$/.test(t)).slice(0, MAX_FOTOS_POR_PEDIDO)
  if (!pedidos.length) return {}
  const { data: daLoja } = await admin.from('whatsapp_conversas').select('telefone').eq('restaurante_id', restauranteId).in('telefone', pedidos)
  const validos = ((daLoja ?? []) as { telefone: string }[]).map((c) => c.telefone)
  const guardadas = await fotosGuardadas(admin, restauranteId, validos)
  const agora = Date.now()
  const quebrou = new Set(quebradas)
  const resposta: Record<string, string | null> = {}
  const buscar: string[] = []
  for (const t of validos) {
    const g = guardadas.get(t)
    if (instancia && precisaBuscar(g, agora, quebrou.has(t))) buscar.push(t)
    else resposta[t] = g?.url ?? null
  }

  const liberadas = reservarConsultas(restauranteId, buscar.length, agora)
  const agoraVai = buscar.slice(0, liberadas)
  for (const t of buscar.slice(liberadas)) resposta[t] = guardadas.get(t)?.url ?? null

  const gravar: { restaurante_id: string; telefone: string; url: string | null; buscada_em: string }[] = []
  for (let i = 0; i < agoraVai.length; i += CONSULTAS_SIMULTANEAS) {
    const lote = agoraVai.slice(i, i + CONSULTAS_SIMULTANEAS)
    const r = await Promise.all(lote.map((t) => provedor.fotoDePerfil(instancia as string, t).catch(() => ({ ok: false as const }))))
    lote.forEach((t, k) => {
      const x = r[k]
      if (x.ok) {
        resposta[t] = x.url
        gravar.push({ restaurante_id: restauranteId, telefone: t, url: x.url, buscada_em: new Date().toISOString() })
      } else {
        // Não deu para saber: mantém o que tinha e só tenta de novo daqui a 1 h.
        const g = guardadas.get(t)
        resposta[t] = g?.url ?? null
        gravar.push({ restaurante_id: restauranteId, telefone: t, url: g?.url ?? null, buscada_em: new Date(Date.now() - VALIDADE_FOTO_MS + RETENTAR_FALHA_MS).toISOString() })
      }
    })
  }
  if (gravar.length) await admin.from('whatsapp_contato_fotos').upsert(gravar, { onConflict: 'restaurante_id,telefone' })
  return resposta
}
