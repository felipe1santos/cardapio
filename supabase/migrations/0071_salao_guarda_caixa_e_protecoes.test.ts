import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0071_salao_guarda_caixa_e_protecoes.sql'), 'utf8')

describe('0071 — guarda do módulo, caixa no salão e proteções de coluna', () => {
  it('a flag do módulo é uma função sem acesso anônimo', () => {
    expect(sql).toMatch(/create or replace function public\.auth_modulo_mesas\(\)/)
    expect(sql).toMatch(/revoke execute on function public\.auth_modulo_mesas\(\) from public, anon/)
  })

  it('regras do salão nascem com o comportamento da matriz oficial', () => {
    expect(sql).toMatch(/salao_garcom_recebe boolean not null default false/)
    expect(sql).toMatch(/salao_garcom_transfere boolean not null default true/)
    expect(sql).toMatch(/salao_caixa_desconto boolean not null default false/)
  })

  it('colunas do salão em restaurantes não mudam pelo JWT do usuário', () => {
    const f = sql.slice(sql.indexOf('function public.restaurantes_protege_salao'))
    for (const col of ['modulo_mesas_ativo', 'taxa_servico_padrao', 'formas_pagamento_mesa', 'salao_garcom_recebe']) {
      expect(f).toContain(`new.${col} is distinct from old.${col}`)
    }
    expect(f).toMatch(/auth\.role\(\), ''\) in \('authenticated', 'anon'\)/)
  })

  it('o caixa lê o salão, mas a escrita continua fora do navegador', () => {
    for (const pol of ['mesas_select', 'comandas_select', 'pagamentos_select']) {
      const trecho = sql.slice(sql.indexOf(`create policy ${pol}`), sql.indexOf(`create policy ${pol}`) + 300)
      expect(trecho, pol).toMatch(/'atendente'/)
    }
    // Nenhuma policy de escrita nova para o atendente.
    expect(sql).not.toMatch(/for (insert|update|delete)[\s\S]{0,200}'atendente'/)
  })

  it('o navegador não lê nem escreve o token do QR', () => {
    expect(sql).toMatch(/revoke select, insert, update on public\.mesas from authenticated/)
    const grants = sql.match(/grant (select|insert|update) \([^)]*\) on public\.mesas to authenticated/g) ?? []
    expect(grants.length).toBe(3)
    for (const g of grants) expect(g).not.toMatch(/\btoken\b/)
    for (const g of grants.filter((x) => !x.startsWith('grant select'))) {
      expect(g).not.toMatch(/bloqueada_em|qr_revogado_em/)
    }
  })

  it('mesa com histórico não é apagada; mesa com conta aberta não sai de operação', () => {
    expect(sql).toMatch(/raise exception 'mesa_com_historico'/)
    expect(sql).toMatch(/raise exception 'comanda_aberta'/)
    expect(sql).toMatch(/before update or delete on public\.mesas/)
  })

  it('auditoria ganha papel e correlação, preenchidos no banco', () => {
    expect(sql).toMatch(/eventos_auditoria add column if not exists papel text/)
    expect(sql).toMatch(/eventos_auditoria add column if not exists correlacao uuid/)
    expect(sql).toMatch(/x-correlacao/)
    // Cabeçalho malformado nunca derruba a operação auditada.
    expect(sql).toMatch(/exception when others then/)
  })

  it('não apaga dado nem converte formato existente', () => {
    expect(sql).not.toMatch(/\bdelete from\b/i)
    expect(sql).not.toMatch(/\bdrop table\b/i)
    expect(sql).not.toMatch(/update public\.(restaurantes|mesas|comandas)\s+set/i)
  })
})
