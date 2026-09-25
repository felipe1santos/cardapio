import { describe, expect, it } from 'vitest'
import { caminhoLogoDaLoja, caminhoLogoImpressao, chaveLogo, dimensoesPng, tipoImagem, webpComTransparencia } from './logo-loja'

const SB = 'https://abc.supabase.co'
const LOJA = '3aa1f6ea-1111-4222-8333-944455556666'
const OUTRA = '99999999-1111-4222-8333-944455556666'
const ok = `${SB}/storage/v1/object/public/cardapio/${LOJA}/perfil/logo-x.webp`

describe('logo da loja: só o Storage da própria loja', () => {
  it('aceita o arquivo da pasta da loja e devolve o caminho no bucket', () => expect(caminhoLogoDaLoja(ok, SB, LOJA)).toBe(`${LOJA}/perfil/logo-x.webp`))
  it('recusa outro domínio', () => expect(caminhoLogoDaLoja(ok.replace(SB, 'https://evil.example'), SB, LOJA)).toBeNull())
  it('recusa a pasta de outra loja', () => expect(caminhoLogoDaLoja(ok.replace(LOJA, OUTRA), SB, LOJA)).toBeNull())
  it('recusa outro bucket e fuga de pasta', () => {
    expect(caminhoLogoDaLoja(ok.replace('/cardapio/', '/privado/'), SB, LOJA)).toBeNull()
    expect(caminhoLogoDaLoja(`${SB}/storage/v1/object/public/cardapio/${LOJA}/../${OUTRA}/logo.png`, SB, LOJA)).toBeNull()
    expect(caminhoLogoDaLoja(`${SB}/storage/v1/object/public/cardapio/${LOJA}/%2e%2e/${OUTRA}/l.png`, SB, LOJA)).toBeNull()
  })
  it('recusa http em vez de https e credencial na URL', () => {
    expect(caminhoLogoDaLoja(ok.replace('https:', 'http:'), SB, LOJA)).toBeNull()
    expect(caminhoLogoDaLoja(ok.replace('https://', 'https://u:p@'), SB, LOJA)).toBeNull()
  })
  it('sem logo, URL inválida ou loja inválida: nada', () => {
    expect(caminhoLogoDaLoja(null, SB, LOJA)).toBeNull()
    expect(caminhoLogoDaLoja('lixo', SB, LOJA)).toBeNull()
    expect(caminhoLogoDaLoja(ok, SB, 'x')).toBeNull()
  })
  it('logo de impressão: caminho fixo da loja; logo nova = chave nova', () => {
    expect(caminhoLogoImpressao(LOJA, chaveLogo(ok))).toMatch(new RegExp(`^${LOJA}/impressao/logo-[0-9a-f]{16}\\.png$`))
    expect(chaveLogo(ok)).not.toBe(chaveLogo(ok.replace('logo-x', 'logo-y')))
  })
})

describe('formato da imagem', () => {
  const riff = (chunk: string, extra: number[]) =>
    new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), ...Buffer.from(chunk), 0, 0, 0, 0, ...extra, ...new Array(16).fill(0)])
  it('reconhece PNG, JPEG e WebP', () => {
    expect(tipoImagem(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe('png')
    expect(tipoImagem(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(tipoImagem(riff('VP8 ', []))).toBe('webp')
    expect(tipoImagem(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })
  it('WebP com transparência (VP8X alfa, VP8L alfa) × sem (VP8)', () => {
    expect(webpComTransparencia(riff('VP8X', [0x10]))).toBe(true)
    expect(webpComTransparencia(riff('VP8X', [0x00]))).toBe(false)
    expect(webpComTransparencia(riff('VP8L', [0x2f, 0, 0, 0, 0x10]))).toBe(true)
    expect(webpComTransparencia(riff('VP8 ', []))).toBe(false)
  })
  it('dimensões do PNG', () => {
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])
    new DataView(png.buffer).setUint32(16, 300)
    new DataView(png.buffer).setUint32(20, 120)
    expect(dimensoesPng(png)).toEqual({ largura: 300, altura: 120 })
  })
})
