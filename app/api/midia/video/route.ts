import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { pode } from '@/lib/auth/permissoes'
import { caminhoPermitidoCompleto, normalizarAcessos } from '@/lib/acessos'
import { criarLimitador } from '@/lib/limite-taxa'
import { CACHE_CONTROL_SEGUNDOS } from '@/lib/imagem'
import { validarArquivoVideo } from '@/lib/video-vitrine'
import { converterVideo } from '@/lib/video/converter'

/**
 * Upload do vídeo da vitrine (21/10/2026): POST multipart { arquivo, destino: 'item' | 'banner' } → { url, capa }.
 * Fora de /api/admin de propósito: o middleware de lá lê o corpo inteiro (limite de 10 MB) e o vídeo chega a 50 MB.
 * Por isso a permissão é conferida aqui: item = quem edita o cardápio; banner = quem edita os ajustes da loja.
 */
export const runtime = 'nodejs'
export const maxDuration = 180

const porLoja = criarLimitador({ max: 20, janelaMs: 60 * 60_000 })

export async function POST(request: Request) {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const admin = getAdminSupabase()
  const { data: u } = await admin.from('usuarios').select('papel, acessos, restaurante_id, desativado_em').eq('id', user.id).maybeSingle()
  if (!u?.restaurante_id || u.desativado_em) return NextResponse.json({ error: 'Sem acesso' }, { status: 403 })

  const form = await request.formData().catch(() => null)
  const arquivo = form?.get('arquivo')
  const destino = form?.get('destino') === 'banner' ? 'banner' : 'item'
  const papel = u.papel as string
  const permitido = destino === 'banner'
    ? pode(papel, 'ajustes.editar') && caminhoPermitidoCompleto('/admin/ajustes', papel, normalizarAcessos(u.acessos))
    : pode(papel, 'cardapio.editar') && caminhoPermitidoCompleto('/admin/cardapio', papel, normalizarAcessos(u.acessos))
  if (!permitido) return NextResponse.json({ error: 'Você não tem permissão para isso.' }, { status: 403 })
  if (!(arquivo instanceof File)) return NextResponse.json({ error: 'Escolha um vídeo.' }, { status: 400 })
  const invalido = validarArquivoVideo(arquivo)
  if (invalido) return NextResponse.json({ error: invalido }, { status: 400 })

  const loja = u.restaurante_id as string
  if (porLoja.excedeu(loja)) return NextResponse.json({ error: 'Muitos vídeos em pouco tempo. Tente de novo mais tarde.' }, { status: 429 })
  porLoja.registrar(loja)

  let convertido
  try {
    convertido = await converterVideo(Buffer.from(await arquivo.arrayBuffer()))
  } catch (e) {
    console.error('[video] conversão falhou:', (e as Error).message)
    return NextResponse.json({ error: 'Não foi possível converter este vídeo. Tente outro arquivo.' }, { status: 422 })
  }

  const id = crypto.randomUUID()
  const base = `${loja}/videos/${id}`
  const bucket = admin.storage.from('cardapio')
  const up1 = await bucket.upload(`${base}.mp4`, convertido.mp4, { contentType: 'video/mp4', cacheControl: CACHE_CONTROL_SEGUNDOS, upsert: false })
  const up2 = up1.error ? up1 : await bucket.upload(`${base}.webp`, convertido.capa, { contentType: 'image/webp', cacheControl: CACHE_CONTROL_SEGUNDOS, upsert: false })
  if (up1.error || up2.error) {
    await bucket.remove([`${base}.mp4`, `${base}.webp`]).catch(() => {})
    return NextResponse.json({ error: 'Não foi possível salvar o vídeo. Tente de novo.' }, { status: 500 })
  }
  return NextResponse.json({
    url: bucket.getPublicUrl(`${base}.mp4`).data.publicUrl,
    capa: bucket.getPublicUrl(`${base}.webp`).data.publicUrl,
    bytes: convertido.mp4.length,
  })
}
