import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { abrirInstalador, instaladorPorArquivo, INSTALADORES, urlInstalador } from './instaladores'
import { ATUALIZACAO_ASSISTENTE } from './atualizacao-assistente'

describe('instaladores do Assistente hospedados na Menuzia (fora do GitHub)', () => {
  it('acha pelo nome exato do arquivo; nada de caminho, nome desconhecido ou outra extensão', () => {
    expect(instaladorPorArquivo('AssistenteMenuziaAlfa1-Setup-1.2.2.exe')?.versao).toBe('1.2.2')
    expect(instaladorPorArquivo('AssistenteMenuziaAlfa1-Setup-1.1.0.exe')?.versao).toBe('1.1.0')
    for (const n of ['../x.exe', 'AssistenteMenuziaAlfa1-Setup-9.9.9.exe', 'AssistenteMenuziaAlfa1-Setup-1.2.2.zip', '']) expect(instaladorPorArquivo(n)).toBeNull()
  })
  it('a versão liberada para atualização é servida daqui, com o mesmo SHA-512 e tamanho', () => {
    const i = INSTALADORES.find((x) => x.versao === ATUALIZACAO_ASSISTENTE.versao)!
    expect(i).toBeTruthy()
    expect(i.sha512).toBe(ATUALIZACAO_ASSISTENTE.sha512)
    expect(i.tamanho).toBe(ATUALIZACAO_ASSISTENTE.tamanho)
    expect(ATUALIZACAO_ASSISTENTE.url).toBe(urlInstalador(i))
    expect(ATUALIZACAO_ASSISTENTE.url).not.toMatch(/github/)
  })
  it('junta as partes na ordem e confere tamanho e SHA-256; parte faltando ou alterada = erro', async () => {
    const a = Buffer.from('parte-um-'), b = Buffer.from('parte-dois')
    const tudo = Buffer.concat([a, b])
    const inst = { versao: 't', arquivo: 't.exe', tamanho: tudo.length, sha512: '', sha256: createHash('sha256').update(tudo).digest('hex'), partes: ['p1', 'p2'] }
    const fetcher = (conteudo: Record<string, Buffer>) => async (url: string) => {
      const k = url.split('/').pop()!
      return conteudo[k] ? new Response(new Uint8Array(conteudo[k])) : new Response('x', { status: 404 })
    }
    const ler = async (s: ReadableStream<Uint8Array>) => Buffer.from(await new Response(s).arrayBuffer())
    expect((await ler(abrirInstalador(inst, fetcher({ p1: a, p2: b })))).equals(tudo)).toBe(true)
    await expect(ler(abrirInstalador(inst, fetcher({ p1: a })))).rejects.toThrow()
    await expect(ler(abrirInstalador(inst, fetcher({ p1: a, p2: Buffer.from('parte-DOIS') })))).rejects.toThrow()
  })
})
