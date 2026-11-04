import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({ rpc: async () => ({ data: [] }) }) }))
vi.mock('@/components/admin/campanhas-metricas', () => ({ DetalheCampanha: () => null }))

import { Agendamentos } from './listas'
import type { Campanha } from '@/lib/queries/campanhas'

/** 03/11/2026: Agendamentos é a lista única (rascunhos incluídos, com ações); o submenu "Modelos de mensagem" some. */

const campanha = (extra: Partial<Campanha>): Campanha => ({
  id: 'c', restauranteId: 'L', nome: 'Promo', status: 'agendada', tipoMensagem: 'texto', mensagem: 'Oi', imagemUrl: null, audioUrl: null,
  filtro: { tipo: 'todos' }, agendadoEm: '2026-11-04T20:00:00Z', totalDestinatarios: 0, totalEnviados: 0, totalErros: 0, criadoEm: '2026-11-03T10:00:00Z',
  incluirLink: true, duplicadosBloqueados: 0, incluirDescadastro: true, botoes: [], pausadaEm: null, pausaMotivo: null, ...extra,
})
const acoes = { onVer: vi.fn(), onEditar: vi.fn(), onDuplicar: vi.fn(), onCancelar: vi.fn(), onExcluir: vi.fn() }

describe('Agendamentos (lista única)', () => {
  it('mostra rascunho e agendada com as ações e a coluna "Programada para"', () => {
    render(<Agendamentos campanhas={[campanha({ id: 'a', nome: 'Agendada' }), campanha({ id: 'r', nome: 'Rascunho', status: 'rascunho', agendadoEm: null })]} carregando={false} acoes={acoes} onNovo={vi.fn()} />)
    expect(screen.getAllByTestId('agendamento-linha')).toHaveLength(2)
    expect(screen.getByText('Programada para')).toBeInTheDocument()
    expect(screen.getAllByTestId('campanha-editar')).toHaveLength(2)
    expect(screen.getByTestId('contador-rascunhos').textContent).toContain('1')
  })
})

describe('página de campanhas', () => {
  const src = readFileSync('app/admin/campanhas/page.tsx', 'utf8')
  it('não tem mais o submenu Modelos; ?aba=modelos cai em Agendamentos, que mostra os modelos acima da lista', () => {
    expect(src).not.toMatch(/id: 'modelos'/)
    expect(src).toMatch(/modelos: 'agendamentos'/)
    expect(src).not.toMatch(/ListaCampanhas/)
    const agendamentos = src.indexOf("aba === 'agendamentos'")
    expect(agendamentos).toBeGreaterThan(0)
    expect(src.slice(agendamentos, agendamentos + 2500)).toMatch(/<Modelos[\s\S]*<Agendamentos/)
  })
})
