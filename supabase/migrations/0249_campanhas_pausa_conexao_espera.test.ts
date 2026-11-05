import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 04/11/2026: sessão "zumbi" (Evolution diz conectado, envio falha "Connection Closed") virava pausa → retoma → falha
 * a cada minuto, sem gastar tentativa e sem fim. A pausa por conexão agora conta e espera cada vez mais; na 4ª seguida
 * o motivo vira 'whatsapp_instavel' (só a loja retoma). Um envio que sai zera a conta.
 */
const sql = readFileSync('supabase/migrations/0249_campanhas_pausa_conexao_espera.sql', 'utf8')
const fn = sql.slice(sql.indexOf('function public.campanha_concluir_envio('), sql.indexOf('end $$;', sql.indexOf('function public.campanha_concluir_envio(')))
const ramoPausa = fn.slice(fn.indexOf("if p_resultado = 'pausa'"), fn.indexOf("elsif p_resultado = 'enviado'"))
const ramoEnviado = fn.slice(fn.indexOf("elsif p_resultado = 'enviado'"), fn.indexOf("elsif p_resultado = 'transitorio'"))

describe('0249 pausa por conexão com espera e limite', () => {
  it('colunas novas na campanha, aditivas', () => {
    expect(sql).toMatch(/add column if not exists pausas_conexao smallint not null default 0/)
    expect(sql).toMatch(/add column if not exists retomar_apos timestamptz/)
  })
  it('cada pausa soma 1 e grava espera crescente (5 min, 15 min, 1 h)', () => {
    expect(ramoPausa).toMatch(/pausas_conexao = c\.pausas_conexao \+ 1/)
    expect(ramoPausa).toMatch(/when 1 then interval '5 minutes' when 2 then interval '15 minutes' else interval '60 minutes'/)
  })
  it("4ª pausa seguida: motivo 'whatsapp_instavel' (não retoma sozinho)", () => {
    expect(ramoPausa).toMatch(/when c\.pausas_conexao \+ 1 >= 4 then 'whatsapp_instavel' else 'whatsapp_desconectado'/)
  })
  it('a mensagem volta para a fila sem gastar tentativa (a loja caiu, não o contato) — como antes', () => {
    expect(ramoPausa).toMatch(/tentativas = greatest\(e\.tentativas - 1, 0\)/)
  })
  it('envio que sai zera a conta e a espera', () => {
    expect(ramoEnviado).toMatch(/pausas_conexao = 0, retomar_apos = null/)
  })
  it('função só para o servidor (service_role)', () => {
    expect(sql).toMatch(/revoke execute on function public\.campanha_concluir_envio\(uuid, text, text, text\) from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.campanha_concluir_envio\(uuid, text, text, text\) to service_role/)
  })
})
