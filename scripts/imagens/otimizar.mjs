// Otimizador de imagem para SCRIPTS (importação de cardápio, semeadura, conversão) — as MESMAS regras do painel
// (lib/imagem.ts › PERFIS): WebP, maior lado no limite do perfil, nunca aumenta, transparência preservada.
// 22/10/2026: as fotos pesadas da vitrine (523 arquivos, 124 MB) entraram por scripts que subiam a imagem crua.
// Todo script que sobe foto para o bucket "cardapio" passa por aqui (guarda B5 em scripts/guardas/bugs-conhecidos.mjs).
import sharp from 'sharp'

/** Espelho de PERFIS de lib/imagem.ts (teste em lib/imagem-scripts.test.ts confere que batem). */
export const PERFIS_SCRIPT = {
  produto: { maxLado: 1200, qualidade: 0.82 },
  thumb: { maxLado: 400, qualidade: 0.8 },
  logo: { maxLado: 512, qualidade: 0.85 },
  banner: { maxLado: 1600, qualidade: 0.82 },
  bannerMobile: { maxLado: 800, qualidade: 0.8 },
}

/**
 * Devolve { buffer, contentType, extensao, largura, altura } em WebP dentro do perfil.
 * Se o resultado não ficar menor que o original E a imagem já estiver dentro do limite, devolve o original
 * (`mudou: false`). Lança se o arquivo não for imagem.
 */
export async function otimizarBuffer(entrada, perfil = 'produto', tipoOriginal = '') {
  const { maxLado, qualidade } = PERFIS_SCRIPT[perfil] ?? PERFIS_SCRIPT.produto
  const img = sharp(entrada, { failOn: 'none' }).rotate() // .rotate(): respeita a orientação EXIF da câmera
  const meta = await img.metadata()
  const largura = meta.width ?? 0
  const altura = meta.height ?? 0
  if (!largura || !altura) throw new Error('não é imagem')
  const dentro = Math.max(largura, altura) <= maxLado
  const saida = await img
    .resize({ width: maxLado, height: maxLado, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: Math.round(qualidade * 100), effort: 5, smartSubsample: true })
    .toBuffer({ resolveWithObject: true })
  if (dentro && saida.data.length >= entrada.length && /webp/.test(tipoOriginal)) {
    return { buffer: entrada, contentType: tipoOriginal, extensao: 'webp', largura, altura, mudou: false }
  }
  if (saida.data.length >= entrada.length && dentro) {
    return { buffer: entrada, contentType: tipoOriginal || 'application/octet-stream', extensao: null, largura, altura, mudou: false }
  }
  return { buffer: saida.data, contentType: 'image/webp', extensao: 'webp', largura: saida.info.width, altura: saida.info.height, mudou: true }
}
