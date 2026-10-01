import { describe, expect, it } from 'vitest'
import {
  bairrosQueFicaramGratis,
  chaveDestinatario,
  dentroDoLimite,
  escolherCandidato,
  faltamParaPremio,
  gatilhoInativo,
  gatilhoRecompra,
  limitesEfetivos,
  minutosEntre,
  podeMarketingAgora,
  type Candidato,
} from './regras'
import { aplicarVariaveis, cortar, linkDaLoja, montarPayload, textoStatusPedido } from './conteudo'

const DIA = 24 * 3600_000
const AGORA = Date.UTC(2026, 9, 1, 18, 0)

describe('janela de envio do marketing', () => {
  it('loja aberta de dia → pode', () => {
    expect(podeMarketingAgora({ aberta: true, minutosParaAbrir: null, horaAgora: '12:00' }, 30)).toBe(true)
  })
  it('nunca de madrugada, mesmo aberta', () => {
    expect(podeMarketingAgora({ aberta: true, minutosParaAbrir: null, horaAgora: '01:30' }, 30)).toBe(false)
    expect(podeMarketingAgora({ aberta: true, minutosParaAbrir: null, horaAgora: '07:59' }, 30)).toBe(false)
  })
  it('fechada: só até N min antes de abrir', () => {
    expect(podeMarketingAgora({ aberta: false, minutosParaAbrir: 20, horaAgora: '17:40' }, 30)).toBe(true)
    expect(podeMarketingAgora({ aberta: false, minutosParaAbrir: 45, horaAgora: '17:15' }, 30)).toBe(false)
    expect(podeMarketingAgora({ aberta: false, minutosParaAbrir: null, horaAgora: '15:00' }, 30)).toBe(false)
    expect(podeMarketingAgora({ aberta: false, minutosParaAbrir: 10, horaAgora: '17:50' }, 0)).toBe(false)
  })
  it('minutosEntre', () => {
    expect(minutosEntre('17:40', '18:00')).toBe(20)
  })
})

describe('limite por cliente', () => {
  const lim = { limiteDia: 1, limiteSemana: 3 }
  it('1 por dia', () => {
    expect(dentroDoLimite([], AGORA, lim)).toBe(true)
    expect(dentroDoLimite([AGORA - 3600_000], AGORA, lim)).toBe(false)
    expect(dentroDoLimite([AGORA - 25 * 3600_000], AGORA, lim)).toBe(true)
  })
  it('3 por semana', () => {
    expect(dentroDoLimite([AGORA - 2 * DIA, AGORA - 3 * DIA, AGORA - 4 * DIA], AGORA, lim)).toBe(false)
    expect(dentroDoLimite([AGORA - 2 * DIA, AGORA - 3 * DIA, AGORA - 8 * DIA], AGORA, lim)).toBe(true)
  })
  it('a loja não passa do teto do sistema', () => {
    expect(limitesEfetivos({ limiteDia: 9, limiteSemana: 99 })).toEqual({ limiteDia: 3, limiteSemana: 10 })
  })
})

describe('prioridade, dedup e categorias', () => {
  const c = (tipo: Candidato['tipo'], chave: string = tipo): Candidato => ({ tipo, chave })
  const todas = ['pedido', 'promocoes', 'novidades', 'fidelidade']
  it('cupom > fidelidade > promoção > recompra', () => {
    expect(escolherCandidato([c('recompra'), c('loja_abriu'), c('fidelidade'), c('cupom_novo')], new Set(), todas)?.tipo).toBe('cupom_novo')
    expect(escolherCandidato([c('recompra'), c('loja_abriu'), c('fidelidade')], new Set(), todas)?.tipo).toBe('fidelidade')
    expect(escolherCandidato([c('recompra'), c('loja_abriu')], new Set(), todas)?.tipo).toBe('loja_abriu')
  })
  it('não repete a mesma chave', () => {
    expect(escolherCandidato([c('cupom_novo', 'cupom:1'), c('recompra', 'recompra:p1')], new Set(['cupom:1']), todas)?.chave).toBe('recompra:p1')
    expect(escolherCandidato([c('cupom_novo', 'cupom:1')], new Set(['cupom:1']), todas)).toBeNull()
  })
  it('respeita categoria desligada', () => {
    expect(escolherCandidato([c('cupom_novo'), c('item_novo')], new Set(), ['pedido', 'novidades'])?.tipo).toBe('item_novo')
    expect(escolherCandidato([c('fidelidade')], new Set(), ['pedido'])).toBeNull()
  })
})

describe('gatilhos', () => {
  it('recompra: só com 1 pedido, depois de X dias, até X+7', () => {
    expect(gatilhoRecompra(1, AGORA - 3 * DIA, AGORA, 3)).toBe(true)
    expect(gatilhoRecompra(1, AGORA - 2 * DIA, AGORA, 3)).toBe(false)
    expect(gatilhoRecompra(2, AGORA - 4 * DIA, AGORA, 3)).toBe(false)
    expect(gatilhoRecompra(1, AGORA - 11 * DIA, AGORA, 3)).toBe(false)
  })
  it('inativo: depois de X dias, repete a cada Y', () => {
    const ult = AGORA - 7 * DIA
    expect(gatilhoInativo(3, AGORA - 5 * DIA, AGORA, 6, 14)).toBeNull()
    const a = gatilhoInativo(3, ult, AGORA, 6, 14)
    expect(a?.chave).toBe(`inativo:${ult}:0`)
    expect(gatilhoInativo(3, ult, AGORA + 5 * DIA, 6, 14)).toBeNull() // meio da rodada
    expect(gatilhoInativo(3, ult, AGORA + 14 * DIA, 6, 14)?.chave).toBe(`inativo:${ult}:1`)
    expect(gatilhoInativo(0, ult, AGORA, 6, 14)).toBeNull()
  })
  it('fidelidade: faltam 1 ou 2', () => {
    expect(faltamParaPremio(10, 8)).toBe(2)
    expect(faltamParaPremio(10, 9)).toBe(1)
    expect(faltamParaPremio(10, 5)).toBeNull()
    expect(faltamParaPremio(10, 10)).toBeNull()
    expect(faltamParaPremio(null, 1)).toBeNull()
  })
  it('frete grátis: bairros novos, sem acento/caixa', () => {
    expect(bairrosQueFicaramGratis(['Centro'], ['centro', 'Praia da Costa', 'Itapuã'])).toEqual(['Praia da Costa', 'Itapuã'])
    expect(bairrosQueFicaramGratis(['Itapua'], ['Itapuã'])).toEqual([])
  })
  it('destinatário: telefone ou assinatura', () => {
    expect(chaveDestinatario({ id: 'a1', clienteTelefone: '5527999990000' })).toBe('tel:5527999990000')
    expect(chaveDestinatario({ id: 'a1', clienteTelefone: null })).toBe('ass:a1')
  })
})

describe('conteúdo', () => {
  it('corta com reticências', () => {
    expect(cortar('a'.repeat(200), 140)).toHaveLength(140)
    expect(cortar('a'.repeat(200), 140).endsWith('…')).toBe(true)
    expect(cortar('curto', 140)).toBe('curto')
  })
  it('variáveis; sem valor some sem deixar espaço', () => {
    expect(aplicarVariaveis('Bateu a fome, {nome}? Peça {produto}.', { nome: 'Ana', produto: 'X-Burger' })).toBe('Bateu a fome, Ana? Peça X-Burger.')
    expect(aplicarVariaveis('Bateu a fome, {nome}?', {})).toBe('Bateu a fome?')
  })
  it('link com origem e destino', () => {
    expect(linkDaLoja('menuzia', '', 'e1')).toBe('/loja/menuzia?push=e1')
    expect(linkDaLoja('menuzia', '?item=abc', 'e1')).toBe('/loja/menuzia?item=abc&push=e1')
    expect(linkDaLoja('menuzia', '?aba=pedidos')).toBe('/loja/menuzia?aba=pedidos')
  })
  it('payload com ícone, badge e link da loja', () => {
    const p = montarPayload({ slug: 'menuzia', lojaNome: 'Menuzia', versaoIcone: 'v1', texto: 'Oi', destino: '', envioId: 'e9', tipo: 'cupom_novo' })
    expect(p).toMatchObject({ title: 'Menuzia', body: 'Oi', icon: '/api/loja/menuzia/icone/192?v=v1', badge: '/api/loja/menuzia/push/badge?v=v1', tag: 'menuzia:cupom_novo' })
    expect(p.data.url).toBe('/loja/menuzia?push=e9')
    expect(p.image).toBeUndefined()
  })
  it('status do pedido', () => {
    expect(textoStatusPedido('preparando', 'entrega', 12)).toContain('aceito')
    expect(textoStatusPedido('em_rota', 'entrega', 12)).toContain('saiu para entrega')
    expect(textoStatusPedido('pronto', 'retirada', 12)).toContain('pronto para retirada')
    expect(textoStatusPedido('pronto', 'entrega', 12)).toBeNull()
    expect(textoStatusPedido('entregue', 'entrega', 12)).toBeNull()
  })
})
