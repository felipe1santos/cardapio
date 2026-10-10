import { redirect } from 'next/navigation'

/** A Impressão foi para Ajustes (10/10/2026): o endereço antigo leva para lá, com os mesmos parâmetros. */
export default async function ImpressaoAntiga({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(await searchParams)) for (const x of [v].flat()) if (typeof x === 'string') q.append(k, x)
  redirect(`/admin/ajustes/impressao${q.size ? `?${q}` : ''}`)
}
