import { describe, it, expect } from 'vitest'
import { itensDoMenu, NAV_ITEMS } from './menu-lateral'

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

  it('nenhum item leva o selo "novidade"', () => {
    expect(NAV_ITEMS.some((i) => 'novidade' in i)).toBe(false)
  })
})
