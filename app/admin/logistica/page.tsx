import { redirect } from 'next/navigation'

/**
 * Item 58: "Logística" virou "Pedidos" (/admin/lista-pedidos). O endereço antigo continua
 * funcionando e leva para lá, com a aba de Entregadores preservada (?tab=entregadores).
 */
export default async function LogisticaAntiga({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const tab = typeof sp.tab === 'string' && sp.tab === 'entregadores' ? '?tab=entregadores' : ''
  redirect(`/admin/lista-pedidos${tab}`)
}
