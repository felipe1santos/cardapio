import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path, { join } from 'path'
import { fileURLToPath } from 'url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0050_pizza_meio_a_meio.sql'), 'utf8')

describe('0050 pizza meio a meio', () => {
  it('adiciona max_sabores no tamanho padrão de pizza', () => {
    expect(sql).toMatch(/alter table tamanhos_padrao_pizza[\s\S]*add column if not exists max_sabores int not null default 1/)
  })

  it('nasce com 1 sabor pra não mudar o comportamento de loja existente', () => {
    expect(sql).toContain('default 1')
    expect(sql).not.toMatch(/update\s+tamanhos_padrao_pizza/i)
  })

  it('adiciona a regra de preço na loja, restrita a media|maior', () => {
    expect(sql).toMatch(/alter table restaurantes[\s\S]*add column if not exists pizza_calculo_preco text not null default 'media'/)
    expect(sql).toMatch(/check \(pizza_calculo_preco in \('media', 'maior'\)\)/)
  })

  it('é idempotente', () => {
    const adds = sql.match(/add column/g) ?? []
    const guards = sql.match(/add column if not exists/g) ?? []
    expect(guards.length).toBe(adds.length)
  })
})
