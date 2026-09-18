import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0072_conta_desconto_numero_e_cancelamento.sql'), 'utf8')

function corpo(nome: string): string {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`)
  expect(inicio, nome).toBeGreaterThan(-1)
  const fim = sql.indexOf('end $$;', inicio)
  return sql.slice(inicio, fim > -1 ? fim : sql.indexOf('$$;', inicio + 10))
}

describe('0072 — conta: desconto %, número, fiado, pedido de cancelamento, motivo', () => {
  it('comanda existente mantém o desconto em reais e fica sem número', () => {
    expect(sql).toMatch(/desconto_tipo text not null default 'valor'/)
    expect(sql).toMatch(/add column if not exists numero int;/)
    expect(sql).not.toMatch(/update public\.comandas set numero/)
  })

  it('número da comanda é sequencial por loja, sob trava da linha da loja', () => {
    const f = corpo('comanda_numerar')
    expect(f).toMatch(/update public\.restaurantes set comanda_seq = comanda_seq \+ 1/)
    expect(sql).toMatch(/comandas_numero_unq[\s\S]*\(restaurante_id, numero\)/)
  })

  it('desconto percentual é recalculado nos totais e nunca deixa a conta negativa', () => {
    const f = sql.slice(sql.indexOf('create or replace function public.comanda_totais('))
    expect(f).toMatch(/when c\.tipo = 'percentual' then round\(base\.sub \* c\.desc_pct \/ 100, 2\)/)
    expect(f).toMatch(/least\(desc_pedido, sub \+ taxa\)/)
  })

  it('ajuste de valores trava a comanda, exige motivo e confere o pago', () => {
    const f = corpo('comanda_ajustar_valores')
    expect(f).toMatch(/for update/)
    expect(f).toMatch(/raise exception 'motivo_obrigatorio'/)
    expect(f).toMatch(/comanda_conferir_pago/)
    expect(f).toMatch(/'conta\.removeu_taxa'/)
  })

  it('fiado exige observação; pagamento continua idempotente', () => {
    const f = corpo('comanda_registrar_pagamento')
    expect(f).toMatch(/raise exception 'fiado_sem_observacao'/)
    expect(f).toMatch(/chave_idempotencia = p_chave/)
    expect(f).toMatch(/exception when unique_violation/)
    // A assinatura antiga sai: sobrecarga com default seria ambígua.
    expect(sql).toMatch(/drop function if exists public\.comanda_registrar_pagamento\(uuid, uuid, text, numeric, numeric, text, uuid, text\)/)
  })

  it('cancelar item ou lançamento não deixa pago maior que o total', () => {
    expect(corpo('item_cancelar')).toMatch(/comanda_conferir_pago/)
    expect(corpo('pedido_mesa_cancelar')).toMatch(/comanda_conferir_pago/)
    expect(corpo('pedido_mesa_cancelar')).toMatch(/for update/)
  })

  it('pedido de cancelamento: um pendente por alvo, e a conta não fecha com ele', () => {
    expect(sql).toMatch(/solicitacoes_cancelamento_pendente_unq[\s\S]*where status = 'pendente'/)
    expect(corpo('comanda_fechar')).toMatch(/raise exception 'cancelamento_pendente:%'/)
    const decidir = corpo('cancelamento_decidir')
    expect(decidir).toMatch(/raise exception 'solicitacao_decidida'/)
    expect(decidir).toMatch(/for update/)
  })

  it('alvo cancelado por outro caminho resolve a solicitação (não trava o fechamento)', () => {
    expect(sql).toMatch(/create trigger solicitacoes_resolver_pedido after update of status on public\.pedidos/)
    expect(sql).toMatch(/create trigger solicitacoes_resolver_item after update of cancelado_em on public\.pedido_itens/)
  })

  it('transferências exigem motivo e o gravam na trilha', () => {
    for (const f of ['mesa_transferir', 'itens_transferir']) {
      const c = corpo(f)
      expect(c, f).toMatch(/raise exception 'motivo_obrigatorio'/)
      expect(c, f).toMatch(/'motivo', v_motivo/)
    }
    expect(sql).toMatch(/drop function if exists public\.mesa_transferir\(uuid, uuid, uuid, boolean, uuid, text\)/)
    expect(sql).toMatch(/drop function if exists public\.itens_transferir\(uuid, uuid\[\], uuid, uuid, text, int\[\]\)/)
  })

  it('fechar a conta encerra os chamados abertos da mesa', () => {
    expect(corpo('comanda_fechar')).toMatch(/update public\.chamados_mesa set status = 'expirado'/)
  })

  it('nenhuma função nova é RPC pública', () => {
    expect(sql).toMatch(/revoke execute on function public\.%s from public, anon, authenticated/)
    for (const f of ['comanda_ajustar_valores', 'cancelamento_solicitar', 'cancelamento_decidir', 'pedido_mesa_cancelar']) {
      expect(sql, f).toContain(`'${f}(`)
    }
  })

  it('dinheiro e histórico nunca são apagados', () => {
    expect(sql).not.toMatch(/delete from public\.(comandas|pedidos|pedido_itens|pagamentos_comanda|solicitacoes_cancelamento)/)
  })
})
