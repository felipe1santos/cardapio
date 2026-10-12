import { createHash } from 'node:crypto'

/**
 * Instaladores do Assistente hospedados pela Menuzia (12/10/2026) — o repositório do GitHub vai ficar privado e os
 * releases de lá deixam de ser baixáveis. Os arquivos ficam no bucket público `agente-impressao` do Supabase, em partes
 * de 45 MB (o plano limita 50 MB por arquivo); a rota /api/agente/instalador/<arquivo> junta as partes e entrega o .exe
 * inteiro. Quem garante a integridade: o atualizador confere o SHA-512 (latest.yml) e esta rota confere o SHA-256 e o
 * tamanho no fim — se não bater, a conexão cai e o download falha (nunca entrega arquivo errado como completo).
 *
 * Versão nova: `node .medidas/subir-partes.mjs <exe> <versao>` e acrescentar aqui (o script imprime tamanho e hashes).
 */
export interface Instalador { versao: string; arquivo: string; tamanho: number; sha512: string; sha256: string; partes: string[] }

export const BASE_INSTALADOR = 'https://app.menuzia.com.br/api/agente/instalador'

export const INSTALADORES: Instalador[] = [
  {
    versao: '1.2.2', arquivo: 'AssistenteMenuziaAlfa1-Setup-1.2.2.exe', tamanho: 82601718,
    sha512: 'Cqjf4c4wBws2P3RprCm3SMyOERvvLjHxoChptOfR9P+WzZ4K8mP66OGOscybsgswVq2mRrDPxpEfoMDn7oaVbw==',
    sha256: '282c5ed324d0f4e8394f1f3a049d3676c12e1afaf3ea771cd9d005f88eb7fec7',
    partes: ['instaladores/1.2.2/parte-1', 'instaladores/1.2.2/parte-2'],
  },
  // Villa (travada na 1.1.0, ordem do dono): só para reinstalar à mão; nunca entra no latest.yml.
  {
    versao: '1.1.0', arquivo: 'AssistenteMenuziaAlfa1-Setup-1.1.0.exe', tamanho: 82550871,
    sha512: 'xgHI18TkYa2o05R72lLCWzemzUJAiFL+2aR6PIsp5w98yrtD0UnmBNWpxLSTEugz+NOrms7Yt7ArzXblE0Fehw==',
    sha256: 'eca6ac7e270bf1c1851643d7f0f8c8c2616a871cff1c9be9de83e3bf458309f3',
    partes: ['instaladores/1.1.0/parte-1', 'instaladores/1.1.0/parte-2'],
  },
]

export const urlInstalador = (i: Pick<Instalador, 'arquivo'>) => `${BASE_INSTALADOR}/${i.arquivo}`

export function instaladorPorArquivo(nome: string): Instalador | null {
  return INSTALADORES.find((i) => i.arquivo === nome) ?? null
}

const urlParte = (caminho: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/agente-impressao/${caminho}`

/** Junta as partes na ordem, em fluxo (sem guardar 82 MB na memória). Tamanho ou SHA-256 errados = erro no fim. */
export function abrirInstalador(i: Instalador, buscar: (url: string) => Promise<Response> = (u) => fetch(u, { cache: 'no-store' })): ReadableStream<Uint8Array> {
  const hash = createHash('sha256')
  let total = 0
  let n = 0
  let leitor: ReadableStreamDefaultReader<Uint8Array> | null = null
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      for (;;) {
        if (!leitor) {
          if (n >= i.partes.length) {
            if (total !== i.tamanho || hash.digest('hex') !== i.sha256) throw new Error('instalador não confere')
            ctrl.close()
            return
          }
          const r = await buscar(urlParte(i.partes[n++]))
          if (!r.ok || !r.body) throw new Error(`parte ${n} indisponível (${r.status})`)
          leitor = r.body.getReader()
        }
        const { done, value } = await leitor.read()
        if (done) { leitor = null; continue }
        hash.update(value)
        total += value.length
        ctrl.enqueue(value)
        return
      }
    },
    cancel() { void leitor?.cancel() },
  })
}
