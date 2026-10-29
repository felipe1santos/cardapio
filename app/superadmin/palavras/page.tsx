import { getAdminSupabase } from '@/lib/supabase/admin'
import { PalavrasGlobais, type PalavraGlobal } from '@/components/superadmin/palavras-globais'
import { ShellHp } from '@/components/superadmin/hp'

export const dynamic = 'force-dynamic'

/**
 * Super Admin › Palavras do robô (16/10/2026). Palavra genérica ensinada numa loja chega como sugestão; aprovada, vale
 * para todas as lojas. O layout de /superadmin já barra quem não é superadmin; a ação confere de novo.
 */
export default async function PalavrasPage() {
  const admin = getAdminSupabase()
  const [{ data }, { data: lojas }] = await Promise.all([
    admin.from('robo_palavras_globais').select('id, palavra, assunto, status, vezes, origem_restaurante_id, criado_em').order('status').order('vezes', { ascending: false }).limit(500),
    admin.from('restaurantes').select('id, nome'),
  ])
  const nomes = Object.fromEntries(((lojas ?? []) as { id: string; nome: string }[]).map((l) => [l.id, l.nome]))
  const itens: PalavraGlobal[] = ((data ?? []) as (Omit<PalavraGlobal, 'loja'> & { origem_restaurante_id: string | null })[])
    .map((p) => ({ id: p.id, palavra: p.palavra, assunto: p.assunto, status: p.status, vezes: p.vezes, criado_em: p.criado_em, loja: p.origem_restaurante_id ? nomes[p.origem_restaurante_id] ?? '—' : '—' }))
  return <ShellHp aba="palavras" titulo="Palavras do robô"><PalavrasGlobais itens={itens} /></ShellHp>
}
