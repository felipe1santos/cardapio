// 0204 (19/10/2026): restaurantes tem grant POR COLUNA para authenticated (0055/0056). A 0203 criou tempo_entrega e
// tempo_retirada sem grant e o Perfil/topo do painel abriram vazios em todas as lojas ("permission denied for table
// restaurantes"). Este teste varre as migrations depois da 0080 (que concedeu todas as colunas de então): toda coluna
// nova de public.restaurantes precisa de
// `grant select (…coluna…) on public.restaurantes to … authenticated`, ou estar na lista de colunas só de servidor.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(__dirname)
// Colunas que o painel (cliente, role authenticated) NÃO lê: só service_role no servidor. Adicionar aqui é decisão consciente.
const SO_SERVIDOR = new Set([
  'cartao_online_ativo', 'cartao_online_parcelas_max', 'controle_caixa_ativado_em', 'controle_caixa_ativado_por_nome',
  'controle_caixa_ativo', 'disparo_limite_dia', 'disparo_proximo_em', 'financeiro_ativo', 'impressao_agente_token',
  'impressao_beta_liberado', 'impressao_beta_modo', 'impressao_cozinha_transferida_em', 'impressao_sem_atualizacao',
  'mensagens_status', 'pix_online_ativo', 'pix_online_validade_min', 'push_liberado',
])

export function colunasSemGrant(arquivos: Array<{ nome: string; sql: string }>): string[] {
  const novas = new Set<string>()
  const comGrant = new Set<string>()
  for (const { nome, sql } of arquivos) {
    const numero = Number(nome.slice(0, 4))
    const s = sql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').toLowerCase()
    // A 0080 concedeu dinamicamente todas as colunas que existiam; só as criadas depois dela precisam de grant próprio.
    if (numero > 80) {
      for (const m of s.matchAll(/alter table (?:public\.)?restaurantes add column (?:if not exists )?(\w+)/g)) novas.add(m[1])
    }
    for (const m of s.matchAll(/grant select \(([^)]*)\) on (?:public\.)?restaurantes to ([^;]*);/g)) {
      if (!/\bauthenticated\b/.test(m[2])) continue
      for (const c of m[1].split(',')) comGrant.add(c.trim())
    }
    if (/grant select on (?:public\.)?restaurantes to [^;]*\bauthenticated\b/.test(s)) return []
  }
  return [...novas].filter((c) => !comGrant.has(c) && !SO_SERVIDOR.has(c)).sort()
}

describe('0204: coluna nova de restaurantes sem grant para o painel', () => {
  const arquivos = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).map((nome) => ({ nome, sql: readFileSync(join(DIR, nome), 'utf8') }))

  it('todas as colunas novas têm grant select para authenticated (ou são só de servidor)', () => {
    expect(colunasSemGrant(arquivos)).toEqual([])
  })

  it('reproduz o bug: sem a 0204, tempo_entrega e tempo_retirada ficam sem grant', () => {
    expect(colunasSemGrant(arquivos.filter((a) => !a.nome.startsWith('0204_')))).toEqual(['tempo_entrega', 'tempo_retirada'])
  })
})
