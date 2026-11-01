import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 01/11/2026 (Fase 6): a quarentena do Storage varria TODA coluna de texto/JSON do schema (information_schema) numa
 * requisição de 8 s — ia falhar em silêncio com as tabelas crescendo. Agora lê só as colunas que guardam URL do
 * bucket (as 16 encontradas em produção em 01/11). Continua sem apagar nada.
 */
const sql = readFileSync('supabase/migrations/0240_quarentena_lista_fixa.sql', 'utf8')
const corpo = sql.slice(sql.indexOf('create or replace function'))

describe('0240 quarentena com lista fixa de colunas', () => {
  it('não varre o schema inteiro nem apaga arquivo', () => {
    expect(corpo).not.toMatch(/information_schema/)
    expect(corpo).not.toMatch(/delete\s+from\s+storage\./i)
  })
  it('lista as colunas que guardam URL do bucket', () => {
    for (const c of ['itens_cardapio.imagem_url', 'itens_cardapio.imagem_thumb_url', 'itens_cardapio.video', 'item_complementos.imagem_url', 'pizza_sabores.imagem_url',
      'grupos_cardapio.imagem_url', 'preset_complemento_itens.imagem_url', 'restaurantes.logo_url', 'restaurantes.banner_url', 'restaurantes.banner_mobile_url',
      'restaurantes.mesa_carrossel_urls', 'restaurantes.banner_promo_video', 'campanhas.imagem_url', 'entregadores.foto_url', 'whatsapp_mensagens.midia_url', 'push_envios.payload']) {
      const [t, col] = c.split('.')
      expect(corpo).toMatch(new RegExp(`select ${col}::text v from public\\.${t} where ${col}::text like '%/cardapio/%'`))
    }
  })
  it('varredura vazia nunca vira "tudo órfão"; pasta impressao protegida', () => {
    expect(corpo).toMatch(/\(select count\(\*\) from achados\) > 0/)
    expect(corpo).toMatch(/impressao\//)
  })
})
