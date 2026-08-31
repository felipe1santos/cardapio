/**
 * Pipeline único de otimização de imagem, executado no navegador do lojista
 * ANTES de qualquer upload para o Supabase Storage.
 *
 * Motivo: as fotos iam para o bucket byte a byte, do jeito que saíam da câmera
 * (PNG de até 3,3 MB), e eram servidas em `<img>` de 96–200 px. Isso respondia
 * pela maior parte do egress do Storage.
 *
 * Regras que este módulo respeita, nessa ordem:
 *  1. Nunca aumentar uma imagem — só reduz quem está acima do lado máximo.
 *  2. Nunca devolver algo maior que o original.
 *  3. Nunca quebrar um upload: qualquer falha devolve o arquivo original.
 */

/**
 * TTL, em segundos, para todo arquivo novo do bucket `cardapio` (1 ano).
 *
 * Seguro porque todo caminho de upload é `{...}/{crypto.randomUUID()}.{ext}` com
 * `upsert: false`: uma URL nunca muda de conteúdo — trocar a foto de um item
 * cria um objeto novo, com URL nova. O valor é passado cru ao storage-js, que
 * monta `cache-control: max-age=<valor>` no servidor; o SDK não expressa a
 * diretiva `immutable`, e ela não é necessária aqui.
 */
export const CACHE_CONTROL_SEGUNDOS = '31536000'

export type PerfilImagem = 'produto' | 'thumb' | 'logo' | 'banner'

interface Perfil {
  /** Limite do maior lado, em px. A proporção é sempre preservada. */
  maxLado: number
  qualidade: number
}

/**
 * Cada perfil é dimensionado pelo maior tamanho em que a imagem aparece na UI,
 * com folga para telas 2×/3×:
 *  - produto: sheet do produto na vitrine ocupa até 600 px de largura → 1200
 *  - thumb:   complementos e avatares aparecem em 9–64 px → 400 é folga de sobra
 *  - logo:    maior uso é 88 px (barra da loja na vitrine) → 512
 *  - banner:  hero da vitrine ocupa a largura toda do container de 1280 → 1600
 */
const PERFIS: Record<PerfilImagem, Perfil> = {
  produto: { maxLado: 1200, qualidade: 0.82 },
  thumb: { maxLado: 400, qualidade: 0.8 },
  logo: { maxLado: 512, qualidade: 0.85 },
  banner: { maxLado: 1600, qualidade: 0.82 },
}

/** Par full + miniatura de um mesmo arquivo. `thumb` é null quando não valeu a pena gerar. */
export interface ParImagem {
  full: File
  thumb: File | null
}

/**
 * Gera as duas versões que a UI precisa a partir de um único arquivo escolhido:
 * a `full` do perfil pedido (o que abre no sheet do produto) e uma `thumb` de
 * 400 px (o que aparece nos cards de listagem).
 *
 * A miniatura é oportunista: se falhar, ou se ficar do mesmo tamanho da full
 * — imagem que já era pequena —, devolve `thumb: null` e o chamador grava só a
 * full. O frontend cai no fallback e nada quebra.
 */
export async function otimizarParImagem(file: File, perfil: PerfilImagem = 'produto'): Promise<ParImagem> {
  const full = await otimizarImagem(file, perfil)
  if (perfil === 'thumb') return { full, thumb: null }

  try {
    // A thumb sai da full já reduzida: menos um decode do arquivo original.
    const thumb = await otimizarImagem(full, 'thumb')
    // `otimizarImagem` devolve a própria entrada quando não há ganho.
    if (thumb === full || thumb.size >= full.size) return { full, thumb: null }
    return { full, thumb }
  } catch {
    return { full, thumb: null }
  }
}

/** Formatos que não podem passar pelo canvas sem perder o que os torna úteis. */
const FORMATOS_INTOCAVEIS = ['image/gif', 'image/svg+xml', 'image/apng']

/** Teto para o fallback de decodificação via `<img>` (ver `decodificar`). */
const TIMEOUT_DECODIFICACAO_MS = 8000

let suporteWebp: boolean | null = null

/** Testa uma única vez se o navegador consegue codificar WebP via canvas. */
function navegadorCodificaWebp(): boolean {
  if (suporteWebp !== null) return suporteWebp
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    suporteWebp = canvas.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    suporteWebp = false
  }
  return suporteWebp
}

/** Decodifica respeitando a orientação EXIF (foto tirada com o celular deitado). */
async function decodificar(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Navegador sem a opção `imageOrientation` — tenta a forma simples.
      try {
        return await createImageBitmap(file)
      } catch {
        /* cai no <img> abaixo */
      }
    }
  }

  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      // Trava de segurança: se o ambiente não disparar nem `onload` nem
      // `onerror`, o upload ficaria pendurado para sempre. Melhor desistir da
      // otimização e subir o original.
      const limite = setTimeout(() => reject(new Error('decodificação expirou')), TIMEOUT_DECODIFICACAO_MS)
      img.onload = () => { clearTimeout(limite); resolve(img) }
      img.onerror = () => { clearTimeout(limite); reject(new Error('imagem não decodificável')) }
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function dimensoes(fonte: ImageBitmap | HTMLImageElement): { largura: number; altura: number } {
  if ('naturalWidth' in fonte) return { largura: fonte.naturalWidth, altura: fonte.naturalHeight }
  return { largura: fonte.width, altura: fonte.height }
}

function paraBlob(canvas: HTMLCanvasElement, tipo: string, qualidade: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, qualidade))
}

/** Troca a extensão do nome do arquivo mantendo o resto (o Storage deriva a extensão do nome). */
function trocarExtensao(nome: string, extensao: string): string {
  const base = nome.replace(/\.[^./\\]+$/, '') || 'imagem'
  return `${base}.${extensao}`
}

/**
 * Reduz e recomprime uma imagem conforme o perfil de uso.
 *
 * Devolve o arquivo ORIGINAL, sem erro, quando: rodando fora do navegador, o
 * formato não pode ser recodificado (GIF/SVG), o navegador não decodifica o
 * arquivo (ex.: HEIC), a imagem já está dentro do limite e o resultado não
 * ficaria menor, ou qualquer etapa falha.
 */
export async function otimizarImagem(file: File, perfil: PerfilImagem): Promise<File> {
  if (typeof document === 'undefined') return file
  if (!file.type.startsWith('image/')) return file
  if (FORMATOS_INTOCAVEIS.includes(file.type)) return file

  try {
    const { maxLado, qualidade } = PERFIS[perfil]
    const fonte = await decodificar(file)
    const { largura, altura } = dimensoes(fonte)
    if (!largura || !altura) return file

    // Escala nunca passa de 1: imagem pequena não é esticada.
    const escala = Math.min(1, maxLado / Math.max(largura, altura))
    const novaLargura = Math.max(1, Math.round(largura * escala))
    const novaAltura = Math.max(1, Math.round(altura * escala))

    const webp = navegadorCodificaWebp()
    // Sem WebP, só vale recodificar quando a origem já é JPEG — reencodar um PNG
    // com transparência como JPEG pintaria o fundo de preto.
    if (!webp && file.type !== 'image/jpeg') return file
    const tipoSaida = webp ? 'image/webp' : 'image/jpeg'

    // Já está dentro do limite e já é do formato de saída: não há o que ganhar.
    if (escala === 1 && file.type === tipoSaida) return file

    const canvas = document.createElement('canvas')
    canvas.width = novaLargura
    canvas.height = novaAltura
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(fonte as CanvasImageSource, 0, 0, novaLargura, novaAltura)
    if ('close' in fonte) fonte.close()

    const blob = await paraBlob(canvas, tipoSaida, qualidade)
    if (!blob || blob.type !== tipoSaida) return file

    // Imagem já otimizada na origem: se não encolhemos e o arquivo ficaria maior,
    // o original é melhor.
    if (blob.size >= file.size && escala === 1) return file

    const extensao = tipoSaida === 'image/webp' ? 'webp' : 'jpg'
    return new File([blob], trocarExtensao(file.name, extensao), {
      type: tipoSaida,
      lastModified: Date.now(),
    })
  } catch {
    // Otimização é oportunista: nunca pode impedir o lojista de subir a foto.
    return file
  }
}
