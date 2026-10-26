import { describe, expect, it } from 'vitest'
import { assinarSessao, lerSessaoAssinada } from './sessao-assinada'

/**
 * Egress (26/10): cada chamada a /api/admin/* conferia o login duas vezes — no middleware e de novo em
 * getCurrentSession (getUser no Auth + leitura de `usuarios`), ~30 mil consultas/dia. O middleware passa o que já
 * conferiu num cabeçalho interno assinado; a rota só aceita com assinatura válida e dentro do prazo.
 */

const SEGREDO = 'segredo-de-teste'
const sessao = { userId: 'u1', restauranteId: 'r1', papel: 'dono', nome: 'Ana', email: 'a@b.c' }
const AGORA = 1_000_000_000_000

describe('sessão assinada', () => {
  it('ida e volta', async () => {
    const v = await assinarSessao(sessao, SEGREDO, AGORA)
    expect(await lerSessaoAssinada(v, SEGREDO, AGORA + 1000)).toEqual(sessao)
  })

  it('adulterada (papel trocado) não vale', async () => {
    const v = await assinarSessao(sessao, SEGREDO, AGORA)
    const [corpo, assinatura] = v.split('.')
    const outro = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(corpo, 'base64url').toString()), papel: 'dono', restauranteId: 'OUTRA' })).toString('base64url')
    expect(await lerSessaoAssinada(`${outro}.${assinatura}`, SEGREDO, AGORA)).toBeNull()
  })

  it('outro segredo não vale', async () => {
    const v = await assinarSessao(sessao, SEGREDO, AGORA)
    expect(await lerSessaoAssinada(v, 'outro', AGORA)).toBeNull()
  })

  it('vencida (mais de 60 s) não vale', async () => {
    const v = await assinarSessao(sessao, SEGREDO, AGORA)
    expect(await lerSessaoAssinada(v, SEGREDO, AGORA + 61_000)).toBeNull()
  })

  it('lixo, vazio ou sem segredo não vale', async () => {
    expect(await lerSessaoAssinada('abc', SEGREDO, AGORA)).toBeNull()
    expect(await lerSessaoAssinada(null, SEGREDO, AGORA)).toBeNull()
    expect(await lerSessaoAssinada(await assinarSessao(sessao, SEGREDO, AGORA), '', AGORA)).toBeNull()
  })
})
