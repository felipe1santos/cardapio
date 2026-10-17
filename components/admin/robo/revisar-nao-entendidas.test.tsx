import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModalRevisao, pareceInstrucao, type ItemRevisao } from './revisar-nao-entendidas'

const item = (id: string, acao: 'robo' | 'ia' | 'pedido' | 'ignorar'): ItemRevisao => ({
  id, texto: id, exemplo: `mensagem ${id}`, vezes: 1, ultima_em: '2026-10-16T22:00:00Z', contexto: null, palavras: ['bacon'], sugestao: { acao, fonte: 'regras' },
})
const rotulos = { saudacao: 'Saudação', cardapio: 'Cardápio', entrega: 'Entrega', status_pedido: 'Status', horario: 'Horário', pagamento_pix: 'Pix', endereco_retirada: 'Endereço', reclamacao: 'Reclamação', atendente: 'Atendente', parar: 'Parar' }

describe('modal "Revisar mensagens"', () => {
  it('abre com o botão SUGERIDO selecionado (bug de 16/10: etiqueta no "É pedido", selecionado "IA responde")', () => {
    render(<ModalRevisao itens={[item('a', 'pedido')]} rotulos={rotulos} assuntos={['horario']} agenteLigado mostrar={() => {}} onResolvido={() => {}} onFechar={() => {}} />)
    expect(screen.getByTestId('revisar-acao-pedido')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('revisar-acao-ia')).toHaveAttribute('aria-checked', 'false')
  })
  it('na próxima mensagem também vale a sugestão dela', async () => {
    render(<ModalRevisao itens={[item('a', 'pedido'), item('b', 'ignorar')]} rotulos={rotulos} assuntos={['horario']} agenteLigado mostrar={() => {}} onResolvido={() => {}} onFechar={() => {}} />)
    await userEvent.click(screen.getByTestId('revisar-proxima'))
    expect(screen.getByTestId('revisar-acao-ignorar')).toHaveAttribute('aria-checked', 'true')
  })
  it('IA responde: bloqueia o Confirmar quando a resposta parece instrução para a IA', async () => {
    render(<ModalRevisao itens={[item('a', 'ia')]} rotulos={rotulos} assuntos={['horario']} agenteLigado mostrar={() => {}} onResolvido={() => {}} onFechar={() => {}} />)
    await userEvent.type(screen.getByTestId('revisar-resposta'), 'Diga que o cliente precisa pedir pelo link')
    expect(screen.getByTestId('revisar-confirmar')).toBeDisabled()
    expect(screen.getByTestId('revisar-instrucao')).toBeInTheDocument()
    await userEvent.clear(screen.getByTestId('revisar-resposta'))
    await userEvent.type(screen.getByTestId('revisar-resposta'), 'Não, só refrigerante e água.')
    expect(screen.getByTestId('revisar-confirmar')).toBeEnabled()
  })
})

describe('pareceInstrucao', () => {
  it.each(['O cliente quer saber se tem suco', 'Você precisa responder que não', 'atender com educação'])('"%s" → instrução', (t) => expect(pareceInstrucao(t)).toBe(true))
  it.each(['Não, só refrigerante e água.', 'Sim! Temos suco de laranja.', 'Atendemos até 23h.'])('"%s" → resposta ao cliente', (t) => expect(pareceInstrucao(t)).toBe(false))
})
