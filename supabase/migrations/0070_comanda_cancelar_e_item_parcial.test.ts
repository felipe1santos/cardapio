import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0070_comanda_cancelar_e_item_parcial.sql'), 'utf8')

function corpo(nome: string): string {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`)
  expect(inicio, nome).toBeGreaterThan(-1)
  return sql.slice(inicio, sql.indexOf('end $$;', inicio))
}

describe('0070 — cancelar comanda e transferir parte de uma linha', () => {
  it('comanda cancelada é estado, nunca DELETE', () => {
    expect(sql).toMatch(/check \(status in \('aberta', 'fechada', 'transferida', 'cancelada'\)\)/)
    expect(sql).not.toMatch(/delete from public\.(comandas|pedidos|pedido_itens|pagamentos_comanda)/)
  })

  it('cancelar comanda exige motivo e recusa conta com dinheiro recebido', () => {
    const f = corpo('comanda_cancelar')
    expect(f).toMatch(/raise exception 'motivo_obrigatorio'/)
    expect(f).toMatch(/raise exception 'comanda_com_pagamento:%'/)
    expect(f).toMatch(/raise exception 'comanda_nao_aberta'/)
    expect(f).toMatch(/for update/)
  })

  it('cancelar comanda libera a mesa: sessão, rascunho e chamado', () => {
    const f = corpo('comanda_cancelar')
    expect(f).toMatch(/update public\.sessoes_mesa set status = 'encerrada'/)
    expect(f).toMatch(/update public\.selecoes_mesa s set encerrada_em = now\(\)/)
    expect(f).toMatch(/update public\.chamados_mesa set status = 'expirado'/)
  })

  it('cancelar comanda derruba os lançamentos pelo caminho de sempre, sem reimprimir', () => {
    const f = corpo('comanda_cancelar')
    expect(f).toMatch(/set status = 'cancelado'/)
    expect(f).toMatch(/reimprimir = false/)
  })

  it('cancelar comanda audita com estado anterior, novo e motivo', () => {
    expect(corpo('comanda_cancelar')).toMatch(/'de', 'aberta', 'para', 'cancelada'/)
    expect(corpo('comanda_cancelar')).toMatch(/'conta\.cancelou_comanda'/)
  })

  it('transferência parcial preserva preço, complementos e observação', () => {
    const f = corpo('itens_transferir')
    expect(f).toMatch(/insert into public\.pedido_itens[\s\S]*?complementos[\s\S]*?tamanho_nome/)
    expect(f).toMatch(/v_linha\.preco_unitario/)
    expect(f).toMatch(/v_linha\.observacao/)
    expect(f).toMatch(/set quantidade = quantidade - v_linha\.mover/)
  })

  it('transferência não reimprime na cozinha o que já foi produzido', () => {
    expect(corpo('itens_transferir')).toMatch(/v_comanda_destino, true, p_ator, p_ator_nome/)
  })

  it('transferência recusa destino inativo, bloqueado ou quantidade inválida', () => {
    const f = corpo('itens_transferir')
    expect(f).toMatch(/raise exception 'destino_inativo'/)
    expect(f).toMatch(/raise exception 'destino_bloqueado'/)
    expect(f).toMatch(/raise exception 'quantidade_invalida'/)
    expect(f).toMatch(/raise exception 'quantidades_incompativeis'/)
  })

  it('item cancelado, pago ou de outra loja não é transferido', () => {
    const f = corpo('itens_transferir')
    expect(f).toMatch(/it\.cancelado_em is null/)
    expect(f).toMatch(/p\.restaurante_id = p_restaurante/)
    expect(f).toMatch(/p\.status <> 'cancelado'/)
    expect(f).toMatch(/c\.status = 'aberta'/)
  })

  it('a assinatura antiga de itens_transferir é removida para não ficar ambígua', () => {
    expect(sql).toMatch(/drop function if exists public\.itens_transferir\(uuid, uuid\[\], uuid, uuid, text\);/)
  })

  it('as duas funções ficam só com service_role', () => {
    const bloqueio = sql.slice(sql.indexOf('foreach f in array array['))
    expect(bloqueio).toContain("'comanda_cancelar(")
    expect(bloqueio).toContain("'itens_transferir(")
  })

  it('todas as funções fixam search_path e são security definer', () => {
    const decls = [...sql.matchAll(/create or replace function public\.\w+\([\s\S]*?\) returns [\s\S]*?as \$\$/g)]
    expect(decls.length).toBe(2)
    for (const d of decls) {
      expect(d[0]).toContain('security definer')
      expect(d[0]).toContain('set search_path = public')
    }
  })
})
