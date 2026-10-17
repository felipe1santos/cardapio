import type { SupabaseClient } from '@supabase/supabase-js'
import { jaEntende, sugestaoPorRegras, type Sugestao } from './aprender'
import { extrasComGlobais } from './motor'

/**
 * Preparo da lista "mensagens que o robô não entendeu" (16/10/2026), usado pela tela e pelo lote diário da IA:
 * reprocessa (o que o robô já entende sai sozinho) e grava a sugestão por regras de quem ainda não tem.
 */
export interface Pendente { id: string; texto: string; exemplo: string | null; vezes: number; ultima_em: string; contexto: string | null; sugestao: Sugestao | null }

export async function prepararPendentes(admin: SupabaseClient, restauranteId: string, limite = 200): Promise<{ ficam: Pendente[]; reprocessadas: number }> {
  const desde = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()
  const [{ data }, { data: cfg }] = await Promise.all([
    admin.from('whatsapp_auto_nao_entendidas').select('id, texto, exemplo, vezes, ultima_em, contexto, sugestao')
      .eq('restaurante_id', restauranteId).is('acao', null).gte('ultima_em', desde).order('vezes', { ascending: false }).order('ultima_em', { ascending: false }).limit(limite),
    admin.from('whatsapp_robo_config').select('auto_palavras').eq('restaurante_id', restauranteId).maybeSingle(),
  ])
  const extras = await extrasComGlobais(admin, { auto_palavras: (cfg?.auto_palavras as Record<string, string[]> | null) ?? null })
  const linhas = (data ?? []) as Pendente[]
  const entende = linhas.filter((l) => jaEntende(l.exemplo || l.texto, extras))
  if (entende.length) {
    await admin.from('whatsapp_auto_nao_entendidas').update({ acao: 'ja_entende', resolvido_em: new Date().toISOString(), resolvido_por: 'reprocessado' })
      .in('id', entende.map((l) => l.id)).eq('restaurante_id', restauranteId)
  }
  const ficam = linhas.filter((l) => !entende.includes(l))
  for (const l of ficam.filter((x) => !x.sugestao)) {
    l.sugestao = sugestaoPorRegras(l.exemplo || l.texto, extras)
    await admin.from('whatsapp_auto_nao_entendidas').update({ sugestao: l.sugestao }).eq('id', l.id).eq('restaurante_id', restauranteId)
  }
  return { ficam, reprocessadas: entende.length }
}
