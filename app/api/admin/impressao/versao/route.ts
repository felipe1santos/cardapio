import { NextResponse } from 'next/server'
import { contextoImpressao, semCache } from '@/lib/impressao/contexto'
import { precisaAtualizarAssistente, VERSAO_IMPRESSAO_V3 } from '@/lib/avisos-painel'

/**
 * A loja da sessão precisa atualizar o Assistente para o modelo v3? Só leitura. Alimenta o
 * aviso "Novo sistema de impressão disponível" (dono e gerente; os outros recebem 403 e não
 * veem o aviso).
 */
export async function GET() {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const { admin, op } = ctx
  const [loja, agentes] = await Promise.all([
    admin.from('restaurantes').select('impressao_ativar_assistente').eq('id', op.restauranteId).maybeSingle(),
    admin.from('impressao_agentes').select('versao, revogado_em').eq('restaurante_id', op.restauranteId),
  ])
  if (loja.error || agentes.error) return NextResponse.json({ precisaAtualizar: false }, { headers: semCache })
  const imprime = (loja.data as { impressao_ativar_assistente?: boolean } | null)?.impressao_ativar_assistente === true
  const lista = ((agentes.data ?? []) as { versao: string | null; revogado_em: string | null }[]).map((a) => ({ versao: a.versao, revogado: !!a.revogado_em }))
  return NextResponse.json({ precisaAtualizar: precisaAtualizarAssistente(imprime, lista), versaoAlvo: VERSAO_IMPRESSAO_V3 }, { headers: semCache })
}
