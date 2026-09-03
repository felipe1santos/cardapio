import { describe, it, expect } from 'vitest'
import { assinaturaPendencias, avaliarSetup, contarPorMenu, type DadosSetup } from './setup-checklist'

/** Loja completa: nenhuma pendência. Cada teste estraga só o que quer testar. */
function lojaOk(): DadosSetup {
  return {
    config: {
      telefone: '27999999999',
      logoUrl: 'https://exemplo/logo.png',
      bannerUrl: 'https://exemplo/capa.png',
      enderecoRua: 'Rua das Flores',
      enderecoNumero: '123',
      enderecoBairro: 'Centro',
      enderecoCidade: 'Vila Velha',
      enderecoEstado: 'ES',
      taxaEntregaPadrao: 5,
      horarioFuncionamento: { '1': [{ abre: '18:00', fecha: '23:00' }] },
      statusLoja: 'automatico',
      usaLogistica: true,
      aceitaEntrega: true,
      aceitaRetirada: true,
    },
    itensDisponiveis: 12,
    itensSemFoto: 0,
    itensSemPreco: 0,
    itensSemDiaDaSemana: 0,
    categorias: 3,
    temTaxaPorBairro: true,
    temTaxaPorRaio: false,
    entregadoresCadastrados: 2,
  }
}

const ids = (d: DadosSetup) => avaliarSetup(d).map((p) => p.id)

describe('avaliarSetup', () => {
  it('não acusa nada numa loja configurada', () => {
    expect(avaliarSetup(lojaOk())).toEqual([])
  })

  it('acusa os dois canais de venda desligados', () => {
    const d = lojaOk()
    d.config.aceitaEntrega = false
    d.config.aceitaRetirada = false
    expect(ids(d)).toContain('sem-canal')
    expect(avaliarSetup(d).find((p) => p.id === 'sem-canal')?.severidade).toBe('critico')
  })

  it('acusa loja travada fechada', () => {
    const d = lojaOk()
    d.config.statusLoja = 'fechado_manual'
    expect(ids(d)).toContain('loja-fechada-manual')
  })

  it('acusa cardápio sem item disponível', () => {
    const d = lojaOk()
    d.itensDisponiveis = 0
    expect(ids(d)).toContain('sem-item-disponivel')
  })

  it('só cobra categoria quando já existe item disponível', () => {
    const semCategoria = lojaOk()
    semCategoria.categorias = 0
    expect(ids(semCategoria)).toContain('sem-categoria')

    const cardapioVazio = lojaOk()
    cardapioVazio.categorias = 0
    cardapioVazio.itensDisponiveis = 0
    // Cardápio vazio já é acusado por "sem item" — não vale repetir a bronca.
    expect(ids(cardapioVazio)).toContain('sem-item-disponivel')
    expect(ids(cardapioVazio)).not.toContain('sem-categoria')
  })

  it('acusa telefone vazio ou incompleto e aceita número com DDI', () => {
    const vazio = lojaOk()
    vazio.config.telefone = ''
    expect(ids(vazio)).toContain('sem-telefone')

    const curto = lojaOk()
    curto.config.telefone = '2799999'
    expect(ids(curto)).toContain('sem-telefone')

    const comDdi = lojaOk()
    comDdi.config.telefone = '+55 (27) 99999-9999'
    expect(ids(comDdi)).not.toContain('sem-telefone')
  })

  it('endereço incompleto é crítico com entrega e atenção só com retirada', () => {
    const comEntrega = lojaOk()
    comEntrega.config.enderecoCidade = ''
    expect(avaliarSetup(comEntrega).find((p) => p.id === 'endereco-incompleto')?.severidade).toBe('critico')

    const soRetirada = lojaOk()
    soRetirada.config.enderecoCidade = '   '
    soRetirada.config.aceitaEntrega = false
    expect(avaliarSetup(soRetirada).find((p) => p.id === 'endereco-incompleto')?.severidade).toBe('atencao')
  })

  it('acusa entrega ligada sem nenhuma taxa configurada', () => {
    const d = lojaOk()
    d.config.taxaEntregaPadrao = 0
    d.temTaxaPorBairro = false
    d.temTaxaPorRaio = false
    expect(ids(d)).toContain('sem-taxa-entrega')

    // Só o raio já basta pra não cobrar nada.
    const comRaio = lojaOk()
    comRaio.config.taxaEntregaPadrao = 0
    comRaio.temTaxaPorBairro = false
    comRaio.temTaxaPorRaio = true
    expect(ids(comRaio)).not.toContain('sem-taxa-entrega')
  })

  it('não cobra taxa de entrega de loja que só faz retirada', () => {
    const d = lojaOk()
    d.config.aceitaEntrega = false
    d.config.taxaEntregaPadrao = 0
    d.temTaxaPorBairro = false
    d.temTaxaPorRaio = false
    expect(ids(d)).not.toContain('sem-taxa-entrega')
  })

  it('acusa grade de horário ausente só no modo automático', () => {
    const automatico = lojaOk()
    automatico.config.horarioFuncionamento = null
    expect(ids(automatico)).toContain('sem-horario')

    const abertoNaMao = lojaOk()
    abertoNaMao.config.horarioFuncionamento = null
    abertoNaMao.config.statusLoja = 'aberto_manual'
    expect(ids(abertoNaMao)).not.toContain('sem-horario')
  })

  it('acusa logística ligada sem entregador, e cala com o módulo desligado', () => {
    const comLogistica = lojaOk()
    comLogistica.entregadoresCadastrados = 0
    expect(ids(comLogistica)).toContain('sem-entregador')

    const semLogistica = lojaOk()
    semLogistica.entregadoresCadastrados = 0
    semLogistica.config.usaLogistica = false
    expect(ids(semLogistica)).not.toContain('sem-entregador')
  })

  it('acusa item disponível com preço zerado', () => {
    const d = lojaOk()
    d.itensSemPreco = 2
    const p = avaliarSetup(d).find((x) => x.id === 'itens-sem-preco')
    expect(p?.severidade).toBe('critico')
    expect(p?.titulo).toBe('2 itens disponíveis com preço zerado')
    expect(p?.href).toBe('/admin/cardapio')
  })

  it('acusa item disponível sem nenhum dia da semana marcado', () => {
    const d = lojaOk()
    d.itensSemDiaDaSemana = 1
    const p = avaliarSetup(d).find((x) => x.id === 'itens-sem-dia')
    expect(p?.severidade).toBe('critico')
    expect(p?.titulo).toBe('1 item marcado como disponível não aparece')
  })

  it('acusa logo, capa e itens sem foto', () => {
    const d = lojaOk()
    d.config.logoUrl = null
    d.config.bannerUrl = null
    d.itensSemFoto = 3
    const lista = avaliarSetup(d)
    expect(lista.map((p) => p.id)).toEqual(expect.arrayContaining(['sem-logo', 'sem-capa', 'itens-sem-foto']))
    expect(lista.find((p) => p.id === 'itens-sem-foto')?.titulo).toBe('3 itens disponíveis sem foto')
    expect(lista.every((p) => p.severidade === 'atencao')).toBe(true)
  })

  it('usa o singular quando só um item está sem foto', () => {
    const d = lojaOk()
    d.itensSemFoto = 1
    expect(avaliarSetup(d).find((p) => p.id === 'itens-sem-foto')?.titulo).toBe('1 item disponível sem foto')
  })

  it('coloca os críticos na frente dos avisos', () => {
    const d = lojaOk()
    d.config.logoUrl = null
    d.itensDisponiveis = 0
    const lista = avaliarSetup(d)
    expect(lista[0].severidade).toBe('critico')
    expect(lista[lista.length - 1].severidade).toBe('atencao')
  })
})

describe('contarPorMenu', () => {
  it('agrupa as pendências pelo item de menu que as resolve', () => {
    const d = lojaOk()
    d.config.logoUrl = null // ajustes
    d.config.bannerUrl = null // ajustes
    d.itensDisponiveis = 0 // cardápio
    expect(contarPorMenu(avaliarSetup(d))).toEqual({ '/admin/ajustes': 2, '/admin/cardapio': 1 })
  })

  it('devolve mapa vazio sem pendências', () => {
    expect(contarPorMenu([])).toEqual({})
  })
})

describe('assinaturaPendencias', () => {
  it('não muda com a ordem da lista', () => {
    const a = avaliarSetup({ ...lojaOk(), itensDisponiveis: 0 })
    expect(assinaturaPendencias(a)).toBe(assinaturaPendencias([...a].reverse()))
  })

  it('muda quando aparece pendência nova', () => {
    const antes = avaliarSetup({ ...lojaOk(), itensDisponiveis: 0 })
    const depois = avaliarSetup({ ...lojaOk(), itensDisponiveis: 0, itensSemFoto: 2 })
    expect(assinaturaPendencias(antes)).not.toBe(assinaturaPendencias(depois))
  })
})
