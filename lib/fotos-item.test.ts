import { describe, expect, it } from 'vitest'
import { adicionarFoto, fotosDaVitrine, juntarFotos, LIMITE_FOTOS, moverFoto, removerFoto, separarFotos, tornarPrincipal, validarArquivoFoto, type Foto } from './fotos-item'

const f = (n: number): Foto => ({ url: `https://x/${n}.webp`, thumb: `https://x/${n}-t.webp` })

describe('fotos do item (até 4, a 1ª é a principal)', () => {
  it('item antigo: a foto que já tinha vira a foto 1; extras vêm depois; nada some', () => {
    const lista = juntarFotos({ imagemUrl: 'https://x/a.webp', imagemThumbUrl: 'https://x/a-t.webp', imagensExtras: [f(1), f(2)] })
    expect(lista.map((x) => x.url)).toEqual(['https://x/a.webp', 'https://x/1.webp', 'https://x/2.webp'])
    // item antigo com principal + 4 extras (5 fotos, do limite antigo): continua tudo lá
    expect(juntarFotos({ imagemUrl: 'https://x/a.webp', imagemThumbUrl: null, imagensExtras: [f(1), f(2), f(3), f(4)] })).toHaveLength(5)
  })
  it('item sem foto: lista vazia; separar devolve principal nula', () => {
    expect(juntarFotos({ imagemUrl: null, imagemThumbUrl: null, imagensExtras: [] })).toEqual([])
    expect(separarFotos([])).toEqual({ imagemUrl: null, imagemThumbUrl: null, imagensExtras: [] })
  })
  it('adiciona de 1 a 4; a 5ª é recusada', () => {
    let l: Foto[] = []
    for (let i = 1; i <= 4; i++) { const r = adicionarFoto(l, f(i)); expect(r.ok).toBe(true); l = r.fotos }
    expect(l).toHaveLength(LIMITE_FOTOS)
    const r5 = adicionarFoto(l, f(5))
    expect(r5.ok).toBe(false)
    expect(r5.fotos).toHaveLength(4)
  })
  it('reordena com as setas (sem sair das pontas)', () => {
    const l = [f(1), f(2), f(3)]
    expect(moverFoto(l, 2, -1).map((x) => x.url)).toEqual([f(1).url, f(3).url, f(2).url])
    expect(moverFoto(l, 0, -1)).toEqual(l)
    expect(moverFoto(l, 2, 1)).toEqual(l)
  })
  it('troca a principal: a escolhida vai para a frente', () => {
    expect(tornarPrincipal([f(1), f(2), f(3)], 2).map((x) => x.url)).toEqual([f(3).url, f(1).url, f(2).url])
  })
  it('remove; removendo a principal, a próxima vira principal', () => {
    expect(removerFoto([f(1), f(2)], 0).map((x) => x.url)).toEqual([f(2).url])
  })
  it('separa para gravar: 1ª = imagem_url (+ miniatura), o resto = imagens_extras', () => {
    expect(separarFotos([f(1), f(2), f(3)])).toEqual({ imagemUrl: f(1).url, imagemThumbUrl: f(1).thumb, imagensExtras: [f(2), f(3)] })
  })
  it('vitrine: principal + extras, sem repetir; 1 foto = sem carrossel', () => {
    expect(fotosDaVitrine({ imagemUrl: 'a', imagensExtras: [{ url: 'b', thumb: null }, { url: 'a', thumb: null }] })).toEqual(['a', 'b'])
    expect(fotosDaVitrine({ imagemUrl: 'a', imagensExtras: [] })).toEqual(['a'])
    expect(fotosDaVitrine({ imagemUrl: null, imagensExtras: undefined })).toEqual([])
  })
  it('recusa arquivo que não é imagem e arquivo gigante, com mensagem clara', () => {
    expect(validarArquivoFoto({ type: 'application/pdf', size: 1000 })).toMatch(/imagem/i)
    expect(validarArquivoFoto({ type: 'image/jpeg', size: 40 * 1024 * 1024 })).toMatch(/grande/i)
    expect(validarArquivoFoto({ type: 'image/jpeg', size: 3 * 1024 * 1024 })).toBeNull()
    expect(validarArquivoFoto({ type: 'image/webp', size: 100 })).toBeNull()
  })
})
