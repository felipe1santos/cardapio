import { describe, expect, it } from 'vitest'
import { classificar } from './classificador'
import { decidir, ESTADO_VAZIO } from './decisao'
import { responder, type DadosLojaAuto } from './respostas'
import { rotaDaMensagem } from '@/lib/agente-ia/gatilho'
import { falhaDoPedido } from '@/lib/agente-ia/falhas'
import { FalhaPedido } from '@/lib/agente-ia/pedido'

/**
 * 19/10/2026 (dono): loja fechada (na mão ou fora do horário) NÃO recebe pedido pela IA. Quem quer pedir ouve do robô
 * que está fechada e quando abre; nada de "ficou anotado". Dúvidas (horário, item) continuam sendo respondidas.
 */
const agora = new Date('2026-10-19T21:50:00Z')
const FECHADA: DadosLojaAuto = {
  nome: 'Loja', link: 'https://app/loja/x', aberta: false, fechadaHojeForaDoNormal: true, proximaAbertura: 'A loja abre amanhã às 18:00',
  gradeHorario: '- Seg: 18:00–23:00', endereco: 'Rua A, 1', aceitaEntrega: true, aceitaRetirada: true, taxaPadrao: 3, foraDaLista: 'bloquear',
  temRaio: false, tempoEntrega: null, pixChave: '27999990000', pixTipo: 'telefone', pixOnline: false, bairros: [],
}
const d = (t: string, lojaAberta: boolean) => decidir({ classificacao: classificar(t), texto: t, estado: ESTADO_VAZIO, agora, temPix: true, lojaAberta })

describe('loja fechada: quem quer pedir não vai para a IA', () => {
  it('rota: pedido com item citado, "por aqui mesmo" e até em modo IA → robô; aberta → IA', () => {
    const base = { intencao: 'pedir' as const, tipo: 'texto' as const, emModoIa: false, itemCitado: true }
    expect(rotaDaMensagem({ ...base, lojaAberta: false })).toBe('robo')
    expect(rotaDaMensagem({ ...base, itemCitado: false, pedidoSemLink: true, lojaAberta: false })).toBe('robo')
    expect(rotaDaMensagem({ ...base, emModoIa: true, lojaAberta: false })).toBe('robo')
    expect(rotaDaMensagem({ ...base, lojaAberta: true })).toBe('ia')
    expect(rotaDaMensagem({ ...base })).toBe('ia')
  })
  it('rota: dúvida sobre item continua com a IA mesmo fechada; horário continua com o robô', () => {
    expect(rotaDaMensagem({ intencao: 'cardapio', tipo: 'texto', emModoIa: false, itemCitado: false, perguntaDeItem: true, lojaAberta: false })).toBe('ia')
    expect(rotaDaMensagem({ intencao: 'horario', tipo: 'texto', emModoIa: false, itemCitado: false, lojaAberta: false })).toBe('robo')
  })
  it('robô: "quero fazer um pedido" com a loja fechada → fechada + quando abre, sem link e sem anotar', () => {
    const dec = d('quero fazer um pedido', false)
    expect(dec.acao).toBe('pedir_fechada')
    const r = responder(dec, FECHADA, { agora })
    expect(r.mensagens).toHaveLength(1)
    expect(r.mensagens[0]).toContain('Estamos fechados hoje (fora do horário normal). A loja abre amanhã às 18:00.')
    expect(r.mensagens[0]).toContain('não consigo anotar seu pedido agora')
    expect(r.mensagens[0]).not.toContain('loja/x')
    expect(r.autoEstado ?? null).toBeNull()
    expect(d('quero fazer um pedido', true).acao).toBe('pedir_link')
  })
  it('IA com pedido em andamento quando a loja fechou: avisa, não anota e limpa o rascunho', () => {
    const f = falhaDoPedido(new FalhaPedido('fechada', 'x'), { aceitaEntrega: true, aceitaRetirada: true, proximaAbertura: 'A loja abre amanhã às 18:00' })
    expect(f.texto).toBe('A loja está fechada agora 😕 A loja abre amanhã às 18:00.\n\nPor isso não consigo anotar seu pedido agora. Assim que abrirmos, é só me chamar por aqui que eu anoto na hora!')
    expect(f.texto).not.toContain('ficou anotado')
    expect(f.limparRascunho).toBe(true)
    expect(f.atendente).toBe(false)
  })
})
