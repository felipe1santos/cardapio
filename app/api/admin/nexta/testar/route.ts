import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { cotarEntrega, obterToken } from '@/lib/nexta'
import { carregarConfigNexta, erroNexta, resolverCoordenadasColeta } from '@/lib/nexta-servidor'

/**
 * "Testar conexão" da tela de Integrações: autentica e faz uma cotação de mentira
 * (loja → loja) para provar que as credenciais e o endereço de coleta funcionam.
 *
 * `/availability` não cria nada no Nexta, então é seguro chamar à vontade. Roda mesmo
 * com a integração desligada — é justamente o teste que se faz antes de ligar.
 */
export async function POST() {
  const supabase = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
  if (!restauranteId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const admin = getAdminSupabase()
  try {
    const cfg = await resolverCoordenadasColeta(admin, await carregarConfigNexta(admin, restauranteId, { exigirAtivo: false }))
    await obterToken(cfg, true)

    const cotacao = await cotarEntrega(
      cfg,
      {
        rua: cfg.pickup.rua,
        numero: cfg.pickup.numero,
        complemento: cfg.pickup.complemento,
        bairro: cfg.pickup.bairro,
        cidade: cfg.pickup.cidade,
        uf: cfg.pickup.uf,
        cep: cfg.pickup.cep,
        latitude: cfg.pickup.latitude,
        longitude: cfg.pickup.longitude,
        instrucoes: '',
      },
      { totalPedido: 50, taxaEntrega: 0 }
    )

    return NextResponse.json({ ok: true, preco: cotacao.preco, etaColetaMin: cotacao.etaColetaMin })
  } catch (err) {
    const { mensagem } = erroNexta(err)
    return NextResponse.json({ ok: false, erro: mensagem })
  }
}
