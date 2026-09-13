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

  it('documenta as duas colunas de foco da categoria', () => {
    expect(sql).toMatch(/comment on column grupos_cardapio\.imagem_foco_x is/)
    expect(sql).toMatch(/comment on column grupos_cardapio\.imagem_foco_y is/)
  })

  it("libera 'gaveta' na constraint de layout_cardapio, derrubando a da 0007", () => {
    // Sem isso o modo gaveta é rejeitado com 23514 e fica inalcançável.
    expect(sql).toMatch(
      /drop constraint if exists restaurantes_layout_cardapio_check/
    )
    const check = sql.match(
      /add constraint restaurantes_layout_cardapio_check\s*\n?\s*check \(layout_cardapio in \(([^)]*)\)\)/
    )
    expect(check).not.toBeNull()
    const valores = check![1].split(',').map((v) => v.trim().replace(/'/g, ''))
    expect(valores.sort()).toEqual(['categoria', 'gaveta', 'lista'])
    // Um typo como 'gavetta' continua rejeitado: a lista é fechada.
    expect(valores).not.toContain('gavetta')
    // O drop vem antes do add — senão o add falha com a constraint antiga viva.
    expect(sql.indexOf('drop constraint if exists restaurantes_layout_cardapio_check'))
      .toBeLessThan(sql.indexOf('add constraint restaurantes_layout_cardapio_check'))
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
