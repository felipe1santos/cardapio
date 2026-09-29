import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReceberModal } from './conta-presencial'

describe('ReceberModal — chave de idempotência do pagamento', () => {
  const conta = { tipo: 'mesa', mesaNome: 'Mesa 3', senha: null, clienteNome: '', totais: { restante: 100 }, pagamentos: [] } as never

  it('falha (resposta perdida) reenvia com a MESMA chave; depois do sucesso a chave muda', async () => {
    const respostas = [false, true, true]
    const onRegistrar = vi.fn(async () => respostas.shift() ?? true)
    render(<ReceberModal conta={conta} formas={['pix']} podeFechar={false} onCancelar={() => {}} onRegistrar={onRegistrar} />)
    const botao = screen.getByTestId('receber-registrar')
    fireEvent.click(botao)
    await waitFor(() => expect(onRegistrar).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((botao as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(botao)
    await waitFor(() => expect(onRegistrar).toHaveBeenCalledTimes(2))
    await waitFor(() => expect((botao as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(botao)
    await waitFor(() => expect(onRegistrar).toHaveBeenCalledTimes(3))
    const chaves = onRegistrar.mock.calls.map((c) => (c as unknown as [{ chave: string }])[0].chave)
    expect(chaves[1]).toBe(chaves[0])
    expect(chaves[2]).not.toBe(chaves[1])
  })
})
