import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 03/11/2026: aquecimento do número (15/dia nos 3 cards, +5 a cada 5 dias), card só liga pronto, resumo do topo. */
const sql = readFileSync('supabase/migrations/0247_disparos_aquecimento.sql', 'utf8')

describe('0247 aquecimento', () => {
  it('limite: 15 + 5 a cada 5 dias desde a 1ª rodada de card; só service_role chama', () => {
    expect(sql).toMatch(/select 15 \+ 5 \* \(greatest\(0,/)
    expect(sql).toMatch(/\/ 5\)/)
    expect(sql).toMatch(/c\.recorrente_id is not null\),/)
    expect(sql).toMatch(/revoke execute on function public\.campanha_recorrente_limite_aquecimento\(uuid\) from public, anon, authenticated/)
  })
  it('rodada desconta o que os 3 cards já enfileiraram hoje; sem saldo marca limite_dia', () => {
    const rod = sql.slice(sql.indexOf('function public.campanha_recorrentes_gerar_rodadas()'))
    expect(rod).toMatch(/v_resta := public\.campanha_recorrente_limite_aquecimento\(v\.restaurante_id\)/)
    expect(rod).toMatch(/c\.recorrente_id is not null and c\.agendado_em >= v_hoje_inicio/)
    expect(rod).toMatch(/'limite_dia'/)
    expect(rod).toMatch(/v_limite := least\(v_limite, v_resta\)/)
    expect(sql).toMatch(/'ok', 'sem_publico', 'pulado', 'atrasado', 'limite_dia'/)
  })
  it('card só liga com imagem E mensagem para cada imagem', () => {
    expect(sql).toMatch(/if new\.ativa and jsonb_array_length\(new\.imagens\) = 0 then/)
    expect(sql).toMatch(/if new\.ativa and btrim\(new\.mensagem\) = ''/)
  })
  it('resumo: hoje e últimas 16 h, só gestor da própria loja', () => {
    const res = sql.slice(sql.indexOf('function public.campanha_recorrentes_resumo()'))
    expect(res).toMatch(/auth_e_gestor\(\)/)
    expect(res).toMatch(/interval '16 hours'/)
    for (const k of ['hoje_enviadas', 'limite_hoje', 'dias_para_subir', 'h16_enviadas', 'h16_perdidas', 'h16_pedidos', 'h16_receita']) expect(res).toContain(`'${k}'`)
    expect(sql).toMatch(/grant execute on function public\.campanha_recorrentes_resumo\(\) to authenticated/)
  })
})
