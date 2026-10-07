import { describe, expect, it } from 'vitest'
import { MODO_DA_OPCAO, opcaoDaLoja, prontidaoBeta, situacaoAntigo, situacaoBeta, versaoInstalada, type DadosBeta } from './opcao'
import type { AgenteVisao, DispositivoVisao } from './servico'

const agente = (x: Partial<AgenteVisao> = {}): AgenteVisao => ({ id: 'a1', nome: 'PC Cozinha', versao: '0.2.0-beta.9', vistoEm: '2026-10-05T12:00:00Z', online: true, revogado: false, criadoEm: '2026-09-01T00:00:00Z', criadoPorNome: null, ...x })
const disp = (id: string, x: Partial<DispositivoVisao> = {}): DispositivoVisao => ({
  id, agenteId: 'a1', nomeSistema: id === 'd1' ? 'POS-80' : 'POS-58', apelido: null, larguraMm: 80, tamanhoFonte: 'grande', larguraPontos: null, deslocamentoPontos: 0,
  diagnostico: null, calibradoEm: null, calibradoPorNome: null, disponivel: true, vistoEm: null, ultimoUsoEm: '2026-10-05T11:00:00Z', ultimoErro: null, ultimoErroEm: null, funcoes: [], envioCaminho: null, envioCaminhoEm: null, envioCaminhoObs: null,
  intensidade: 'normal', envio: 'driver', modoImpressao: 'imagem', redeIp: null, redePorta: 9100, ...x,
})
const pronto = (x: Partial<DadosBeta> = {}): DadosBeta => ({ agentes: [agente()], dispositivos: [disp('d1'), disp('d2')], funcoes: { cozinha: 'd1', caixa: 'd2' }, trabalhos: [], modo: 'cozinha_caixa', betaLiberado: true, ...x })

describe('duas opções de impressão', () => {
  it('a opção é LIDA do modo de hoje: o deploy não muda nenhuma loja', () => {
    expect(opcaoDaLoja('teste')).toBe('antigo')
    expect(opcaoDaLoja('caixa')).toBe('beta')
    expect(opcaoDaLoja('cozinha_caixa')).toBe('beta')
    expect(MODO_DA_OPCAO).toEqual({ antigo: 'teste', beta: 'cozinha_caixa' })
  })

  it('Beta pronto: tudo verde, sem aviso', () => {
    const s = situacaoBeta(pronto())
    expect(s.sinal).toBe('ok')
    expect(s.aviso).toBeNull()
    expect(s.linhas.find((l) => l.testid === 'sit-versao')?.valor).toBe('0.2.0-beta.9')
  })

  it('um aviso só, na ordem do que trava primeiro', () => {
    expect(situacaoBeta(pronto({ betaLiberado: false })).aviso?.acao).toBe('liberar')
    expect(situacaoBeta(pronto({ agentes: [] })).aviso?.acao).toBe('instalar_beta')
    expect(situacaoBeta(pronto({ agentes: [agente({ online: false })] })).aviso?.acao).toBe('abrir_beta')
    expect(situacaoBeta(pronto({ funcoes: { cozinha: null, caixa: 'd2' } })).aviso?.acao).toBe('escolher_impressoras')
    const velho = situacaoBeta(pronto({ agentes: [agente({ versao: '0.2.0-beta.7' })] }))
    expect(velho.aviso?.acao).toBe('atualizar_beta')
    expect(velho.aviso?.rotuloAcao).toBe('Atualizar para o beta.9')
    expect(velho.sinal).toBe('atencao')
    expect(situacaoBeta(pronto({ modo: 'caixa' })).aviso?.acao).toBe('passar_comanda')
    const erro = situacaoBeta(pronto({ dispositivos: [disp('d1', { ultimoErroEm: '2026-10-05T11:30:00Z', ultimoErro: 'sem papel' }), disp('d2')] }))
    expect(erro.aviso?.titulo).toMatch(/erro/)
    expect(erro.sinal).toBe('erro')
  })

  it('versão instalada = a mais nova dos computadores ativos', () => {
    expect(versaoInstalada([agente({ id: 'a', versao: '0.2.0-beta.6' }), agente({ id: 'b', versao: '0.2.0-beta.9' }), agente({ id: 'c', versao: '0.2.0-beta.10', revogado: true })])).toBe('0.2.0-beta.9')
    expect(versaoInstalada([])).toBeNull()
  })

  it('passo a passo de ativação do Beta', () => {
    expect(prontidaoBeta(pronto()).pronto).toBe(true)
    const nada = prontidaoBeta(pronto({ agentes: [], funcoes: { cozinha: null, caixa: null } }))
    expect(nada.pronto).toBe(false)
    expect(nada.passos.map((p) => p.feito)).toEqual([false, false, false])
    expect(prontidaoBeta(pronto({ agentes: [agente({ online: false })] })).passos.map((p) => p.feito)).toEqual([true, false, false])
    expect(prontidaoBeta(pronto({ betaLiberado: false })).pronto).toBe(false)
  })

  it('Assistente antigo', () => {
    expect(situacaoAntigo({ ativado: true, vistoEm: '2026-10-05T12:00:00Z', online: true, impressora: 'EPSON' }).sinal).toBe('ok')
    expect(situacaoAntigo({ ativado: false, vistoEm: null, online: false, impressora: null }).aviso?.acao).toBe('ativar_antigo')
    expect(situacaoAntigo({ ativado: true, vistoEm: null, online: false, impressora: null }).aviso?.acao).toBe('instalar_antigo')
    expect(situacaoAntigo({ ativado: true, vistoEm: '2026-10-05T10:00:00Z', online: false, impressora: 'EPSON' }).aviso?.acao).toBe('abrir_antigo')
  })
})
