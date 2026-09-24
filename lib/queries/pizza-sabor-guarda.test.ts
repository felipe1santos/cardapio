import { describe, it, expect, vi } from 'vitest'
import { atualizarSabor, criarSabor, criarTamanho } from './cardapio'
import { atualizarMassaPizza, atualizarTamanhoPadraoPizza, criarMassaPizza, criarTamanhoPadraoMarmita, criarTamanhoPadraoPizza, removerBordaPizza } from './pizza'

/**
 * Supabase falso encadeável. `linha` responde a single/maybeSingle de leitura (o
 * registro atual), `existentes` responde à lista de nomes da loja/item, e
 * `linhasAfetadas` é o que update/delete devolvem (0 = o RLS barrou em silêncio).
 */
function supabaseFake(opts: { linha?: Record<string, unknown> | null; existentes?: { id: string; nome: string }[]; linhasAfetadas?: number; erroInsert?: { code: string } } = {}) {
  const insert = vi.fn()
  const update = vi.fn()
  const from = vi.fn(() => {
    let modo: 'select' | 'insert' | 'update' | 'delete' = 'select'
    const resposta = () => {
      if (modo === 'select') return { data: opts.existentes ?? [], error: null }
      return { data: Array.from({ length: opts.linhasAfetadas ?? 1 }, () => ({ id: 'x' })), error: null }
    }
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      insert: vi.fn((p: unknown) => { insert(p); modo = 'insert'; return chain }),
      update: vi.fn((p: unknown) => { update(p); modo = 'update'; return chain }),
      delete: vi.fn(() => { modo = 'delete'; return chain }),
      single: () =>
        Promise.resolve(
          modo === 'insert'
            ? opts.erroInsert
              ? { data: null, error: opts.erroInsert }
              : { data: { id: 'x', nome: 'n', descricao: '', imagem_url: null, status: 'disponivel', posicao: 0, peso: '', preco: 0, fatias: 8, max_sabores: 1 }, error: null }
            : { data: opts.linha ?? null, error: null },
        ),
      maybeSingle: () => Promise.resolve({ data: opts.linha ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(resposta()).then(ok, erro),
    }
    return chain
  })
  return { client: { from } as never, insert, update }
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

  it('recusa sabor repetido no mesmo item, sem diferenciar caixa e espaço', async () => {
    const { client, insert } = supabaseFake({ existentes: [{ id: 's1', nome: 'Calabresa' }] })
    await expect(criarSabor(client, 'item-1', '  calabresa ', 0)).rejects.toThrow(/já tem um sabor chamado "calabresa"/)
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('atualizarSabor', () => {
  const input = (nome: string, status: 'disponivel' | 'pausado' = 'disponivel') =>
    ({ nome, descricao: '', status, imagemUrl: null }) as const

  it('recusa RENOMEAR um sabor pra um nome com o separador', async () => {
    const { client, update } = supabaseFake({ linha: { nome: 'Calabresa', item_id: 'i' } })
    await expect(atualizarSabor(client, 'sab-1', input('Calabresa / Frango'))).rejects.toThrow(/barra/i)
    expect(update).not.toHaveBeenCalled()
  })

  it('deixa pausar um sabor legado que já tem o separador no nome', async () => {
    // Pausar/trocar foto reenvia o nome atual — não é rename, não pode travar.
    const { client, update } = supabaseFake({ linha: { nome: 'Frango / Catupiry', item_id: 'i' } })
    await atualizarSabor(client, 'sab-1', input('Frango / Catupiry', 'pausado'))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ nome: 'Frango / Catupiry', status: 'pausado' }))
  })

  it('deixa pausar sabor legado repetido (loja sem o índice da 0097)', async () => {
    const { client, update } = supabaseFake({
      linha: { nome: 'Calabresa', item_id: 'i' },
      existentes: [{ id: 'sab-1', nome: 'Calabresa' }, { id: 'sab-2', nome: 'Calabresa' }],
    })
    await atualizarSabor(client, 'sab-1', input('Calabresa', 'pausado'))
    expect(update).toHaveBeenCalled()
  })
})

describe('atualizarTamanhoPadraoPizza', () => {
  it('omite max_sabores do payload quando maxSabores não é passado', async () => {
    const { client, update } = supabaseFake({ linha: { nome: 'Grande', restaurante_id: 'r' } })
    await atualizarTamanhoPadraoPizza(client, 'tam-1', 'Grande', 8)
    expect(update).toHaveBeenCalledWith({ nome: 'Grande', fatias: 8 })
  })

  it('inclui max_sabores no payload quando maxSabores é passado', async () => {
    const { client, update } = supabaseFake({ linha: { nome: 'Grande', restaurante_id: 'r' } })
    await atualizarTamanhoPadraoPizza(client, 'tam-1', 'Grande', 8, 3)
    expect(update).toHaveBeenCalledWith({ nome: 'Grande', fatias: 8, max_sabores: 3 })
  })

  it('recusa renomear para um nome que outro tamanho da loja já usa', async () => {
    const { client, update } = supabaseFake({
      linha: { nome: 'Média', restaurante_id: 'r' },
      existentes: [{ id: 'tam-1', nome: 'Média' }, { id: 'tam-2', nome: 'Grande' }],
    })
    await expect(atualizarTamanhoPadraoPizza(client, 'tam-1', 'GRANDE', 8)).rejects.toThrow(/Já existe um tamanho de pizza/)
    expect(update).not.toHaveBeenCalled()
  })

  it('update barrado pelo RLS (0 linhas) vira erro visível', async () => {
    const { client } = supabaseFake({ linha: { nome: 'Grande', restaurante_id: 'r' }, linhasAfetadas: 0 })
    await expect(atualizarTamanhoPadraoPizza(client, 'tam-1', 'Grande', 8)).rejects.toThrow(/sem permissão/)
  })
})

describe('catálogos da loja', () => {
  it('recusa tamanho de pizza repetido e nome vazio', async () => {
    const { client, insert } = supabaseFake({ existentes: [{ id: 't', nome: 'Pequena' }] })
    await expect(criarTamanhoPadraoPizza(client, 'r', 'pequena', 4, 0)).rejects.toThrow(/Já existe/)
    await expect(criarTamanhoPadraoPizza(client, 'r', '   ', 4, 0)).rejects.toThrow(/Informe o nome/)
    expect(insert).not.toHaveBeenCalled()
  })

  it('grava o nome sem espaço sobrando', async () => {
    const { client, insert } = supabaseFake()
    await criarTamanhoPadraoMarmita(client, 'r', '  P  ', '300g', 0)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ nome: 'P' }))
  })

  it('corrida entre abas: 23505 do índice vira a mesma frase', async () => {
    const { client } = supabaseFake({ erroInsert: { code: '23505' } })
    await expect(criarTamanhoPadraoPizza(client, 'r', 'Brotinho', 4, 0)).rejects.toThrow(/Já existe um tamanho de pizza chamado "Brotinho"/)
  })

  it('exclusão barrada pelo RLS vira erro visível', async () => {
    const { client } = supabaseFake({ linhasAfetadas: 0 })
    await expect(removerBordaPizza(client, 'b')).rejects.toThrow(/sem permissão/)
  })

  it('massa nova com o nome da opção padrão é recusada (evita "Tradicional" duas vezes)', async () => {
    const { client, insert } = supabaseFake()
    await expect(criarMassaPizza(client, 'r', 'Tradicional', 0, 0)).rejects.toThrow(/já tem a opção de massa tradicional/)
    await expect(criarMassaPizza(client, 'r', 'padrão', 5, 0)).rejects.toThrow(/já tem a opção de massa tradicional/)
    expect(insert).not.toHaveBeenCalled()
  })

  it('massa antiga chamada "Tradicional" continua editável (preço) sem trocar o nome', async () => {
    const { client, update } = supabaseFake({ linha: { nome: 'Tradicional', restaurante_id: 'r' } })
    await atualizarMassaPizza(client, 'm1', 'Tradicional', 1)
    expect(update).toHaveBeenCalledWith({ nome: 'Tradicional', preco: 1 })
  })

  it('renomear outra massa para "Tradicional" é recusado', async () => {
    const { client, update } = supabaseFake({ linha: { nome: 'Fina', restaurante_id: 'r' } })
    await expect(atualizarMassaPizza(client, 'm2', 'Tradicional', 0)).rejects.toThrow(/massa tradicional/)
    expect(update).not.toHaveBeenCalled()
  })

  it('tamanho do item (marmita/açaí) repetido é recusado', async () => {
    const { client, insert } = supabaseFake({ existentes: [{ id: 't', nome: 'P (300g)' }] })
    await expect(criarTamanho(client, 'item', 'p (300g)', 20, 1)).rejects.toThrow(/já tem um tamanho/)
    expect(insert).not.toHaveBeenCalled()
  })
})
