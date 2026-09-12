import { describe, it, expect, vi } from 'vitest'
import { criarSabor } from './cardapio'
import { atualizarTamanhoPadraoPizza } from './pizza'

/** Supabase falso: se o guard funcionar, nada disso é chamado. */
function supabaseFake() {
  const single = vi.fn().mockResolvedValue({ data: { id: 'x', nome: 'n', descricao: '', imagem_url: null, status: 'disponivel', posicao: 0 }, error: null })
  const select = vi.fn(() => ({ single }))
  const insert = vi.fn(() => ({ select }))
  const from = vi.fn(() => ({ insert }))
  return { client: { from } as never, insert }
}

describe('criarSabor', () => {
  it('recusa nome que contém o separador de sabores', async () => {
    const { client, insert } = supabaseFake()
    await expect(criarSabor(client, 'item-1', 'Calabresa / Frango', 0)).rejects.toThrow(/barra/i)
    expect(insert).not.toHaveBeenCalled()
  })

  it('aceita nome com "C/" colado', async () => {
    const { client, insert } = supabaseFake()
    await criarSabor(client, 'item-1', 'Bacon C/ Milho', 0)
    expect(insert).toHaveBeenCalled()
  })
})

/** Supabase falso pra capturar o payload passado ao .update(). */
function supabaseFakeUpdate() {
  const eq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ update }))
  return { client: { from } as never, update }
}

describe('atualizarTamanhoPadraoPizza', () => {
  it('omite max_sabores do payload quando maxSabores não é passado', async () => {
    const { client, update } = supabaseFakeUpdate()
    await atualizarTamanhoPadraoPizza(client, 'tam-1', 'Grande', 8)
    expect(update).toHaveBeenCalledWith({ nome: 'Grande', fatias: 8 })
  })

  it('inclui max_sabores no payload quando maxSabores é passado', async () => {
    const { client, update } = supabaseFakeUpdate()
    await atualizarTamanhoPadraoPizza(client, 'tam-1', 'Grande', 8, 3)
    expect(update).toHaveBeenCalledWith({ nome: 'Grande', fatias: 8, max_sabores: 3 })
  })
})
