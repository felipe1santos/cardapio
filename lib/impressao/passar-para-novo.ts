import type { SupabaseClient } from '@supabase/supabase-js'
import { compararVersao } from '@/lib/avisos-painel'
import { ehImpressoraVirtual } from '@/lib/impressao/regras-modo'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Passagem automática para o assistente novo (09/10, decisão do dono: "assistente definitivo").
 *
 * Loja marcada "só assistente novo" (impressao_somente_nova) que ainda imprime pelo antigo passa
 * SOZINHA no instante em que um computador com o Assistente 0.2.0-beta.11+ conecta e manda a lista
 * de impressoras — sem a loja configurar nada:
 *   1. Cozinha: a impressora com o MESMO nome da que o assistente antigo usava; senão, a única
 *      impressora real (não virtual) do computador. Sem como saber qual é, não passa (a tela pede).
 *   2. Pré-conta: a mesma da cozinha, se ainda não houver.
 *   3. Pedidos já concluídos e não impressos são marcados como impressos (nada sai acumulado).
 *   4. Modo "Cozinha e Caixa" pela função oficial (confere e audita).
 * Rápida quando não há o que fazer (uma leitura), porque roda a cada sinal do computador.
 */
export const VERSAO_MINIMA_PASSAGEM = '0.2.0-beta.11'
const ATOR = 'Sistema (passagem automática)'

export async function tentarPassarParaNovo(admin: SupabaseClient, agenteId: string): Promise<'passou' | null> {
  const { data: ag } = await admin.from('impressao_agentes').select('id, restaurante_id, versao, revogado_em, visto_em').eq('id', agenteId).maybeSingle()
  if (!ag || ag.revogado_em || compararVersao(ag.versao as string | null, VERSAO_MINIMA_PASSAGEM) < 0) return null
  const loja = ag.restaurante_id as string
  const { data: r } = await admin.from('restaurantes').select('impressao_somente_nova, impressao_beta_modo, impressao_beta_liberado').eq('id', loja).maybeSingle()
  if (!r?.impressao_somente_nova || r.impressao_beta_modo === 'cozinha_caixa' || !r.impressao_beta_liberado) return null

  const { data: funcoes } = await admin.from('impressao_funcoes').select('funcao, dispositivo_id').eq('restaurante_id', loja)
  let cozinha = (funcoes ?? []).find((f) => f.funcao === 'cozinha')?.dispositivo_id as string | undefined
  if (!cozinha) {
    const { data: disp } = await admin.from('impressao_dispositivos').select('id, nome_sistema, disponivel').eq('agente_id', agenteId).eq('disponivel', true)
    const lista = (disp ?? []) as { id: string; nome_sistema: string }[]
    const { data: antigas } = await admin.from('impressoras').select('nome, ativa').eq('restaurante_id', loja).order('ativa', { ascending: false })
    const nomeAntigo = ((antigas ?? []) as { nome: string }[]).map((a) => a.nome.trim().toLowerCase())
    const reais = lista.filter((d) => !ehImpressoraVirtual(d.nome_sistema))
    const alvo = lista.find((d) => nomeAntigo.includes(d.nome_sistema.trim().toLowerCase())) ?? (reais.length === 1 ? reais[0] : undefined)
    if (!alvo) return null
    cozinha = alvo.id
    await admin.from('impressao_funcoes').upsert({ restaurante_id: loja, funcao: 'cozinha', dispositivo_id: cozinha, atribuido_em: new Date().toISOString(), atribuido_por_nome: ATOR })
  }
  if (!(funcoes ?? []).some((f) => f.funcao === 'caixa')) {
    await admin.from('impressao_funcoes').upsert({ restaurante_id: loja, funcao: 'caixa', dispositivo_id: cozinha, atribuido_em: new Date().toISOString(), atribuido_por_nome: ATOR })
  }
  await admin.from('impressao_dispositivos').update({ na_lista: true }).eq('id', cozinha)
  const { data: marcados } = await admin.from('pedidos').update({ impresso: true }).eq('restaurante_id', loja).eq('impresso', false).in('status', ['entregue', 'cancelado']).select('numero')
  const { error } = await admin.rpc('impressao_modo_definir', { p_restaurante: loja, p_modo: 'cozinha_caixa', p_ator: null, p_ator_nome: ATOR })
  if (error) {
    console.error('[passagem automática]', loja, error.message)
    return null
  }
  await registrarAuditoria(admin, {
    restauranteId: loja, usuarioNome: ATOR, acao: 'impressao.passou_para_novo', entidade: 'restaurante', entidadeId: loja,
    dados: { resumo: 'Passou sozinha para o assistente novo', agente_id: agenteId, versao: ag.versao, cozinha, concluidos_marcados: (marcados ?? []).length },
  }).catch(() => {})
  return 'passou'
}
