import { describe, it, expect, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
type Srv = { pedir: (p: Record<string, unknown>) => Promise<{ ok: boolean; erro?: string; log: string[]; ms: number }>; fechar: () => void; vivo: boolean }
const { ServidorImpressao } = require('./servidor-ps.js') as { ServidorImpressao: new (script: string, o?: Record<string, unknown>) => Srv }
const SCRIPT = join(__dirname, 'servidor-impressao.ps1')
const windows = process.platform === 'win32'
const saida = join(tmpdir(), `menuzia-srv-${Date.now()}.bin`)
const entrada = join(tmpdir(), `menuzia-srv-${Date.now()}-in.bin`)

// Servidor de impressão residente com o PowerShell DE VERDADE; nada imprime: o envio RAW
// grava no arquivo de teste (MENUZIA_PRINT_TO_FILE).
describe.runIf(windows)('servidor de impressão residente (servidor-impressao.ps1)', () => {
  process.env.MENUZIA_PRINT_TO_FILE = saida
  const s = new ServidorImpressao(SCRIPT, { logNome: 'menuzia-teste.log', ociosoMs: 60_000 })
  afterAll(() => { s.fechar(); delete process.env.MENUZIA_PRINT_TO_FILE; rmSync(saida, { force: true }); rmSync(entrada, { force: true }) })

  it('sobe uma vez e responde', async () => {
    const r = await s.pedir({ acao: 'ping' })
    expect(r.ok).toBe(true)
    expect(s.vivo).toBe(true)
  }, 30_000)

  it('RAW: os mesmos bytes, rápido (sem abrir PowerShell nem compilar de novo)', async () => {
    const bytes = Buffer.from([0x1b, 0x40, 0x41, 0x0a, 0x1b, 0x64, 5, 0x1d, 0x56, 1])
    writeFileSync(entrada, bytes)
    const t = Date.now()
    const r = await s.pedir({ acao: 'raw', impressora: 'Qualquer', arquivo: entrada, titulo: 'teste' })
    expect(r.ok).toBe(true)
    expect(Date.now() - t).toBeLessThan(500)
    expect(readFileSync(saida).equals(bytes)).toBe(true)
  }, 30_000)

  it('erro da impressora volta como erro (não derruba o servidor)', async () => {
    const r = await s.pedir({ acao: 'imagem', impressora: 'Impressora Que Nao Existe', arquivo: entrada })
    expect(r.ok).toBe(false)
    expect(r.erro).toContain('nao encontrada')
    expect((await s.pedir({ acao: 'ping' })).ok).toBe(true)
  }, 30_000)

  it('pedidos seguidos saem em ordem', async () => {
    const rs = await Promise.all([1, 2, 3].map(() => s.pedir({ acao: 'ping' })))
    expect(rs.every((r) => r.ok)).toBe(true)
  }, 30_000)
})

describe.runIf(windows)('servidor residente: quando pode cair no caminho antigo (sem imprimir em dobro)', () => {
  it('não subiu (programa inexistente): erro ANTES de enviar — pode usar o caminho antigo', async () => {
    const s = new ServidorImpressao(SCRIPT, { executavel: 'programa-que-nao-existe-menuzia.exe' })
    const e = await s.pedir({ acao: 'ping' }).catch((x) => x)
    expect(e.doServidor).toBe(true)
    expect(e.antesDeEnviar).toBe(true)
    s.fechar()
  }, 30_000)

  it('prazo estourado DEPOIS de entregue: erro sem caminho antigo (o papel pode ter saído)', async () => {
    const lento = new ServidorImpressao(SCRIPT, { prazoMs: 1 }) as Srv & { garantir: () => Promise<void> }
    await lento.garantir()
    const e = await lento.pedir({ acao: 'ping' }).catch((x) => x)
    lento.fechar()
    expect(e.doServidor).toBe(true)
    expect(e.antesDeEnviar).toBe(false)
  }, 60_000)
})
