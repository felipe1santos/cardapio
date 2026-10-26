import { describe, it, expect } from 'vitest'
import { itensDoMenu, NAV_ITEMS } from './menu-lateral'
import { caminhoPermitidoCompleto } from './acessos'

const temMesas = (papel: string | null, moduloMesas: boolean) =>
  itensDoMenu({ papel, moduloMesas, usaLogistica: true }).some((i) => i.href === '/admin/mesas')

describe('menu lateral: "Mesas e Comandas"', () => {
  it('é item próprio do menu principal, logo depois do PDV', () => {
    const hrefs = NAV_ITEMS.map((i) => i.href)
    expect(hrefs.indexOf('/admin/mesas')).toBe(hrefs.indexOf('/admin/pdv') + 1)
    expect(NAV_ITEMS.find((i) => i.href === '/admin/mesas')?.label).toBe('Mesas e Comandas')
  })

  it('com o módulo ligado aparece para dono, gerente, garçom e atendente/caixa', () => {
    for (const papel of ['dono', 'gerente', 'garcom', 'atendente']) {
      expect(temMesas(papel, true), papel).toBe(true)
    }
  })

  it('com o módulo ligado NÃO aparece para quem não tem acesso ao salão', () => {
    for (const papel of ['cozinha', 'logistica', 'entregador', 'sommelier']) {
      expect(temMesas(papel, true), papel).toBe(false)
    }
  })

  it('com o módulo desligado não aparece para ninguém, nem com o papel ainda desconhecido', () => {
    for (const papel of ['dono', 'gerente', 'garcom', 'atendente', null]) {
      expect(temMesas(papel, false), String(papel)).toBe(false)
    }
  })

  it('o garçom com o módulo ligado vê só o salão (nada de delivery, PDV ou Ajustes)', () => {
    const hrefs = itensDoMenu({ papel: 'garcom', moduloMesas: true, usaLogistica: true }).map((i) => i.href)
    expect(hrefs).toEqual(['/admin/mesas'])
  })

  it('o resto do menu não depende da flag de mesas', () => {
    const com = itensDoMenu({ papel: 'dono', moduloMesas: true, usaLogistica: true }).map((i) => i.href)
    const sem = itensDoMenu({ papel: 'dono', moduloMesas: false, usaLogistica: true }).map((i) => i.href)
    expect(com.filter((h) => h !== '/admin/mesas')).toEqual(sem)
  })
})

describe('menu lateral: limpeza', () => {
  it('Auditoria não tem item no menu (a tela continua acessível pelo endereço)', () => {
    expect(NAV_ITEMS.some((i) => (i.href as string) === '/admin/auditoria')).toBe(false)
    expect(itensDoMenu({ papel: 'dono', moduloMesas: true, usaLogistica: true }).some((i) => (i.label as string) === 'Auditoria')).toBe(false)
  })

  /**
   * O selo "Novo" é marcação temporária de seção recém-lançada. Hoje vale só
   * para Campanhas (disparo de mensagem); espalhá-lo por todo item tiraria o
   * efeito de chamar atenção.
   */
  it('só Campanhas leva o selo de novidade', () => {
    const comSelo = NAV_ITEMS.filter((i) => 'novidade' in i).map((i) => i.href)
    expect(comSelo).toEqual(['/admin/campanhas'])
  })
})

describe('Financeiro no menu (0132)', () => {
  const hrefs = (o: Partial<Parameters<typeof itensDoMenu>[0]>) =>
    itensDoMenu({ papel: 'dono', moduloMesas: false, usaLogistica: true, ...o }).map((i) => i.href)
  const liberado = { financeiro: true, agente_ia: true, disparos: true }
  it('módulo liberado e flag desligada: some (sem módulo liberado aparece com cadeado — 0176)', () => {
    expect(hrefs({ modulos: liberado })).not.toContain('/admin/financeiro')
    expect(hrefs({ financeiro: false, modulos: liberado })).not.toContain('/admin/financeiro')
  })
  it('aparece com a flag e permissão, logo depois de Pedidos (antes Logística)', () => {
    const h = hrefs({ financeiro: true, modulos: liberado })
    expect(h.indexOf('/admin/financeiro')).toBe(h.indexOf('/admin/lista-pedidos') + 1)
  })
})

describe('Módulos pagos no menu (0176)', () => {
  const itens = (modulos: Parameters<typeof itensDoMenu>[0]['modulos'], financeiro = true) =>
    itensDoMenu({ papel: 'dono', moduloMesas: false, usaLogistica: true, financeiro, modulos })
  it('bloqueado: o item continua no menu, marcado com cadeado', () => {
    const l = itens({ financeiro: false, agente_ia: false, disparos: false })
    expect(l.find((i) => i.href === '/admin/financeiro')?.bloqueado).toBe('financeiro')
    expect(l.find((i) => i.href === '/admin/campanhas')?.bloqueado).toBe('disparos')
    // Agente de IA fica em Ajustes (com cadeado lá), não no menu principal.
    expect(l.some((i) => i.href === '/admin/agente-ia')).toBe(false)
  })
  it('carregando (sem a informação): trata como bloqueado', () => {
    expect(itens(null).find((i) => i.href === '/admin/campanhas')?.bloqueado).toBe('disparos')
  })
  it('liberado: item normal; Financeiro liberado mas desligado na loja some como antes', () => {
    const l = itens({ financeiro: true, agente_ia: true, disparos: true })
    expect(l.find((i) => i.href === '/admin/financeiro')?.bloqueado).toBeUndefined()
    expect(itens({ financeiro: true, agente_ia: true, disparos: true }, false).some((i) => i.href === '/admin/financeiro')).toBe(false)
  })
  it('garçom não vê Financeiro bloqueado nem Campanhas (permissão vem antes do cadeado)', () => {
    const h = itensDoMenu({ papel: 'garcom', moduloMesas: true, usaLogistica: true, modulos: null }).map((i) => i.href)
    expect(h).not.toContain('/admin/campanhas')
    expect(h).not.toContain('/admin/agente-ia')
  })
})

describe('Reorganização dos menus (10/10/2026; todas as lojas desde 16/10)', () => {
  it('Agente de IA e Impressão saíram do menu principal', () => {
    const l = itensDoMenu({ papel: 'dono', moduloMesas: true, usaLogistica: true, financeiro: true, modulos: { financeiro: true, agente_ia: true, disparos: true } })
    expect(l.map((i) => i.href)).not.toContain('/admin/agente-ia')
    expect(l.map((i) => i.href)).not.toContain('/admin/impressao')
    expect(l.find((i) => i.label === 'Ajustes')?.href).toBe('/admin/ajustes')
  })
  it('gerente (sem Ajustes, com Impressão) vê "Ajustes" abrindo direto na Impressão', () => {
    const l = itensDoMenu({ papel: 'gerente', moduloMesas: true, usaLogistica: true, modulos: null })
    expect(l.find((i) => i.label === 'Ajustes')?.href).toBe('/admin/ajustes/impressao')
  })
  it('garçom, atendente, cozinha e logística não ganham Ajustes nem Impressão', () => {
    for (const papel of ['garcom', 'atendente', 'cozinha', 'logistica']) {
      const l = itensDoMenu({ papel, moduloMesas: true, usaLogistica: true, modulos: null })
      expect(l.some((i) => i.label === 'Ajustes'), papel).toBe(false)
    }
  })
})

describe('todo item do menu tem ícone', () => {
  it('cada href do menu tem desenho no sidebar', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('components/layout/sidebar.tsx', 'utf8')
    for (const papel of ['dono', 'gerente']) {
      const l = itensDoMenu({ papel, moduloMesas: true, usaLogistica: true, financeiro: true, modulos: { financeiro: true, agente_ia: true, disparos: true } })
      // Ícones Lucide desde 25/10: `'/admin/x': NomeDoIcone,`
      for (const i of l) expect(new RegExp(`'${i.href}': [A-Z]\\w+,`).test(src), `${i.href} sem ícone`).toBe(true)
    }
  })
})

describe('KDS (prévia, 12/10)', () => {
  it('13/10: KDS em todas as lojas e a "Cozinha" antiga fora do menu', () => {
    const menu = itensDoMenu({ papel: 'dono', moduloMesas: false, usaLogistica: true }).map((i) => i.href)
    expect(menu).toContain('/admin/kds')
    expect(menu).not.toContain('/admin/cozinha')
  })
})

describe('menu por usuário (12/10, perfis com KDS)', () => {
  const menu = (papel: string, areas: string[]) => itensDoMenu({ papel, moduloMesas: true, usaLogistica: true, financeiro: true, modulos: { financeiro: true, agente_ia: true, disparos: true } })
    .filter((i) => caminhoPermitidoCompleto(i.href, papel, { areas: areas as never, sensiveis: [] }))
    .map((i) => i.href)
  it('Cozinha vê só o KDS', () => expect(menu('atendente', ['kds'])).toEqual(['/admin/kds']))
  it('Garçom vê só Mesas e Comandas', () => expect(menu('garcom', ['mesas'])).toEqual(['/admin/mesas']))
  it('Caixa vê Painel de Pedidos, PDV e Mesas', () => expect(menu('atendente', ['pedidos', 'pdv', 'mesas']).sort()).toEqual(['/admin/mesas', '/admin/pdv', '/admin/pedidos']))
})
