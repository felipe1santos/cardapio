import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 01/11/2026 (Fase 6): tabelas que cresciam sem limite entram na retenção diária; a auditoria encadeada continua intocada (0237). */
const sql = readFileSync('supabase/migrations/0239_retencao_mais.sql', 'utf8')
const corpo = sql.slice(sql.indexOf('create or replace function'))

describe('0239 retenção das tabelas que faltavam', () => {
  it('redefine sistema_limpar_retencao sem tocar em eventos_auditoria', () => {
    expect(corpo).toMatch(/create or replace function public\.sistema_limpar_retencao\(\)/)
    expect(corpo).not.toMatch(/eventos_auditoria/)
  })
  it('mantém as 6 da 0237 e acrescenta webhooks, sessões, cache de geocode e códigos OTP', () => {
    for (const [t, col, prazo] of [
      ['whatsapp_eventos', 'criado_em', '90 days'], ['vitrine_eventos', 'criado_em', '13 months'], ['impressao_trabalhos', 'criado_em', '180 days'],
      ['api_alertas', 'criado_em', '180 days'], ['fin_alertas', 'criado_em', '180 days'], ['push_envios', 'criado_em', '180 days'],
      ['canal_eventos', 'processado_em', '90 days'], ['pagamentos_eventos', 'recebido_em', '90 days'], ['usuarios_sessoes', 'criado_em', '180 days'],
      ['geocode_cache', 'expira_em', '30 days'], ['cliente_codigos', 'expira_em', '1 day'],
    ]) expect(corpo).toMatch(new RegExp(`delete from public\\.${t} where ctid in \\(select ctid from public\\.${t} where [^;]*${col} < now\\(\\) - interval '${prazo}'[^;]*limit 20000\\)`))
  })
  it('só o servidor executa', () => {
    expect(corpo).toMatch(/revoke all on function public\.sistema_limpar_retencao\(\) from public, anon, authenticated/)
  })
})
