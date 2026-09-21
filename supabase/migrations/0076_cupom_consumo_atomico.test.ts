import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0076_cupom_consumo_atomico.sql'), 'utf8')

function corpo(nome: string): string {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`)
  expect(inicio, nome).toBeGreaterThan(-1)
  const resto = sql.slice(inicio)
  const fim = resto.indexOf('$$;')
  return resto.slice(0, fim > -1 ? fim : resto.length)
}

describe('0076 — cupom: consumo atômico e trava por cliente', () => {
  it('a reserva é um UPDATE condicional — é ele que serializa a corrida', () => {
    const f = corpo('cupom_reservar_uso')
    expect(f).toMatch(/update cupons/)
    expect(f).toMatch(/set usos = usos \+ 1/)
    expect(f).toMatch(/max_usos is null or usos < max_usos/)
    expect(f).toMatch(/returning true into v_ok/)
  })

  it('a reserva confere a loja e o cupom ativo, não só o id', () => {
    const f = corpo('cupom_reservar_uso')
    expect(f).toMatch(/restaurante_id = p_restaurante_id/)
    expect(f).toMatch(/and ativo/)
  })

  it('quem perde a corrida recebe false, não null', () => {
    expect(corpo('cupom_reservar_uso')).toMatch(/coalesce\(v_ok, false\)/)
  })

  it('a devolução existe e nunca deixa o contador negativo', () => {
    const f = corpo('cupom_devolver_uso')
    expect(f).toMatch(/greatest\(0, usos - 1\)/)
    expect(f).toMatch(/restaurante_id = p_restaurante_id/)
  })

  it('uso único por cliente vira índice ÚNICO, no lugar do índice solto de antes', () => {
    expect(sql).toMatch(/drop index if exists idx_cupom_usos_cliente;/)
    expect(sql).toMatch(/create unique index if not exists idx_cupom_usos_cliente\s*\n?\s*on cupom_usos \(cupom_id, cliente_telefone\)/)
  })

  it('teto zero é recusado pelo banco; vazio continua sendo ilimitado', () => {
    expect(sql).toMatch(/check \(max_usos is null or max_usos >= 1\)/)
  })

  /** Migration que converte dado já derrubou loja aqui antes — esta é só aditiva. */
  it('não converte nem apaga dado existente', () => {
    expect(sql).not.toMatch(/\bdelete from\b/i)
    expect(sql).not.toMatch(/\bdrop table\b/i)
    expect(sql).not.toMatch(/update cupons set usos = 0/i)
  })
})
