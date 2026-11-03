import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VisaoGeral } from './visao-geral'

/** 03/11/2026: visão geral enxuta — 5 números em cima, 4 taxas embaixo, UM gráfico; sem tabela e sem "Receita por campanha". */

const dados = {
  totais: { receita: 1234.5, pedidos: 12, contatos: 80, recorrentes: 7, recuperados: 5, tentados: 100, enviadas: 96, leitura_rastreada: true, lidas: 50, enviadas_rastreadas: 96, com_link: 96, clicaram: 20, minutos_para_pedir: 95 },
  serie: [{ dia: '2026-11-01', enviadas: 40, pedidos: 5, receita: 500 }, { dia: '2026-11-02', enviadas: 56, pedidos: 7, receita: 734.5 }],
  envios: [{ id: 'c1', nome: 'Promo', status: 'concluida', quando: '2026-11-01T20:00:00Z', contatos: 40, enviadas: 40, lidas: 20, com_retorno: 20, pedidos: 5, convertidos: 5, receita: 500 }],
}

describe('VisaoGeral', () => {
  it('mostra os 9 números e um gráfico só; nada de tabela nem receita por campanha', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => dados })) as unknown as typeof fetch
    render(<VisaoGeral onDisparar={vi.fn()} detalhado={<div />} />)
    expect(await screen.findByTestId('grafico-dias')).toBeInTheDocument()
    for (const id of ['m-receita', 'm-pedidos', 'm-contatos', 'm-recorrentes', 'm-recuperados', 'm-sucesso', 'm-leitura', 'm-cliques', 'm-tempo']) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
    expect(screen.getByTestId('m-sucesso').textContent).toContain('96%')
    expect(screen.queryByTestId('tabela-envios')).toBeNull()
    expect(screen.queryByTestId('grafico-campanhas')).toBeNull()
    expect(screen.queryByTestId('linha-envio')).toBeNull()
  })
  it('sem envios no período: faixa curta com o botão de disparar, gráfico some', async () => {
    const onDisparar = vi.fn()
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...dados, serie: [], envios: [] }) })) as unknown as typeof fetch
    render(<VisaoGeral onDisparar={onDisparar} detalhado={<div />} />)
    expect(await screen.findByTestId('vazio-envios')).toBeInTheDocument()
    expect(screen.queryByTestId('grafico-dias')).toBeNull()
  })
})
