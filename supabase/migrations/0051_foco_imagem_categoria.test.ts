import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0051_foco_imagem_categoria.sql'), 'utf8')

describe('0051 foco de imagem e foto de categoria', () => {
  it('adiciona o foco da capa na loja, com default 50', () => {
    expect(sql).toMatch(/add column if not exists banner_foco_x numeric\(5, ?2\) not null default 50/)
    expect(sql).toMatch(/add column if not exists banner_foco_y numeric\(5, ?2\) not null default 50/)
  })

  it('adiciona foto e foco na categoria', () => {
    expect(sql).toMatch(/add column if not exists imagem_url text/)
    expect(sql).toMatch(/add column if not exists imagem_foco_x numeric\(5, ?2\) not null default 50/)
    expect(sql).toMatch(/add column if not exists imagem_foco_y numeric\(5, ?2\) not null default 50/)
  })

  it('50 é o centro — nenhuma loja existente muda de aparência', () => {
    expect(sql).not.toMatch(/update\s+restaurantes/i)
    expect(sql).not.toMatch(/update\s+grupos_cardapio/i)
  })

  it('é idempotente', () => {
    const adds = sql.match(/add column/g) ?? []
    const guards = sql.match(/add column if not exists/g) ?? []
    expect(guards.length).toBe(adds.length)
  })
})
