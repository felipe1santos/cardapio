import { describe, expect, it } from 'vitest'
import { linkQueroLiberar, moduloDoCaminho, whatsappComercial } from './modulos'
import { SUPORTE_MENUZIA } from './suporte'

describe('módulos pagos (0176)', () => {
  it('caminho → módulo (páginas e APIs); robô do WhatsApp e gráfico livres', () => {
    expect(moduloDoCaminho('/admin/financeiro')).toBe('financeiro')
    expect(moduloDoCaminho('/admin/financeiro/guia')).toBe('financeiro')
    expect(moduloDoCaminho('/api/admin/financeiro/caixa')).toBe('financeiro')
    expect(moduloDoCaminho('/api/admin/campanhas/123')).toBe('disparos')
    expect(moduloDoCaminho('/admin/agente-ia')).toBe('agente_ia')
    expect(moduloDoCaminho('/api/admin/whatsapp/robo')).toBeNull()
    expect(moduloDoCaminho('/api/admin/campanhas/automaticas')).toBeNull() // mensagens de status do pedido: livres
    expect(moduloDoCaminho('/api/admin/dashboard/custos')).toBeNull()
    expect(moduloDoCaminho('/api/admin/caixa')).toBeNull() // troco do motoboy no despacho (delivery) segue igual
    expect(moduloDoCaminho('/admin/financeiroX')).toBeNull()
  })
  it('WhatsApp comercial do Coolify; sem ele, o suporte', () => {
    expect(whatsappComercial({ WHATSAPP_COMERCIAL_MENUZIA: '+55 (27) 99999-0000' })).toBe('5527999990000')
    expect(whatsappComercial({})).toBe(SUPORTE_MENUZIA.whatsapp)
  })
  it('mensagem pronta do "Quero liberar"', () => {
    const l = linkQueroLiberar('5527992534407', 'financeiro', 'Ponto 400')
    expect(decodeURIComponent(l.split('text=')[1])).toBe('Olá! Quero liberar o módulo Financeiro na loja Ponto 400.')
  })
})
