import { describe, expect, it } from 'vitest'
import type { PedidoDashboard } from '@/lib/queries/pedidos'
import {
  deCampoData,
  funilDePedidos,
  intervaloAnterior,
  intervaloDeCampos,
  intervaloDoPreset,
  paraCampoData,
  recorteDeClientes,
  rotuloDoIntervalo,
  serieDePedidos,
  textoVariacao,
  variacao,
} from './dashboard-metricas'

const DIA = 86_400_000
/** 23/09/2026, 15h — hora local, como o painel enxerga. */
const AGORA = new Date(2026, 8, 23, 15, 0, 0).getTime()

function pedido(over: Partial<PedidoDashboard> = {}): PedidoDashboard {
  return {
    total: 50,
    tipo: 'entrega',
    status: 'entregue',
    formaPagamento: 'pix',
    criadoEm: new Date(AGORA).toISOString(),
    clienteChave: null,
    enderecoRua: '',
    enderecoNumero: '',
    enderecoBairro: '',
    enderecoCep: '',
    itens: [],
    ...over,
  }
}

describe('intervalo dos atalhos', () => {
  it('hoje vai da meia-noite ao fim do dia', () => {
    const i = intervaloDoPreset('hoje', AGORA)
    expect(new Date(i.inicio).getHours()).toBe(0)
    expect(i.fim - i.inicio).toBe(DIA)
  })

  /** Sete dias CHEIOS terminando hoje — não "168 horas atrás". */
  it('7 dias cobre a semana corrente, incluindo hoje', () => {
    const i = intervaloDoPreset('7d', AGORA)
    expect(i.fim - i.inicio).toBe(7 * DIA)
    expect(new Date(i.inicio).getDate()).toBe(17)
  })

  it('ontem termina onde hoje começa', () => {
    const ontem = intervaloDoPreset('ontem', AGORA)
    const hoje = intervaloDoPreset('hoje', AGORA)
    expect(ontem.fim).toBe(hoje.inicio)
  })

  it('tudo não tem período anterior para comparar', () => {
    expect(intervaloAnterior(intervaloDoPreset('tudo', AGORA))).toBeNull()
  })

  it('o período anterior tem o mesmo tamanho e encosta no atual', () => {
    const atual = intervaloDoPreset('7d', AGORA)
    const anterior = intervaloAnterior(atual)!
    expect(anterior.fim).toBe(atual.inicio)
    expect(anterior.fim - anterior.inicio).toBe(atual.fim - atual.inicio)
  })
})

describe('variação', () => {
  it('sem base de comparação não inventa número', () => {
    expect(variacao(10, 0)).toBeNull()
    expect(textoVariacao(null)).toBeNull()
  })

  it('queda e alta vêm com sinal', () => {
    expect(variacao(50, 100)).toBe(-50)
    expect(textoVariacao(variacao(150, 100))).toBe('+50%')
    expect(textoVariacao(variacao(50, 100))).toBe('-50%')
  })
})

describe('funil de pedidos', () => {
  /**
   * O banco guarda só o estado atual. Um pedido entregue passou por todas as
   * etapas — se o funil contasse só o estado literal, "Aceitos" ficaria menor
   * que "Entregues" e o desenho inverteria.
   */
  it('quem está adiante conta nas etapas por onde passou', () => {
    const f = funilDePedidos([
      pedido({ status: 'entregue' }),
      pedido({ status: 'pronto' }),
      pedido({ status: 'recebido' }),
    ])
    expect(f.map((e) => e.qtd)).toEqual([3, 2, 2, 1, 1])
    expect(f[0].pct).toBe(100)
    expect(f[4].pct).toBe(33)
  })

  it('cancelado fica fora de todas as etapas', () => {
    const f = funilDePedidos([pedido({ status: 'cancelado' }), pedido({ status: 'recebido' })])
    expect(f[0].qtd).toBe(1)
  })

  it('compara cada etapa com o período anterior', () => {
    const f = funilDePedidos(
      [pedido({ status: 'entregue' }), pedido({ status: 'entregue' })],
      [pedido({ status: 'entregue' })],
    )
    expect(f[0].variacao).toBe(100)
  })

  it('período vazio não divide por zero', () => {
    const f = funilDePedidos([])
    expect(f.every((e) => e.qtd === 0 && e.pct === 0)).toBe(true)
  })
})

describe('clientes novos e recorrentes', () => {
  const intervalo = intervaloDoPreset('7d', AGORA)

  it('novo é quem fez o primeiro pedido da vida dentro do período', () => {
    const antigo = pedido({ clienteChave: 'c1', criadoEm: new Date(AGORA - 60 * DIA).toISOString() })
    const voltou = pedido({ clienteChave: 'c1' })
    const estreante = pedido({ clienteChave: 'c2' })
    const r = recorteDeClientes([voltou, estreante], [antigo, voltou, estreante], intervalo)

    expect(r.total).toBe(2)
    expect(r.novos).toBe(1)
    expect(r.recorrentes).toBe(1)
    expect(r.pctNovos).toBe(50)
  })

  it('o mesmo cliente com três pedidos conta como uma pessoa', () => {
    const p = [pedido({ clienteChave: 'c1' }), pedido({ clienteChave: 'c1' }), pedido({ clienteChave: 'c1' })]
    expect(recorteDeClientes(p, p, intervalo).total).toBe(1)
  })

  /** Balcão sem cadastro viraria um "cliente novo" por pedido. */
  it('pedido sem cliente identificado não vira cliente', () => {
    const r = recorteDeClientes([pedido(), pedido()], [pedido(), pedido()], intervalo)
    expect(r.total).toBe(0)
    expect(r.novos).toBe(0)
  })
})

describe('série do gráfico', () => {
  const intervalo = intervaloDoPreset('7d', AGORA)

  it('um ponto por dia do período', () => {
    const s = serieDePedidos([], [], intervalo, AGORA)
    expect(s).toHaveLength(7)
  })

  it('cada pedido cai no dia em que foi feito', () => {
    const ontem = new Date(AGORA - DIA).toISOString()
    const s = serieDePedidos([pedido({ criadoEm: ontem }), pedido()], [], intervalo, AGORA)
    expect(s[s.length - 1].total).toBe(1)
    expect(s[s.length - 2].total).toBe(1)
  })

  it('separa as linhas de novos e recorrentes', () => {
    const antigo = pedido({ clienteChave: 'c1', criadoEm: new Date(AGORA - 60 * DIA).toISOString() })
    const voltou = pedido({ clienteChave: 'c1' })
    const estreante = pedido({ clienteChave: 'c2' })
    const s = serieDePedidos([voltou, estreante], [antigo, voltou, estreante], intervalo, AGORA)
    const hoje = s[s.length - 1]
    expect(hoje.total).toBe(2)
    expect(hoje.novos).toBe(1)
    expect(hoje.recorrentes).toBe(1)
  })

  /** Um ano em passo diário viraria um pente ilegível de 365 pontos. */
  it('período longo agrupa por semana', () => {
    const s = serieDePedidos([], [], intervaloDoPreset('1a', AGORA), AGORA)
    expect(s.length).toBeLessThanOrEqual(53)
    expect(s.length).toBeGreaterThan(40)
  })

  it('soma a receita de cada balde', () => {
    const s = serieDePedidos([pedido({ total: 30 }), pedido({ total: 20 })], [], intervalo, AGORA)
    expect(s[s.length - 1].receita).toBe(50)
  })
})

describe('campos de data', () => {
  it('ida e volta pelo campo mantém o dia', () => {
    expect(paraCampoData(AGORA)).toBe('2026-09-23')
    expect(new Date(deCampoData('2026-09-23')!).getDate()).toBe(23)
  })

  /** `new Date('2026-09-23')` seria meia-noite UTC — no Brasil, dia 22 às 21h. */
  it('lê o campo como meia-noite local, não UTC', () => {
    const d = new Date(deCampoData('2026-09-23')!)
    expect(d.getHours()).toBe(0)
    expect(d.getDate()).toBe(23)
  })

  it('o intervalo dos campos inclui o último dia inteiro', () => {
    const i = intervaloDeCampos('2026-09-20', '2026-09-22')!
    expect(i.fim - i.inicio).toBe(3 * DIA)
  })

  it('datas invertidas são trocadas, não devolvem período vazio', () => {
    const i = intervaloDeCampos('2026-09-22', '2026-09-20')!
    expect(i.fim - i.inicio).toBe(3 * DIA)
  })

  it('campo vazio não vira intervalo', () => {
    expect(intervaloDeCampos('', '2026-09-22')).toBeNull()
  })
})

describe('rótulo do filtro', () => {
  it('mostra o começo e o último minuto do período', () => {
    const texto = rotuloDoIntervalo(intervaloDoPreset('hoje', AGORA), AGORA)
    expect(texto).toBe('23/09/2026 00:00 ~ 23/09/2026 23:59')
  })
})
