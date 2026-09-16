import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0055_seg_restaurantes_colunas_publicas.sql'), 'utf8')
const cardapio = readFileSync(join(aqui, '..', '..', 'lib', 'queries', 'cardapio.ts'), 'utf8')

/** Colunas concedidas a `anon` no grant explícito da migration. */
function colunasConcedidas(): string[] {
  const bloco = sql.match(/grant select \(([\s\S]*?)\) on public\.restaurantes to anon;/)
  expect(bloco).not.toBeNull()
  return bloco![1]
    .split(',')
    .map((c) => c.replace(/--.*$/gm, '').trim())
    .filter(Boolean)
}

/** Colunas que `buscarRestaurantePorSlug` lê — o único caminho anônimo. */
function colunasDaVitrine(): string[] {
  const sel = cardapio.match(/export async function buscarRestaurantePorSlug[\s\S]*?\.select\(\s*'([^']+)'/)
  expect(sel).not.toBeNull()
  return sel![1].split(',').map((c) => c.trim())
}

describe('0055 — anon perde o SELECT de tabela em restaurantes', () => {
  it('revoga tudo de anon antes de conceder', () => {
    expect(sql).toMatch(/revoke all on public\.restaurantes from anon;/)
    // A ordem importa: conceder antes de revogar apagaria o grant novo.
    expect(sql.indexOf('revoke all on public.restaurantes from anon'))
      .toBeLessThan(sql.indexOf('grant select ('))
  })

  it('NÃO concede o token do Assistente de Impressão', () => {
    expect(colunasConcedidas()).not.toContain('impressao_agente_token')
  })

  it('não concede nenhuma outra coluna sensível ou interna', () => {
    const concedidas = colunasConcedidas()
    for (const proibida of [
      'impressao_agente_token',
      'impressao_agente_impressora_id',
      'impressao_agente_visto_em',
      'evolution_instance',
      'despacho_aberto',
      'usa_logistica',
      'latitude',
      'longitude',
      'cep',
      'endereco_rua',
      'endereco_numero',
      'endereco_complemento',
      'endereco_estado',
    ]) {
      expect(concedidas).not.toContain(proibida)
    }
    // Nenhuma coluna de impressão escapa por descuido.
    expect(concedidas.filter((c) => c.startsWith('impressao_'))).toEqual([])
  })

  it('concede exatamente o que a vitrine lê, sem sobra', () => {
    const concedidas = colunasConcedidas()
    const daVitrine = colunasDaVitrine()
    // `frete_fora_da_lista` nasce na 0054 (congelada) e entra pelo bloco condicional.
    const esperadas = daVitrine.filter((c) => c !== 'frete_fora_da_lista')
    expect([...concedidas].sort()).toEqual([...esperadas].sort())
  })

  it('cobre frete_fora_da_lista sem depender da ordem de aplicação da 0054', () => {
    expect(sql).toMatch(/information_schema\.columns[\s\S]*?column_name = 'frete_fora_da_lista'/)
    expect(sql).toMatch(/grant select \(frete_fora_da_lista\) on public\.restaurantes to anon/)
  })

  it('não lê, escreve nem altera linha nenhuma', () => {
    const comandos = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
    for (const c of comandos) {
      expect(c).not.toMatch(/^(insert|update|delete|truncate|drop table|alter table)\b/i)
    }
  })
})
