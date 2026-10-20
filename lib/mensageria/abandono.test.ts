import { describe, expect, it } from 'vitest'
import { conversaAbandonada, TEXTO_RETORNO_ROBO, VOLTAR_MIN_PADRAO } from './abandono'

/** Etapa 4 (20/10): loja assumiu e sumiu → robô/IA volta sozinho depois de X min sem resposta à mensagem do cliente. */
const agora = Date.parse('2026-10-20T02:00:00Z')
const iso = (min: number) => new Date(agora - min * 60_000).toISOString()
const base = { id: 'c1', estado: 'silenciada', atendimento: 'humano', atendente_nome: 'Ana', silenciada_motivo: 'painel', silenciada_em: iso(30), ultima_origem: 'cliente', ultima_mensagem_em: iso(6) }

describe('conversa abandonada pela loja', () => {
  it('assumiu no painel, cliente escreveu há 6 min e ninguém respondeu → volta (padrão 5 min)', () => {
    expect(conversaAbandonada(base, agora, VOLTAR_MIN_PADRAO)).toBe(true)
  })
  it('cliente escreveu há 3 min → ainda dentro do prazo', () => {
    expect(conversaAbandonada({ ...base, ultima_mensagem_em: iso(3) }, agora, 5)).toBe(false)
  })
  it('a loja respondeu por último → nunca volta', () => {
    expect(conversaAbandonada({ ...base, ultima_origem: 'atendente' }, agora, 5)).toBe(false)
    expect(conversaAbandonada({ ...base, ultima_origem: 'loja' }, agora, 5)).toBe(false)
  })
  it('respondeu pelo celular (sem atendente no painel) conta como humano', () => {
    expect(conversaAbandonada({ ...base, atendente_nome: null, silenciada_motivo: 'celular' }, agora, 5)).toBe(true)
  })
  it('pausou o robô sem ninguém responder (sem atendente, motivo painel) → não é abandono', () => {
    expect(conversaAbandonada({ ...base, atendente_nome: null, silenciada_motivo: 'painel' }, agora, 5)).toBe(false)
  })
  it('a mensagem do cliente é anterior ao assumir (foi o que motivou assumir) → não volta', () => {
    expect(conversaAbandonada({ ...base, silenciada_em: iso(2), ultima_mensagem_em: iso(6) }, agora, 5)).toBe(false)
  })
  it('conversa já no robô ou encerrada → nada', () => {
    expect(conversaAbandonada({ ...base, estado: 'robo', atendimento: 'robo' }, agora, 5)).toBe(false)
    expect(conversaAbandonada({ ...base, atendimento: 'encerrada' }, agora, 5)).toBe(false)
  })
  it('prazo configurável: 20 min segura mais', () => {
    expect(conversaAbandonada(base, agora, 20)).toBe(false)
    expect(conversaAbandonada({ ...base, ultima_mensagem_em: iso(25) }, agora, 20)).toBe(true)
  })
  it('texto de retorno pede desculpas e oferece continuar', () => {
    expect(TEXTO_RETORNO_ROBO).toContain('Desculpe a demora')
    expect(TEXTO_RETORNO_ROBO).toContain('continuar seu pedido')
  })
})
