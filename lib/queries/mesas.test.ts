import { describe, it, expect } from 'vitest'
import { mapMesaRow, estadoDaMesa, urlPublicaDaMesa, proximoNomeDeMesa, resolverMesaPorToken } from './mesas'

const LINHA = {
  id: 'm1',
  restaurante_id: 'r1',
  nome: 'Mesa 1',
  ordem: 2,
  ativa: true,
  criado_em: 'x',
  setor: 'Varanda',
  capacidade: 4,
  bloqueada_em: null,
  token_gerado_em: 'y',
  qr_revogado_em: null,
}

describe('mapMesaRow', () => {
  it('mapeia uma linha do banco para Mesa', () => {
    expect(mapMesaRow(LINHA)).toEqual({
      id: 'm1',
      nome: 'Mesa 1',
      ordem: 2,
      ativa: true,
      setor: 'Varanda',
      capacidade: 4,
      bloqueada: false,
      tokenGeradoEm: 'y',
      qrRevogado: false,
    })
  })

  it('a Mesa nunca carrega o token do QR (0071)', () => {
    expect(Object.keys(mapMesaRow(LINHA))).not.toContain('token')
  })

  it('QR revogado é derivado do carimbo', () => {
    expect(mapMesaRow({ ...LINHA, qr_revogado_em: '2026-09-18T10:00:00Z' }).qrRevogado).toBe(true)
  })

  it('trata ativa ausente como true', () => {
    expect(mapMesaRow({ ...LINHA, ativa: null }).ativa).toBe(true)
  })

  it('bloqueada é derivada do carimbo de bloqueio', () => {
    expect(mapMesaRow({ ...LINHA, bloqueada_em: '2026-09-16T10:00:00Z' }).bloqueada).toBe(true)
  })
})

describe('estadoDaMesa', () => {
  it('livre quando ativa, desbloqueada e sem comanda', () => {
    expect(estadoDaMesa({ ativa: true, bloqueada: false }, false)).toBe('livre')
  })

  it('ocupada quando há comanda aberta', () => {
    expect(estadoDaMesa({ ativa: true, bloqueada: false }, true)).toBe('ocupada')
  })

  it('bloqueio vence o movimento', () => {
    expect(estadoDaMesa({ ativa: true, bloqueada: true }, true)).toBe('bloqueada')
  })

  it('cadastro vence tudo: mesa inativa não pisca ocupada por comanda esquecida', () => {
    expect(estadoDaMesa({ ativa: false, bloqueada: true }, true)).toBe('inativa')
    expect(estadoDaMesa({ ativa: false, bloqueada: false }, true)).toBe('inativa')
  })
})

describe('urlPublicaDaMesa', () => {
  it('monta a URL com o token e sem expor a loja', () => {
    const url = urlPublicaDaMesa('https://app.menuzia.com.br', 'abc-123')
    expect(url).toBe('https://app.menuzia.com.br/mesa/abc-123')
  })

  it('não duplica a barra final', () => {
    expect(urlPublicaDaMesa('http://localhost:3000/', 'tok')).toBe('http://localhost:3000/mesa/tok')
  })
})

describe('proximoNomeDeMesa', () => {
  it('continua a numeração existente', () => {
    expect(proximoNomeDeMesa([{ nome: 'Mesa 01' }, { nome: 'Mesa 02' }])).toBe('Mesa 03')
  })

  it('ignora nomes fora do padrão ao calcular o próximo número', () => {
    expect(proximoNomeDeMesa([{ nome: 'Mesa 07' }, { nome: 'Varanda' }, { nome: 'Balcão' }])).toBe('Mesa 08')
  })

  it('começa do 01 quando não há mesa nenhuma', () => {
    expect(proximoNomeDeMesa([])).toBe('Mesa 01')
  })

  it('cai num contador quando nenhum nome segue o padrão', () => {
    expect(proximoNomeDeMesa([{ nome: 'Varanda' }, { nome: 'Balcão' }])).toBe('Mesa 03')
  })
})

// ── resolução do token público ──────────────────────────────────────────────

function supabaseComMesa(row: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
      }),
    }),
  } as never
}

const TOKEN = '22222222-2222-4222-8222-222222222222'
const MESA_OK = {
  id: 'm1',
  nome: 'Mesa 01',
  ativa: true,
  bloqueada_em: null,
  restaurante_id: 'r1',
  restaurantes: { slug: 'loja', modulo_mesas_ativo: true },
}

describe('resolverMesaPorToken', () => {
  it('resolve mesa ativa de loja com o módulo ligado', async () => {
    await expect(resolverMesaPorToken(supabaseComMesa(MESA_OK), TOKEN)).resolves.toEqual({
      mesaId: 'm1',
      mesaNome: 'Mesa 01',
      restauranteId: 'r1',
      slug: 'loja',
    })
  })

  it('recusa token que não é uuid, sem nem consultar o banco', async () => {
    const explode = { from: () => { throw new Error('não devia consultar') } } as never
    for (const ruim of ['', 'abc', '../admin', '1 or 1=1', 'm1']) {
      await expect(resolverMesaPorToken(explode, ruim)).resolves.toBeNull()
    }
  })

  it('recusa token inexistente', async () => {
    await expect(resolverMesaPorToken(supabaseComMesa(null), TOKEN)).resolves.toBeNull()
  })

  it('recusa mesa inativa', async () => {
    await expect(resolverMesaPorToken(supabaseComMesa({ ...MESA_OK, ativa: false }), TOKEN)).resolves.toBeNull()
  })

  it('recusa mesa bloqueada', async () => {
    const bloqueada = { ...MESA_OK, bloqueada_em: '2026-09-16T10:00:00Z' }
    await expect(resolverMesaPorToken(supabaseComMesa(bloqueada), TOKEN)).resolves.toBeNull()
  })

  it('recusa QR revogado sem substituto (0071)', async () => {
    const revogada = { ...MESA_OK, qr_revogado_em: '2026-09-18T10:00:00Z' }
    await expect(resolverMesaPorToken(supabaseComMesa(revogada), TOKEN)).resolves.toBeNull()
  })

  it('recusa loja com o módulo desligado — a flag vale também na rota pública', async () => {
    const desligado = { ...MESA_OK, restaurantes: { slug: 'loja', modulo_mesas_ativo: false } }
    await expect(resolverMesaPorToken(supabaseComMesa(desligado), TOKEN)).resolves.toBeNull()
  })
})
