import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPORTE_MENUZIA } from '@/lib/suporte'

/**
 * MÓDULOS PAGOS (0176, 10/10/2026): Financeiro, Agente de IA e Disparos ficam com cadeado até o Super Admin liberar
 * na loja. Todo o resto é livre. A ÚNICA checagem é `moduloLiberado()` (SQL modulo_liberado / auth_modulo_liberado):
 *   · middleware: páginas e APIs do módulo bloqueado → 403 (API) ou a tela do cadeado (página);
 *   · /api/sessao/estado: o menu mostra o item meio apagado com cadeado;
 *   · lib/financeiro/contexto.ts e o cron de campanhas: nada roda para loja bloqueada.
 */
export const MODULOS = ['financeiro', 'agente_ia', 'disparos'] as const
export type Modulo = (typeof MODULOS)[number]
export type ModulosDaLoja = Record<Modulo, boolean>

export const INFO_MODULO: Record<Modulo, { nome: string; frase: string; href: string }> = {
  financeiro: { nome: 'Financeiro', href: '/admin/financeiro', frase: 'Caixa, contas, compras, DRE e lucro: todo o dinheiro que entra e sai da loja num lugar só.' },
  agente_ia: { nome: 'Agente de IA', href: '/admin/agente-ia', frase: 'Um atendente com inteligência artificial que conversa com o cliente no WhatsApp e tira o pedido sozinho.' },
  disparos: { nome: 'Disparo de mensagens', href: '/admin/campanhas', frase: 'Campanhas de WhatsApp para a sua base de clientes: promoções, cupons e reativação de quem sumiu.' },
}

/** Páginas e APIs de cada módulo (prefixos). O robô simples do WhatsApp (/api/admin/whatsapp) é livre. */
const PREFIXOS: Record<Modulo, string[]> = {
  financeiro: ['/admin/financeiro', '/api/admin/financeiro'],
  agente_ia: ['/admin/agente-ia', '/api/admin/agente-ia'],
  disparos: ['/admin/campanhas', '/api/admin/campanhas'],
}

/** Livres mesmo dentro de um prefixo pago: as mensagens automáticas de STATUS do pedido (Ajustes) usam a API de Campanhas. */
const LIVRES = ['/api/admin/campanhas/automaticas']

/** De qual módulo pago é este caminho (null = livre). Pura. */
export function moduloDoCaminho(pathname: string): Modulo | null {
  if (LIVRES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null
  for (const m of MODULOS) if (PREFIXOS[m].some((p) => pathname === p || pathname.startsWith(`${p}/`))) return m
  return null
}

export const nenhumLiberado = (): ModulosDaLoja => ({ financeiro: false, agente_ia: false, disparos: false })

/** A checagem única no servidor (service_role). Erro de banco = bloqueado (falha para o lado fechado). */
export async function moduloLiberado(admin: SupabaseClient, restauranteId: string, modulo: Modulo): Promise<boolean> {
  const { data, error } = await admin.rpc('modulo_liberado', { p_restaurante: restauranteId, p_modulo: modulo })
  return !error && data === true
}

/** Os três de uma vez (menu, Super Admin). Usa a mesma regra: sem linha = bloqueado. */
export async function modulosDaLoja(admin: SupabaseClient, restauranteId: string): Promise<ModulosDaLoja> {
  const r = await Promise.all(MODULOS.map((m) => moduloLiberado(admin, restauranteId, m)))
  return Object.fromEntries(MODULOS.map((m, i) => [m, r[i]])) as ModulosDaLoja
}

/** Resposta 403 padrão de módulo bloqueado (APIs). */
export function corpoBloqueado(modulo: Modulo) {
  return { error: `O módulo ${INFO_MODULO[modulo].nome} não está liberado nesta loja.`, codigo: 'modulo_bloqueado', modulo }
}

/** WhatsApp comercial (Coolify: WHATSAPP_COMERCIAL_MENUZIA); sem ele, o suporte. Só dígitos. */
export function whatsappComercial(env: Record<string, string | undefined> = process.env): string {
  const n = (env.WHATSAPP_COMERCIAL_MENUZIA ?? '').replace(/\D/g, '')
  return n.length >= 10 ? n : SUPORTE_MENUZIA.whatsapp
}

export function linkQueroLiberar(numero: string, modulo: Modulo, loja: string): string {
  const texto = `Olá! Quero liberar o módulo ${INFO_MODULO[modulo].nome} na loja ${loja}.`
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
}
