import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 01/11/2026 (auditoria de infraestrutura, Fase 2): a retenção NÃO pode apagar de `eventos_auditoria`. Cada linha dessa
 * tabela é encadeada por hash (0134) e `auditoria_verificar_cadeia` acusa "registro removido" no primeiro buraco — a
 * 0231 apagaria 70 mil `whatsapp.conexao` da PONTO 400 a partir de 25/11 e a tela Auditoria do Financeiro acusaria
 * adulteração. Esta migration redefine a função sem esse delete; o resto da retenção continua igual.
 */
const sql = readFileSync('supabase/migrations/0237_retencao_sem_auditoria.sql', 'utf8')
const corpo = sql.slice(sql.indexOf('create or replace function'))

describe('0237 retenção sem tocar na auditoria encadeada', () => {
  it('redefine sistema_limpar_retencao sem delete em eventos_auditoria', () => {
    expect(corpo).toMatch(/create or replace function public\.sistema_limpar_retencao\(\)/)
    expect(corpo).not.toMatch(/delete\s+from\s+public\.eventos_auditoria/i)
  })
  it('mantém as outras 6 tabelas da 0231 com os mesmos prazos', () => {
    for (const [tabela, prazo] of [['whatsapp_eventos', '90 days'], ['vitrine_eventos', '13 months'], ['impressao_trabalhos', '180 days'], ['api_alertas', '180 days'], ['fin_alertas', '180 days'], ['push_envios', '180 days']]) {
      expect(corpo).toMatch(new RegExp(`delete from public\\.${tabela} where ctid in \\(select ctid from public\\.${tabela} where [^;]*interval '${prazo}'`))
    }
  })
  it('só o servidor executa', () => {
    expect(corpo).toMatch(/revoke all on function public\.sistema_limpar_retencao\(\) from public, anon, authenticated/)
  })
})
