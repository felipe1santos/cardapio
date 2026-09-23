import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0056_seg_pedidos_sem_insert_anonimo.sql'), 'utf8')
const pedidos = readFileSync(join(aqui, '..', '..', 'lib', 'queries', 'pedidos.ts'), 'utf8')

describe('0056 — ninguém insere pedido direto no banco', () => {
  it('derruba as duas policies de INSERT anônimo', () => {
    expect(sql).toMatch(/drop policy if exists "Anyone can create pedidos" on public\.pedidos;/)
    expect(sql).toMatch(/drop policy if exists "Anyone can create pedido_itens" on public\.pedido_itens;/)
  })

  it('tira todo grant de anon nas duas tabelas', () => {
    expect(sql).toMatch(/revoke all on public\.pedidos from anon;/)
    expect(sql).toMatch(/revoke all on public\.pedido_itens from anon;/)
  })

  it('tira INSERT e DELETE de authenticated, mantendo o que o painel usa', () => {
    const revokePedidos = sql.match(/revoke ([\w, ]+) on public\.pedidos from authenticated;/)
    expect(revokePedidos).not.toBeNull()
    const revogados = revokePedidos![1].split(',').map((p) => p.trim())
    expect(revogados).toContain('insert')
    expect(revogados).toContain('delete')
    // O Kanban avança status e a impressão marca `impresso`/`reimprimir`:
    // SELECT e UPDATE em `pedidos` precisam sobreviver.
    expect(revogados).not.toContain('select')
    expect(revogados).not.toContain('update')
  })

  it('pedido_itens perde também o UPDATE — o painel só lê', () => {
    const revoke = sql.match(/revoke ([\w, ]+) on public\.pedido_itens from authenticated;/)
    expect(revoke).not.toBeNull()
    const revogados = revoke![1].split(',').map((p) => p.trim())
    expect(revogados).toEqual(expect.arrayContaining(['insert', 'delete', 'update']))
    expect(revogados).not.toContain('select')
  })

  it('a criação legítima continua sendo só a do servidor', () => {
    // Se algum dia `criarPedido` deixar de receber o client admin, ou alguém
    // inserir pedido de outro lugar, este teste precisa ser revisto junto.
    const insercoes = pedidos.match(/\.from\('pedidos'\)\s*\n?\s*\.insert/g) ?? []
    expect(insercoes.length).toBe(1)
    expect(pedidos).toMatch(/export async function criarPedido\(\s*admin: SupabaseClient/)
  })

  it('não mexe em dado nenhum', () => {
    // Só comandos de verdade: comentários falam de `update`/`insert` e os
    // `revoke` citam os privilégios pelo nome.
    const comandos = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
    for (const c of comandos) {
      expect(c).not.toMatch(/^(insert|update|delete|truncate)\b/i)
    }
  })
})
