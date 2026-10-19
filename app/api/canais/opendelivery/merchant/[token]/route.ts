import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigPorWebhookToken } from '@/lib/canais/config'
import { listarCardapioPublico, type ComplementoItem, type ItemCardapio } from '@/lib/queries/cardapio'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { turnosDoDia } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

/**
 * `GET /v1/merchant` do Open Delivery (o que o SOFTWARE SERVICE expõe): dados da loja, serviço de entrega/retirada,
 * horários e o CARDÁPIO no formato Merchant (menus → categories → itemOffers → items/optionGroups/options). A Keeta e o
 * 99Food leem daqui para montar a loja no app; `externalCode` de cada item é o id do item Menuzia — por isso o pedido
 * que volta já chega vinculado (lib/canais/importar.ts).
 * URL por loja/canal (token de canais_config). Autenticação: o app chama com o Bearer que ELE emitiu? Não: na spec,
 * o app chama o merchant do software com o token do próprio software (clientCredentials do app). Aqui exigimos o token
 * da URL (aleatório, 36 chars) — suficiente para não expor cardápio de loja errada; o cardápio em si já é público.
 */
const sem = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const preco = (v: number) => ({ value: Math.round(v * 100) / 100, currency: 'BRL' })

function horariosOd(grade: unknown): { dayOfWeek: string; timePeriods: { startTime: string; endTime: string }[] }[] {
  const DIAS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
  const out: { dayOfWeek: string; timePeriods: { startTime: string; endTime: string }[] }[] = []
  for (let d = 0; d < 7; d++) {
    const turnos = turnosDoDia(grade as Parameters<typeof turnosDoDia>[0], d)
    if (!turnos.length) continue
    out.push({ dayOfWeek: DIAS[d], timePeriods: turnos.map((t) => ({ startTime: `${t.abre}:00`, endTime: `${t.fecha}:00` })) })
  }
  return out
}

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  const admin = getAdminSupabase()
  const cfg = await buscarConfigPorWebhookToken(admin, token).catch(() => null)
  if (!cfg || cfg.canal === 'ifood') return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  const [loja, grupos] = await Promise.all([buscarConfigLoja(admin, cfg.restauranteId), listarCardapioPublico(admin, cfg.restauranteId)])
  if (!loja) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const items: Record<string, unknown>[] = []
  const optionGroups: Record<string, unknown>[] = []
  const categories: Record<string, unknown>[] = []
  const itemOffers: Record<string, unknown>[] = []
  for (const g of grupos) {
    const ofertas: string[] = []
    for (const it of g.itens as (ItemCardapio & { complementos?: ComplementoItem[] })[]) {
      if (it.status !== 'disponivel') continue
      const idOferta = `oferta-${it.id}`
      const grupoOpcoesIds: string[] = []
      const comps = (it.complementos ?? []).filter((c) => !(c as { pausado?: boolean }).pausado)
      if (comps.length) {
        const idGrupo = `opcoes-${it.id}`
        optionGroups.push({
          id: idGrupo, externalCode: idGrupo, status: 'AVAILABLE', name: 'Adicionais', minPermitted: 0, maxPermitted: comps.length,
          options: comps.map((c, index) => ({ id: `op-${c.id}`, externalCode: sem(c.nome), status: 'AVAILABLE', index, name: c.nome, price: preco(Number(c.preco) || 0), maxPermitted: 1 })),
        })
        grupoOpcoesIds.push(idGrupo)
      }
      items.push({
        id: it.id, name: it.nome, description: sem(it.descricao), externalCode: it.id, status: 'AVAILABLE',
        ...(it.imagemUrl ? { image: { URL: it.imagemUrl } } : {}),
      })
      itemOffers.push({ id: idOferta, itemId: it.id, index: ofertas.length, price: preco(it.promocaoPreco ?? it.preco), status: 'AVAILABLE', optionGroupsId: grupoOpcoesIds })
      ofertas.push(idOferta)
    }
    if (ofertas.length) categories.push({ id: g.id, externalCode: g.id, index: categories.length, name: g.nome, status: 'AVAILABLE', itemOfferId: ofertas })
  }
  const hours = horariosOd(loja.horarioFuncionamento)
  const servicos: Record<string, unknown>[] = []
  if (loja.aceitaEntrega !== false) servicos.push({ id: `${cfg.restauranteId}-delivery`, status: 'AVAILABLE', serviceType: 'DELIVERY', menuId: `menu-${cfg.restauranteId}`, serviceHours: { id: `h-${cfg.restauranteId}-d`, weekHours: hours } })
  if (loja.aceitaRetirada === true) servicos.push({ id: `${cfg.restauranteId}-takeout`, status: 'AVAILABLE', serviceType: 'TAKEOUT', menuId: `menu-${cfg.restauranteId}`, serviceHours: { id: `h-${cfg.restauranteId}-t`, weekHours: hours } })

  const merchant = {
    lastUpdate: new Date().toISOString(), TTL: 3600, id: cfg.merchantIdExterno || cfg.restauranteId, status: 'AVAILABLE',
    basicInfo: {
      name: loja.nome, document: '', corporateName: loja.nome, description: '', averageTicket: 0, averagePreparationTime: 30, minOrderValue: { value: 0, currency: 'BRL' },
      merchantType: 'RESTAURANT', merchantCategories: ['FAST_FOOD'],
      address: { country: 'BR', state: loja.enderecoEstado || 'ES', city: loja.enderecoCidade || '', district: loja.enderecoBairro || '', street: loja.enderecoRua || '', number: loja.enderecoNumero || '', postalCode: (loja.cep || '').replace(/\D/g, ''), complement: loja.enderecoComplemento || '', reference: '', latitude: loja.latitude ?? 0, longitude: loja.longitude ?? 0 },
      contactEmails: [], contactPhones: { commercialNumber: (loja.telefone || '').replace(/\D/g, ''), whatsappNumber: (loja.telefone || '').replace(/\D/g, '') },
      logoImage: loja.logoUrl ? { URL: loja.logoUrl } : undefined, bannerImage: loja.bannerUrl ? { URL: loja.bannerUrl } : undefined, createdAt: new Date().toISOString(),
    },
    services: servicos,
    menus: [{ id: `menu-${cfg.restauranteId}`, name: 'Cardápio', description: '', externalCode: 'principal', disclaimer: '', categoryId: categories.map((c) => c.id as string) }],
    categories, itemOffers, items, optionGroups, availabilities: [],
  }
  return NextResponse.json(merchant, { headers: { 'Cache-Control': 'no-store' } })
}
