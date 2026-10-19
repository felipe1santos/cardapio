import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPORTE_MENUZIA } from '@/lib/suporte'

/**
 * MÓDULOS PAGOS (0176, 10/10/2026): Financeiro, Agente de IA e Disparos ficam com cadeado até o Super Admin liberar
 * na loja. Todo o resto é livre. A ÚNICA checagem é `moduloLiberado()` (SQL modulo_liberado / auth_modulo_liberado):
 *   · middleware: páginas e APIs do módulo bloqueado → 403 (API) ou a tela do cadeado (página);
 *   · /api/sessao/estado: o menu mostra o item meio apagado com cadeado;
 *   · lib/financeiro/contexto.ts e o cron de campanhas: nada roda para loja bloqueada.
 */
// 'entregas_lalamove' (0199, 18/10): chamar entregador da Lalamove pelo Kanban. Liberado em todas as lojas por padrão
// (a corrida é paga pela própria loja); o Super Admin desliga por loja se precisar.
// Canais externos e entregadores (0207, 19/10, modo autônomo): DESLIGADOS por padrão em todas as lojas; o Super Admin liga por loja.
export const MODULOS = ['financeiro', 'agente_ia', 'disparos', 'entregas_lalamove', 'canal_opendelivery', 'canal_ifood', 'entregas_ifood', 'entregas_foody'] as const
export type Modulo = (typeof MODULOS)[number]
export type ModulosDaLoja = Record<Modulo, boolean>

export const INFO_MODULO: Record<Modulo, { nome: string; frase: string; href: string }> = {
  financeiro: { nome: 'Financeiro', href: '/admin/financeiro', frase: 'Caixa, contas, compras, DRE e lucro: todo o dinheiro que entra e sai da loja num lugar só.' },
  agente_ia: { nome: 'Agente de IA', href: '/admin/agente-ia', frase: 'Um atendente com inteligência artificial que conversa com o cliente no WhatsApp e tira o pedido sozinho.' },
  disparos: { nome: 'Disparo de mensagens', href: '/admin/campanhas', frase: 'Campanhas de WhatsApp para a sua base de clientes: promoções, cupons e reativação de quem sumiu.' },
  entregas_lalamove: { nome: 'Entregas Lalamove', href: '/admin/integracoes?abrir=lalamove', frase: 'Chame um entregador da Lalamove pelo Kanban, com preço antes de confirmar. A corrida é paga pela conta Lalamove da loja.' },
  canal_opendelivery: { nome: 'Pedidos Keeta e 99Food (Open Delivery)', href: '/admin/integracoes?abrir=opendelivery', frase: 'Pedidos da Keeta e do 99Food entram direto no Painel de Pedidos, com o status voltando para o app.' },
  canal_ifood: { nome: 'Pedidos iFood', href: '/admin/integracoes?abrir=ifood', frase: 'Pedidos do iFood entram direto no Painel de Pedidos, com aceite, pronto e despacho refletidos no iFood.' },
  entregas_ifood: { nome: 'Entregador iFood (Sob Demanda)', href: '/admin/integracoes?abrir=entregas-ifood', frase: 'Chame um entregador do iFood para pedidos de fora do iFood, com cotação antes de confirmar.' },
  entregas_foody: { nome: 'Entregas Foody', href: '/admin/integracoes?abrir=foody', frase: 'Chame um entregador da Foody Delivery pelo Kanban, com cotação antes de confirmar.' },
}

/** Páginas e APIs de cada módulo (prefixos). O robô simples do WhatsApp (/api/admin/whatsapp) é livre. */
const PREFIXOS: Record<Modulo, string[]> = {
  financeiro: ['/admin/financeiro', '/api/admin/financeiro'],
  agente_ia: ['/admin/agente-ia', '/api/admin/agente-ia'],
  disparos: ['/admin/campanhas', '/api/admin/campanhas'],
  entregas_lalamove: ['/api/admin/entregas/lalamove'],
  canal_opendelivery: ['/api/admin/canais/keeta', '/api/admin/canais/99food'],
  canal_ifood: ['/api/admin/canais/ifood'],
  entregas_ifood: ['/api/admin/entregas/ifood'],
  entregas_foody: ['/api/admin/entregas/foody'],
}

/** Livres mesmo dentro de um prefixo pago: as mensagens automáticas de STATUS do pedido (Ajustes) usam a API de Campanhas. */
// Push do app do cardápio é GRÁTIS (12/10): fica fora do módulo Disparos.
const LIVRES = ['/api/admin/campanhas/automaticas', '/api/admin/campanhas/push']

/** De qual módulo pago é este caminho (null = livre). Pura. */
export function moduloDoCaminho(pathname: string): Modulo | null {
  if (LIVRES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null
  for (const m of MODULOS) if (PREFIXOS[m].some((p) => pathname === p || pathname.startsWith(`${p}/`))) return m
  return null
}

export const nenhumLiberado = (): ModulosDaLoja => ({ financeiro: false, agente_ia: false, disparos: false, entregas_lalamove: false, canal_opendelivery: false, canal_ifood: false, entregas_ifood: false, entregas_foody: false })

/** A checagem única no servidor (service_role). Erro de banco = bloqueado (falha para o lado fechado). */
export async function moduloLiberado(admin: SupabaseClient, restauranteId: string, modulo: Modulo): Promise<boolean> {
  const { data, error } = await admin.rpc('modulo_liberado', { p_restaurante: restauranteId, p_modulo: modulo })
  return !error && data === true
}

/** Todos de uma vez (menu, Super Admin). Usa a mesma regra: sem linha = bloqueado. */
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
