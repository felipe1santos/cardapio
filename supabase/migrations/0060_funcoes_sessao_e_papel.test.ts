import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0060_funcoes_sessao_e_papel.sql'), 'utf8')
const colunas = readFileSync(join(aqui, '0059_colunas_equipe_auditoria_modulo.sql'), 'utf8')

const FUNCOES = ['auth_papel()', 'auth_e_gestor()', 'auth_loja_valida(uuid)', 'auth_restaurante_id()']

describe('0060 — funções de sessão', () => {
  it('as quatro funções são security definer com search_path fixo', () => {
    const blocos = sql.split('create or replace function').slice(1)
    expect(blocos.length).toBe(4)
    for (const b of blocos) {
      expect(b).toMatch(/security definer/)
      expect(b).toMatch(/set search_path = public/)
      expect(b).toMatch(/\bstable\b/)
    }
  })

  it('referenciam objetos com schema explícito', () => {
    const blocos = sql.split('create or replace function').slice(1)
    for (const b of blocos) {
      const corpo = b.split('$$')[1] ?? ''
      // Nada de `from usuarios` solto: search_path fixo + schema explícito.
      expect(corpo).not.toMatch(/\bfrom\s+usuarios\b/)
      if (/from/.test(corpo)) expect(corpo).toMatch(/from\s+public\./)
    }
  })

  it('não montam SQL dinâmico', () => {
    expect(sql).not.toMatch(/\bexecute\s+(format|'|")/i)
  })

  it('nenhuma fica exposta como RPC pública', () => {
    for (const f of FUNCOES) {
      expect(sql).toContain(`revoke execute on function public.${f} from public;`)
      expect(sql).toContain(`grant execute on function public.${f} to authenticated;`)
    }
    expect(sql).not.toMatch(/grant execute[\s\S]*to anon/)
  })

  it('auth_restaurante_id barra desativado, não autorizado e loja inválida', () => {
    const corpo = sql.split('function public.auth_restaurante_id()')[1]
    expect(corpo).toMatch(/u\.desativado_em is null/)
    expect(corpo).toMatch(/u\.autorizado/)
    expect(corpo).toMatch(/public\.auth_loja_valida\(u\.restaurante_id\)/)
  })

  it('auth_loja_valida é regra de existência, sem single row', () => {
    const corpo = sql.split('function public.auth_loja_valida(p_restaurante uuid)')[1].split('$$')[1]
    expect(corpo).toMatch(/select exists \(/)
    expect(corpo).toMatch(/d\.papel = 'dono'/)
    expect(corpo).toMatch(/d\.acesso_expira_em is null or d\.acesso_expira_em > now\(\)/)
    expect(corpo).toMatch(/d\.desativado_em is null/)
    // `limit 1` + leitura de linha seria ambíguo com vários donos; exists não é.
    expect(corpo).not.toMatch(/limit 1/)
  })

  it('auth_e_gestor é allowlist de dois papéis', () => {
    expect(sql).toMatch(/auth_papel\(\) in \('dono', 'gerente'\)/)
  })

  it('as colunas que as funções leem nascem antes, na 0059', () => {
    expect(colunas).toMatch(/alter table public\.usuarios add column if not exists desativado_em/)
  })
})
