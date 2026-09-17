import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0067_conta_pagamentos_transferencias.sql'), 'utf8')

/** Corpo de uma função plpgsql, do `create or replace` até o `end $$`. */
function corpo(nome: string): string {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`)
  expect(inicio, nome).toBeGreaterThan(-1)
  return sql.slice(inicio, sql.indexOf('end $$;', inicio))
}

describe('0067 — conta, pagamentos e transferências', () => {
  it('loja existente não passa a cobrar taxa de serviço: default 0', () => {
    expect(sql).toMatch(/taxa_servico_padrao numeric\(5,2\) not null default 0;/)
    expect(sql).toMatch(/taxa_servico_percentual numeric\(5,2\) not null default 0;/)
  })

  it('status da comanda mantém os valores que já existem', () => {
    expect(sql).toMatch(/check \(status in \('aberta', 'fechada', 'transferida'\)\)/)
  })

  it('pagamentos: só leitura para papéis da mesa, escrita só pelas funções', () => {
    expect(sql).toMatch(/revoke all on public\.pagamentos_comanda from anon, authenticated;/)
    expect(sql).toMatch(/grant select on public\.pagamentos_comanda to authenticated;/)
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*pagamentos_comanda/)
    expect(sql).toMatch(/auth_papel\(\) in \('dono', 'gerente', 'garcom'\)/)
  })

  it('toda função da conta é tirada de anon/authenticated e dada só ao service_role', () => {
    const funcoes = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1])
    const bloqueio = sql.slice(sql.indexOf('ninguém chama isto de fora'))
    for (const f of funcoes.filter((f) => f !== 'comanda_herdar_taxa')) {
      expect(bloqueio, f).toContain(`'${f}(`)
    }
    expect(bloqueio).toContain("revoke execute on function public.%s from public, anon, authenticated")
  })

  it('pagamento não tem folga de centavo acima do restante', () => {
    const f = corpo('comanda_registrar_pagamento')
    expect(f).toMatch(/if round\(p_valor, 2\) > v_restante then/)
    expect(f).not.toMatch(/v_restante \+ 0\.01/)
  })

  it('pagamento trava a comanda e reconfere a chave DEPOIS da trava', () => {
    const f = corpo('comanda_registrar_pagamento')
    const trava = f.indexOf('for update')
    expect(trava).toBeGreaterThan(-1)
    expect(f.indexOf('chave_idempotencia = p_chave', trava)).toBeGreaterThan(trava)
    expect(f).toMatch(/exception when unique_violation/)
  })

  it('fechar recusa com saldo', () => {
    expect(corpo('comanda_fechar')).toMatch(/raise exception 'saldo_restante:%'/)
  })

  it('trocar de mesa: ocupada só com confirmação, e o pedido passa a dizer a mesa nova', () => {
    const f = corpo('mesa_transferir')
    expect(f).toMatch(/if not coalesce\(p_mesclar, false\) then raise exception 'destino_ocupado'/)
    expect(f).toMatch(/mesa = v_destino_nome/)
    expect(f).toMatch(/order by id for update/)
  })

  it('transferir parte de um lançamento não manda a cozinha fazer de novo', () => {
    expect(corpo('itens_transferir')).toMatch(/v_comanda_destino, true, p_ator, p_ator_nome/)
  })

  it('nada é apagado: cancelamento e estorno marcam, não removem', () => {
    expect(sql).not.toMatch(/delete from public\.(pedidos|pedido_itens|pagamentos_comanda|comandas)/)
  })
})
