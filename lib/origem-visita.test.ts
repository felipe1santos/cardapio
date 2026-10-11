import { describe, expect, it } from 'vitest'
import { atribuirOrigem, canalDaOrigem, capturarOrigem, descreverOrigem, JANELA_ATRIBUICAO_MS, origemDoPedido, textoDaVisita, primeiraOrigem } from './origem-visita'

const cap = (busca: string, referrer = '') => capturarOrigem({ busca, referrer, hostAtual: 'app.menuzia.com.br' })

describe('captura e canal de cada origem', () => {
  const casos: [string, string, string][] = [
    ['', '', 'direto'],
    ['', 'https://app.menuzia.com.br/loja/x', 'direto'],
    ['?utm_source=instagram', '', 'instagram'],
    ['?utm_source=ig&utm_medium=paid', '', 'instagram'],
    ['', 'https://l.instagram.com/?u=x', 'instagram'],
    ['?utm_source=fb', '', 'facebook'],
    ['', 'https://m.facebook.com/', 'facebook'],
    ['', 'https://l.facebook.com/l.php', 'facebook'],
    ['?utm_source=an', '', 'meta'],
    ['?fbclid=IwAR123', '', 'meta'],
    ['?gclid=Cj0KCQ', '', 'google_anuncio'],
    ['?utm_source=google&utm_medium=cpc', '', 'google_anuncio'],
    ['', 'https://www.google.com/', 'google_busca'],
    ['', 'https://www.google.com.br/', 'google_busca'],
    ['?utm_source=whatsapp&utm_medium=campanha&utm_campaign=sexta', '', 'whatsapp'],
    ['', 'https://l.wl.co/l?u=x', 'whatsapp'],
    ['', 'https://wa.me/55', 'whatsapp'],
    ['?utm_source=qrcode&utm_medium=qr', '', 'qrcode'],
    ['', 'https://trello.com/b/x', 'outros'],
  ]
  for (const [busca, ref, canal] of casos) {
    it(`${busca || '(sem parâmetro)'} ${ref || ''} → ${canal}`, () => { expect(canalDaOrigem(cap(busca, ref))).toBe(canal) })
  }
  it('utm vence o referrer; o texto da visita é compatível com o antigo', () => {
    const o = cap('?utm_source=IG', 'https://l.facebook.com/')
    expect(o.fonte).toBe('ig')
    expect(textoDaVisita(o)).toBe('ig')
    expect(textoDaVisita(cap(''))).toBe('Direto')
    expect(textoDaVisita(cap('?gclid=1'))).toBe('google-ads')
  })
  it('textos antigos gravados nas visitas também viram canal', () => {
    expect(canalDaOrigem({ fonte: 'Direto', meio: null, clique: null })).toBe('direto')
    expect(canalDaOrigem({ fonte: 'adsmanager.facebook.com', meio: null, clique: null })).toBe('meta')
  })
})

describe('atribuição: última origem não-direta em 7 dias', () => {
  const agora = 1_760_000_000_000
  it('origem nova não-direta vence e é guardada', () => {
    const r = atribuirOrigem(cap('?utm_source=instagram'), null, agora)
    expect(r.atribuida.canal).toBe('instagram')
    expect(r.guardar?.canal).toBe('instagram')
  })
  it('visita direta não apaga a origem de ontem', () => {
    const ontem = atribuirOrigem(cap('?utm_source=whatsapp&utm_campaign=x'), null, agora - 86_400_000).guardar
    const r = atribuirOrigem(cap(''), ontem, agora)
    expect(r.atribuida.canal).toBe('whatsapp')
    expect(r.guardar).toBeNull()
  })
  it('passou de 7 dias: volta a Direto', () => {
    const velha = atribuirOrigem(cap('?utm_source=ig'), null, agora - JANELA_ATRIBUICAO_MS - 1000).guardar
    expect(atribuirOrigem(cap(''), velha, agora).atribuida.canal).toBe('direto')
  })
})

describe('origem que chega com o pedido', () => {
  it('o canal é recalculado no servidor (o navegador não escolhe)', () => {
    expect(origemDoPedido({ canal: 'google_anuncio', fonte: 'ig' }).canal).toBe('instagram')
    expect(origemDoPedido(null).canal).toBe('direto')
    expect(origemDoPedido({ fonte: '<script>', campanha: 'x'.repeat(200) }).detalhe.campanha?.length).toBeLessThanOrEqual(80)
  })
  it('descrição para a dica do card', () => {
    expect(descreverOrigem('instagram', { campanha: 'festa' })).toBe('Instagram (campanha festa)')
    expect(descreverOrigem('direto', null)).toBe('Direto')
    expect(descreverOrigem(null)).toBeNull()
  })
})

describe('primeira origem e utm_content (Bloco 2, 10/10/2026)', () => {
  it('captura utm_content (os 3 links do Google se distinguem por ele)', () => {
    const o = capturarOrigem({ busca: '?utm_source=google&utm_medium=perfil&utm_content=site', referrer: '', hostAtual: 'app.menuzia.com.br' })
    expect(o.conteudo).toBe('site')
    expect(canalDaOrigem(o)).toBe('google_busca')
  })
  it('primeira origem: guardada só na 1ª abertura (mesmo direta) e nunca mais trocada', () => {
    const google = capturarOrigem({ busca: '?utm_source=google&utm_medium=perfil&utm_content=cardapio', referrer: '', hostAtual: 'x' })
    const insta = capturarOrigem({ busca: '?utm_source=instagram&utm_medium=bio', referrer: '', hostAtual: 'x' })
    const a = primeiraOrigem(google, null, 1000)
    expect(a.primeira.canal).toBe('google_busca')
    expect(a.guardar).not.toBeNull()
    const b = primeiraOrigem(insta, a.guardar, 2000)
    expect(b.primeira.canal).toBe('google_busca')
    expect(b.guardar).toBeNull()
    const direta = primeiraOrigem(capturarOrigem({ busca: '', referrer: '', hostAtual: 'x' }), null, 1)
    expect(direta.primeira.canal).toBe('direto')
  })
  it('servidor: guarda a primeira e o conteúdo no detalhe, recalculando o canal', () => {
    const d = origemDoPedido({ fonte: 'instagram', meio: 'bio', conteudo: 'link-bio', canal: 'google_anuncio' }, { fonte: 'google', meio: 'perfil', conteudo: 'site', canal: 'qrcode' })
    expect(d.canal).toBe('instagram')
    expect(d.detalhe.conteudo).toBe('link-bio')
    expect(d.detalhe.primeira).toEqual({ canal: 'google_busca', fonte: 'google', meio: 'perfil', campanha: null, conteudo: 'site' })
    // Vitrine antiga (sem primeira): continua igual ao de antes
    expect(origemDoPedido({ fonte: 'instagram' }).detalhe.primeira).toBeUndefined()
  })
})
