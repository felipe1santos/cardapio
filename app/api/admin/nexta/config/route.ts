import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { limparTokenNexta } from '@/lib/nexta'
import { buscarNextaConfig, paraConfigPublica, salvarNextaConfig, type NextaConfigPatch } from '@/lib/queries/nexta'

/**
 * Config da integração Nexta da loja logada.
 *
 * `nexta_config` guarda o client_secret e não tem policy de RLS para `authenticated`
 * (migration 0042) — todo acesso passa por aqui, com service_role, e o segredo nunca
 * volta no corpo da resposta (só o booleano `temSecret`).
 */

/** GET: config sem o segredo. `config: null` quando a loja ainda não salvou nada. */
export async function GET() {
  const supabase = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
  if (!restauranteId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const admin = getAdminSupabase()
  const cfg = await buscarNextaConfig(admin, restauranteId)
  if (!cfg) {
    // Primeiro acesso: devolve o que dá pra pré-preencher do cadastro da loja.
    const loja = await buscarConfigLoja(supabase, restauranteId)
    return NextResponse.json({ config: null, sugestao: { merchantName: loja?.nome ?? '', cep: loja?.cep ?? '' } })
  }

  return NextResponse.json({ config: paraConfigPublica(cfg) })
}

interface CorpoPut {
  ativo?: unknown
  clientId?: unknown
  clientSecret?: unknown
  merchantId?: unknown
  pickup?: Record<string, unknown>
  vehicleType?: unknown
  container?: unknown
  containerSize?: unknown
  pickupLimitMin?: unknown
  deliveryLimitMin?: unknown
  limitTimesAsDatetime?: unknown
  pesoPadraoG?: unknown
}

const texto = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

/** Inteiro dentro de uma faixa — protege os campos numéricos de lixo vindo do form. */
function inteiro(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return undefined
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** PUT: salva a config. Segredo vazio preserva o atual; merchant_id/webhook_token nascem no 1º save. */
export async function PUT(request: Request) {
  const supabase = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
  if (!restauranteId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  let corpo: CorpoPut
  try {
    corpo = (await request.json()) as CorpoPut
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  // Nome da loja no Nexta não é um campo que o lojista precisa preencher — o merchant_id
  // já é o identificador que o Nexta usa para reconhecer o estabelecimento (ver
  // salvarNextaConfig). Deriva sempre do nome cadastrado da loja.
  const loja = await buscarConfigLoja(supabase, restauranteId)

  const patch: NextaConfigPatch = {
    ativo: bool(corpo.ativo),
    clientId: texto(corpo.clientId),
    clientSecret: texto(corpo.clientSecret),
    merchantId: texto(corpo.merchantId),
    merchantName: loja?.nome ?? undefined,
    vehicleType: texto(corpo.vehicleType),
    container: texto(corpo.container),
    containerSize: texto(corpo.containerSize),
    pickupLimitMin: inteiro(corpo.pickupLimitMin, 1, 600),
    deliveryLimitMin: inteiro(corpo.deliveryLimitMin, 1, 600),
    limitTimesAsDatetime: bool(corpo.limitTimesAsDatetime),
    pesoPadraoG: inteiro(corpo.pesoPadraoG, 1, 100_000),
  }

  if (corpo.pickup && typeof corpo.pickup === 'object') {
    const p = corpo.pickup
    patch.pickup = {
      rua: texto(p.rua),
      numero: texto(p.numero),
      complemento: texto(p.complemento),
      bairro: texto(p.bairro),
      cidade: texto(p.cidade),
      uf: texto(p.uf),
      cep: texto(p.cep),
    }
  }

  try {
    const cfg = await salvarNextaConfig(getAdminSupabase(), restauranteId, patch)
    // Credenciais podem ter mudado — o token em cache pertence às antigas.
    limparTokenNexta(restauranteId)
    return NextResponse.json({ config: paraConfigPublica(cfg) })
  } catch (err) {
    console.error('[nexta] falha ao salvar config:', err)
    return NextResponse.json({ error: 'Não foi possível salvar a configuração.' }, { status: 500 })
  }
}
