import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0068_chamados_mesa.sql'), 'utf8')

function corpo(nome: string): string {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`)
  expect(inicio, nome).toBeGreaterThan(-1)
  return sql.slice(inicio, sql.indexOf('end $$;', inicio))
}

describe('0068 — chamados de mesa', () => {
  it('o chamado não toca em pedido, comanda nem pagamento', () => {
    expect(sql).not.toMatch(/insert into public\.pedidos/)
    expect(sql).not.toMatch(/insert into public\.pedido_itens/)
    expect(sql).not.toMatch(/insert into public\.comandas/)
    expect(sql).not.toMatch(/pagamentos_comanda/)
  })

  it('só papéis do salão leem, e ninguém escreve pelo navegador', () => {
    expect(sql).toMatch(/auth_papel\(\) in \('dono', 'gerente', 'garcom'\)/)
    expect(sql).toMatch(/revoke all on public\.chamados_mesa from authenticated, anon;/)
    expect(sql).toMatch(/grant select on public\.chamados_mesa to authenticated;/)
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*chamados_mesa/)
  })

  it('uma mesa não acumula dois chamados abertos do mesmo motivo', () => {
    expect(sql).toMatch(/create unique index if not exists chamados_mesa_ativo_unq[\s\S]*?where status in \('pendente', 'assumido'\)/)
  })

  it('abrir: valida mesa, trava a linha, expira o abandonado e limita a frequência', () => {
    const f = corpo('chamado_abrir')
    expect(f).toMatch(/raise exception 'mesa_indisponivel'/)
    expect(f).toMatch(/from public\.mesas where id = p_mesa for update/)
    expect(f).toMatch(/set status = 'expirado'/)
    expect(f).toMatch(/raise exception 'muito_rapido:%'/)
    // Chamado repetido devolve o que existe em vez de estourar na cara do cliente.
    expect(f).toMatch(/'ja_existia', true/)
    expect(f).toMatch(/exception when unique_violation/)
  })

  it('assumir resolve a corrida no WHERE, não em leitura-depois-escrita', () => {
    const f = corpo('chamado_assumir')
    expect(f).toMatch(/where id = p_chamado and restaurante_id = p_restaurante and status = 'pendente'/)
    expect(f).toMatch(/raise exception 'ja_assumido:%'/)
  })

  it('concluir aceita pendente ou assumido e registra quem atendeu', () => {
    const f = corpo('chamado_concluir')
    expect(f).toMatch(/status in \('pendente', 'assumido'\)/)
    expect(f).toMatch(/assumido_por = coalesce\(assumido_por, p_ator\)/)
  })

  it('cada transição grava auditoria com estado anterior e novo', () => {
    expect(corpo('chamado_abrir')).toMatch(/'chamado\.criou'/)
    expect(corpo('chamado_assumir')).toMatch(/'de', 'pendente', 'para', 'assumido'/)
    expect(corpo('chamado_concluir')).toMatch(/'de', v_de, 'para', 'concluido'/)
  })

  it('toda função é tirada de anon/authenticated e dada só ao service_role', () => {
    const funcoes = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1])
    const bloqueio = sql.slice(sql.indexOf('ninguém chama isto de fora'))
    for (const f of funcoes) expect(bloqueio, f).toContain(`'${f}(`)
  })

  it('todas as funções fixam search_path e são security definer', () => {
    const decls = [...sql.matchAll(/create or replace function public\.\w+\([\s\S]*?\) returns [\s\S]*?as \$\$/g)]
    expect(decls.length).toBeGreaterThan(0)
    for (const d of decls) {
      expect(d[0]).toContain('security definer')
      expect(d[0]).toContain('set search_path = public')
    }
  })
})
