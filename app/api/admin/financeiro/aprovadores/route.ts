import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { normalizarAcessos } from '@/lib/acessos'
import { podeFin } from '@/lib/financeiro/permissoes'

/**
 * Quem pode aprovar com o PIN (Fase 2): da mesma loja, ativo, com PIN e com a permissão "aprovar".
 * Nunca a própria pessoa — ninguém aprova a própria ação (o servidor confere de novo ao aprovar).
 */
export async function GET() {
  const c = await contextoFinanceiro()
  if ('erro' in c) return c.erro
  const { data } = await c.admin.from('usuarios').select('id, nome, papel, acessos, pin_hash')
    .eq('restaurante_id', c.sessao.restauranteId).is('desativado_em', null).order('nome')
  const lista = (data ?? [])
    .filter((u) => u.id !== c.sessao.userId && !!u.pin_hash && podeFin(u.papel as string, normalizarAcessos(u.acessos), 'aprovar'))
    .map((u) => ({ id: u.id as string, nome: u.nome as string }))
  return NextResponse.json({ aprovadores: lista }, { headers: { 'Cache-Control': 'no-store' } })
}
