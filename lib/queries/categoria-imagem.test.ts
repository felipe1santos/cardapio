import { describe, it, expect, vi } from 'vitest'
import { atualizarGrupo } from './cardapio'

/** Supabase falso que captura o payload do update. */
function supabaseFake() {
  const single = vi.fn().mockResolvedValue({ data: { id: 'g1' }, error: null })
  const select = vi.fn(() => ({ single }))
  const eq = vi.fn(() => ({ select }))
  // O parâmetro existe só para tipar `update.mock.calls[0][0]`; não é lido aqui.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const update = vi.fn((_payload: Record<string, unknown>) => ({ eq }))
  const from = vi.fn(() => ({ update }))
  return { client: { from } as never, update }
}

describe('atualizarGrupo', () => {
  it('omite imagem e foco quando não recebe — editar o nome não apaga a foto', async () => {
    const { client, update } = supabaseFake()
    await atualizarGrupo(client, 'g1', 'Bebidas')
    const payload = update.mock.calls[0]![0]
    expect(payload).not.toHaveProperty('imagem_url')
    expect(payload).not.toHaveProperty('imagem_foco_x')
    expect(payload).not.toHaveProperty('imagem_foco_y')
    expect(payload.nome).toBe('Bebidas')
  })

  it('grava imagem e foco quando recebe', async () => {
    const { client, update } = supabaseFake()
    await atualizarGrupo(client, 'g1', 'Bebidas', undefined, { url: 'https://x/y.webp', foco: { x: 20, y: 80 } })
    const payload = update.mock.calls[0]![0]
    expect(payload.imagem_url).toBe('https://x/y.webp')
    expect(payload.imagem_foco_x).toBe(20)
    expect(payload.imagem_foco_y).toBe(80)
  })

  it('aceita limpar a foto passando null explícito', async () => {
    const { client, update } = supabaseFake()
    await atualizarGrupo(client, 'g1', 'Bebidas', undefined, { url: null, foco: { x: 50, y: 50 } })
    expect(update.mock.calls[0]![0].imagem_url).toBeNull()
  })
})
