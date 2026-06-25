import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { geocodeEndereco, haversineKm, type Coord } from '@/lib/frete'

interface FreteBody {
  cep?: string
  rua?: string
  numero?: string
  bairro?: string
  cidade?: string
}

export interface FreteResposta {
  entregavel: boolean
  taxa: number
  /** Como a taxa foi resolvida: bairro cadastrado, faixa de raio ou taxa padrão. */
  fonte: 'bairro' | 'raio' | 'padrao'
  distanciaKm: number | null
  /** Mensagem amigável quando o endereço está fora da área de entrega. */
  motivo?: string
}

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

/**
 * Calcula o frete para um endereço de cliente. Ordem de prioridade:
 *   1) bairro cadastrado (match por nome) → taxa do bairro;
 *   2) faixas de raio (linha reta da loja até o cliente) → taxa da 1ª faixa que cobre;
 *   3) taxa padrão (inclusive quando não foi possível geocodificar — nunca bloqueia à toa).
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  let body: FreteBody
  try {
    body = (await request.json()) as FreteBody
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const admin = getAdminSupabase()
  const { data: loja, error: lojaErr } = await admin
    .from('restaurantes')
    .select('id, taxa_entrega_padrao, latitude, longitude, cep, endereco')
    .eq('slug', slug)
    .maybeSingle()
  if (lojaErr) return NextResponse.json({ error: 'Erro ao localizar a loja' }, { status: 500 })
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

  const padrao = Number(loja.taxa_entrega_padrao) || 0

  // 1) Bairro tem prioridade
  const bairroAlvo = (body.bairro ?? '').trim().toLowerCase()
  if (bairroAlvo) {
    const { data: bairros } = await admin
      .from('taxas_entrega_bairro')
      .select('bairro, taxa')
      .eq('restaurante_id', loja.id)
    const match = (bairros ?? []).find((b) => String(b.bairro).trim().toLowerCase() === bairroAlvo)
    if (match) {
      return NextResponse.json<FreteResposta>({ entregavel: true, taxa: Number(match.taxa), fonte: 'bairro', distanciaKm: null })
    }
  }

  // 2) Faixas de raio
  const { data: raios } = await admin
    .from('taxas_entrega_raio')
    .select('ate_km, taxa')
    .eq('restaurante_id', loja.id)
    .order('ate_km', { ascending: true })

  if (raios && raios.length > 0) {
    // Coordenadas da loja (geocodifica e cacheia na 1ª vez)
    let lojaCoord: Coord | null =
      loja.latitude != null && loja.longitude != null ? { lat: Number(loja.latitude), lng: Number(loja.longitude) } : null
    if (!lojaCoord) {
      lojaCoord = await geocodeEndereco({ cep: loja.cep ?? undefined, endereco: loja.endereco ?? undefined }, MAPS_KEY)
      if (lojaCoord) {
        await admin.from('restaurantes').update({ latitude: lojaCoord.lat, longitude: lojaCoord.lng }).eq('id', loja.id)
      }
    }

    // Coordenadas do cliente
    const enderecoCliente = [body.rua, body.numero, body.bairro, body.cidade].map((s) => (s ?? '').trim()).filter(Boolean).join(', ')
    const clienteCoord = await geocodeEndereco({ cep: body.cep, endereco: enderecoCliente || undefined }, MAPS_KEY)

    if (lojaCoord && clienteCoord) {
      const dist = haversineKm(lojaCoord, clienteCoord)
      const faixa = raios.find((r) => dist <= Number(r.ate_km))
      if (faixa) {
        return NextResponse.json<FreteResposta>({ entregavel: true, taxa: Number(faixa.taxa), fonte: 'raio', distanciaKm: Math.round(dist * 10) / 10 })
      }
      const maxKm = Number(raios[raios.length - 1].ate_km)
      return NextResponse.json<FreteResposta>({
        entregavel: false,
        taxa: 0,
        fonte: 'raio',
        distanciaKm: Math.round(dist * 10) / 10,
        motivo: `Esse endereço está a ${Math.round(dist * 10) / 10} km — fora da área de entrega (até ${maxKm} km).`,
      })
    }
    // Não deu pra geocodificar → não bloqueia, cai na taxa padrão.
  }

  // 3) Taxa padrão
  return NextResponse.json<FreteResposta>({ entregavel: true, taxa: padrao, fonte: 'padrao', distanciaKm: null })
}
