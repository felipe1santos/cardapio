import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 03/11/2026: cada imagem com mensagem própria; card só liga com imagem; sem "pular hoje" na rodada. */
const sql = readFileSync('supabase/migrations/0246_disparos_recorrentes_imagem_mensagem.sql', 'utf8')

describe('0246 imagem com mensagem', () => {
  it('converte a lista de texto antiga para objetos, sem mexer no que já é objeto', () => {
    expect(sql).toMatch(/update public\.campanha_recorrentes r/)
    expect(sql).toMatch(/jsonb_build_object\('url', t\.x #>> '\{\}', 'mensagem', ''\)/)
    expect(sql).toMatch(/jsonb_typeof\(y\) = 'string'/)
  })
  it('trigger: cada imagem é objeto com URL https; card ligado precisa de 1 imagem', () => {
    expect(sql).toMatch(/jsonb_typeof\(x\) <> 'object' or jsonb_typeof\(x -> 'url'\) <> 'string' or \(x ->> 'url'\) !~ '\^https:\/\/'/)
    expect(sql).toMatch(/if new\.ativa and jsonb_array_length\(new\.imagens\) = 0 then/)
    expect(sql).toMatch(/errcode = '23514'/)
  })
  it('rodada usa a imagem da vez e a mensagem dela (com fallback para a mensagem padrão)', () => {
    expect(sql).toMatch(/v\.imagens -> v_idx ->> 'url'/)
    expect(sql).toMatch(/coalesce\(nullif\(v\.imagens -> v_idx ->> 'mensagem', ''\), v\.mensagem\)/)
  })
  it('sem o passo de pular hoje na rodada', () => {
    const rod = sql.slice(sql.indexOf('function public.campanha_recorrentes_gerar_rodadas()'))
    expect(rod).not.toMatch(/pulado/)
    expect(rod).not.toMatch(/pular_ate/)
  })
})
