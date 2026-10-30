import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/0235_storage_quarentena.sql', 'utf8')
const corpo = sql.slice(sql.indexOf('create table'))

describe('0235 quarentena do Storage', () => {
  it('nunca apaga arquivo: sem delete em storage.objects nem chamada de remoção', () => {
    expect(corpo).not.toMatch(/delete\s+from\s+storage\./i)
    expect(corpo).not.toMatch(/\.remove\(/)
  })

  it('só o servidor acessa', () => {
    expect(corpo).toMatch(/enable row level security/)
    expect(corpo).toMatch(/revoke all on public\.storage_quarentena from public, anon, authenticated/)
    expect(corpo).toMatch(/grant select, insert, update, delete on public\.storage_quarentena to service_role/)
    expect(corpo).toMatch(/revoke all on function public\.storage_quarentena_atualizar\(\) from public, anon, authenticated/)
    expect(corpo).toMatch(/set search_path = ''/)
  })

  it('protege o que não tem URL no banco e não trata varredura vazia como tudo órfão', () => {
    expect(corpo).toMatch(/o\.bucket_id = 'cardapio'/)
    expect(corpo).toMatch(/impressao\//)
    expect(corpo).toMatch(/\(select count\(\*\) from achados\) > 0/)
    expect(corpo).toMatch(/o\.name ~ '\^\[A-Za-z0-9\/\._-\]\+\$'/)
  })

  it('monta o SQL dinâmico com identificadores citados', () => {
    expect(corpo).toMatch(/format\('select %I::text v from public\.%I where %I::text like %L'/)
  })
})
