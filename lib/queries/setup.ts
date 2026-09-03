import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConfigLoja } from './ajustes'
import type { DadosSetup } from '@/lib/setup-checklist'

/** Contagem de uma consulta `head: true`; consulta que falhou não vira alarme falso. */
function conta(resultado: PromiseSettledResult<{ count: number | null }>): number {
  return resultado.status === 'fulfilled' ? (resultado.value.count ?? 0) : 0
}

/**
 * Itens disponíveis que o cliente não consegue pedir por causa do cadastro:
 * preço zerado sem tabela de tamanhos (o pedido sai de graça) e item sem
 * nenhum dia da semana marcado (nunca aparece na vitrine).
 *
 * Vale duas consultas extras porque são erros silenciosos: nada no painel
 * denuncia, e o prejuízo aparece no caixa.
 */
async function contarItensQuebrados(
  supabase: SupabaseClient,
  restauranteId: string
): Promise<{ semPreco: number; semDia: number }> {
  const [semPrecoRes, semDiaRes] = await Promise.allSettled([
    // Só item simples: pizza tem o preço nos sabores/tamanhos padrão e vive com
    // `preco = 0` no cadastro — acusar isso seria alarme falso em toda pizzaria.
    supabase
      .from('itens_cardapio')
      .select('id')
      .eq('restaurante_id', restauranteId)
      .eq('status', 'disponivel')
      .eq('tipo_item', 'simples')
      .lte('preco', 0),
    supabase
      .from('itens_cardapio')
      .select('id', { count: 'exact', head: true })
      .eq('restaurante_id', restauranteId)
      .eq('status', 'disponivel')
      .eq('dias_disponiveis', '{}'),
  ])

  let semPreco = 0
  if (semPrecoRes.status === 'fulfilled') {
    const ids = ((semPrecoRes.value.data ?? []) as { id: string }[]).map((i) => i.id)
    if (ids.length > 0) {
      // Pizza, açaí e marmita têm preço na tabela de tamanhos — preço 0 no item
      // é o normal nesses casos, não um erro de cadastro.
      const comTamanho = await supabase.from('tamanhos_item').select('item_id').in('item_id', ids)
      const cobertos = new Set(((comTamanho.data ?? []) as { item_id: string }[]).map((t) => t.item_id))
      semPreco = ids.filter((id) => !cobertos.has(id)).length
    }
  }

  return { semPreco, semDia: conta(semDiaRes as PromiseSettledResult<{ count: number | null }>) }
}

/**
 * Retrato da loja para o checklist de configuração (ver lib/setup-checklist.ts).
 *
 * São quase só contagens: `head: true` faz o PostgREST devolver o total sem
 * trazer linha nenhuma, então isso roda a cada troca de rota do painel sem pesar.
 * `allSettled` porque uma consulta que falha não pode derrubar o checklist
 * inteiro — pior do que não avisar é avisar errado.
 */
export async function carregarDadosSetup(
  supabase: SupabaseClient,
  restauranteId: string,
  config: ConfigLoja
): Promise<DadosSetup> {
  const [disponiveis, semFoto, categorias, bairros, raios, entregadores] = await Promise.allSettled([
    supabase
      .from('itens_cardapio')
      .select('id', { count: 'exact', head: true })
      .eq('restaurante_id', restauranteId)
      .eq('status', 'disponivel'),
    supabase
      .from('itens_cardapio')
      .select('id', { count: 'exact', head: true })
      .eq('restaurante_id', restauranteId)
      .eq('status', 'disponivel')
      .is('imagem_url', null),
    supabase.from('grupos_cardapio').select('id', { count: 'exact', head: true }).eq('restaurante_id', restauranteId),
    supabase.from('taxas_entrega_bairro').select('id', { count: 'exact', head: true }).eq('restaurante_id', restauranteId),
    supabase.from('taxas_entrega_raio').select('id', { count: 'exact', head: true }).eq('restaurante_id', restauranteId),
    supabase.from('entregadores').select('id', { count: 'exact', head: true }).eq('restaurante_id', restauranteId),
  ])

  const quebrados = await contarItensQuebrados(supabase, restauranteId)

  return {
    config: {
      telefone: config.telefone ?? '',
      logoUrl: config.logoUrl,
      bannerUrl: config.bannerUrl,
      enderecoRua: config.enderecoRua ?? '',
      enderecoNumero: config.enderecoNumero ?? '',
      enderecoBairro: config.enderecoBairro ?? '',
      enderecoCidade: config.enderecoCidade ?? '',
      enderecoEstado: config.enderecoEstado ?? '',
      taxaEntregaPadrao: config.taxaEntregaPadrao,
      horarioFuncionamento: config.horarioFuncionamento,
      statusLoja: config.statusLoja,
      usaLogistica: config.usaLogistica,
      aceitaEntrega: config.aceitaEntrega,
      aceitaRetirada: config.aceitaRetirada,
    },
    itensDisponiveis: conta(disponiveis as PromiseSettledResult<{ count: number | null }>),
    itensSemFoto: conta(semFoto as PromiseSettledResult<{ count: number | null }>),
    itensSemPreco: quebrados.semPreco,
    itensSemDiaDaSemana: quebrados.semDia,
    categorias: conta(categorias as PromiseSettledResult<{ count: number | null }>),
    temTaxaPorBairro: conta(bairros as PromiseSettledResult<{ count: number | null }>) > 0,
    temTaxaPorRaio: conta(raios as PromiseSettledResult<{ count: number | null }>) > 0,
    entregadoresCadastrados: conta(entregadores as PromiseSettledResult<{ count: number | null }>),
  }
}
