import { describe, it, expect } from 'vitest'
import {
  mapMesaRow,
  estadoDaMesa,
  urlPublicaDaMesa,
  proximoNomeDeMesa,
  resolverMesaPorToken,
  ROTULO_ESTADO,
  AJUDA_ESTADO,
} from './mesas'

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
      limpeza: null,
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
  const semConta = { aberta: false, qtdPedidos: 0 }
  const contaVazia = { aberta: true, qtdPedidos: 0 }
  const contaComPedido = { aberta: true, qtdPedidos: 2 }

  it('livre quando ativa, desbloqueada e sem comanda', () => {
    expect(estadoDaMesa({ ativa: true, bloqueada: false }, semConta)).toBe('livre')
  })

  /** A mesa sentada esperando alguém anotar: é o que o PDV já chamava de "Aguardando". */
  it('aguardando quando a comanda abriu e nada foi lançado', () => {
    expect(estadoDaMesa({ ativa: true, bloqueada: false }, contaVazia)).toBe('aguardando')
  })

  it('ocupada quando há comanda aberta com lançamento', () => {
    expect(estadoDaMesa({ ativa: true, bloqueada: false }, contaComPedido)).toBe('ocupada')
  })

  it('bloqueio vence o movimento', () => {
    expect(estadoDaMesa({ ativa: true, bloqueada: true }, contaComPedido)).toBe('bloqueada')
    expect(estadoDaMesa({ ativa: true, bloqueada: true }, contaVazia)).toBe('bloqueada')
  })

  it('cadastro vence tudo: mesa inativa não pisca ocupada por comanda esquecida', () => {
    expect(estadoDaMesa({ ativa: false, bloqueada: true }, contaComPedido)).toBe('inativa')
    expect(estadoDaMesa({ ativa: false, bloqueada: false }, contaComPedido)).toBe('inativa')
  })

  /** O salão e o PDV leem os mesmos rótulos: a mesma mesa não pode ter dois nomes. */
  it('todo estado tem rótulo e explicação', () => {
    for (const estado of ['livre', 'aguardando', 'ocupada', 'bloqueada', 'inativa'] as const) {
      expect(ROTULO_ESTADO[estado]).toBeTruthy()
      expect(AJUDA_ESTADO[estado]).toBeTruthy()
    }
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
      emLimpeza: false,
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
