import { describe, expect, it, vi } from 'vitest'
import { reconciliarAssinatura } from './reconciliar'

/**
 * 03/11/2026 (regra do dono): loja com validade vencida que pagou tem que voltar sozinha, mesmo que o webhook do Asaas
 * tenha se perdido. No login de quem está expirado, o sistema confere no Asaas (1 chamada, pela guarda) se há cobrança
 * paga mais nova e aplica a mesma renovação do webhook. Nunca em tela, intervalo ou cron.
 */
function cenario(cobrancas: { id: string; status: string; vencimento: string; faturaUrl: string | null; assinaturaId: string | null }[], acessoExpiraEm: string | null = '2026-10-01T02:59:59.000Z') {
  const repo = {
    buscarAssinaturaDoUsuario: vi.fn(async () => ({ id: 'ass_1', asaasAssinaturaId: 'sub_1', ultimaCobrancaId: 'pay_old' }) as { id: string; asaasAssinaturaId: string; ultimaCobrancaId: string | null } | null),
    buscarUsuario: vi.fn(async () => ({ id: 'u1', restauranteId: 'r1', acessoExpiraEm })),
    renovarAcesso: vi.fn(async () => {}),
    atualizarAssinatura: vi.fn(async () => {}),
  }
  const deps = { repo, listarCobrancas: vi.fn(async () => cobrancas), agora: () => new Date('2026-11-03T04:00:00Z') }
  return { repo, deps }
}

describe('reconciliarAssinatura (login de loja expirada)', () => {
  it('cobrança paga mais nova no Asaas → renova (validade pelo vencimento dela) e marca em dia', async () => {
    const { repo, deps } = cenario([{ id: 'pay_new', status: 'RECEIVED', vencimento: '2026-11-02', faturaUrl: 'https://f', assinaturaId: 'sub_1' }])
    expect(await reconciliarAssinatura('u1', deps)).toBe('renovado')
    expect(repo.renovarAcesso).toHaveBeenCalledWith('u1', '2026-12-08T02:59:59.000Z')
    expect(repo.atualizarAssinatura).toHaveBeenCalledWith('ass_1', expect.objectContaining({ status: 'em_dia', ultimaCobrancaId: 'pay_new', proximoVencimento: '2026-12-02' }))
  })
  it('só cobranças já conhecidas ou não pagas → nada muda', async () => {
    const { repo, deps } = cenario([{ id: 'pay_old', status: 'RECEIVED', vencimento: '2026-09-01', faturaUrl: null, assinaturaId: 'sub_1' }, { id: 'pay_x', status: 'PENDING', vencimento: '2026-11-02', faturaUrl: null, assinaturaId: 'sub_1' }])
    expect(await reconciliarAssinatura('u1', deps)).toBe('nada')
    expect(repo.renovarAcesso).not.toHaveBeenCalled()
  })
  it('sem assinatura Asaas (loja antiga) → nada, sem chamar o Asaas', async () => {
    const { repo, deps } = cenario([])
    repo.buscarAssinaturaDoUsuario.mockResolvedValueOnce(null)
    expect(await reconciliarAssinatura('u1', deps)).toBe('sem_assinatura')
    expect(deps.listarCobrancas).not.toHaveBeenCalled()
  })
  it('cobrança paga mas com validade já passada (muito antiga) → nada', async () => {
    const { repo, deps } = cenario([{ id: 'pay_new', status: 'RECEIVED', vencimento: '2026-08-01', faturaUrl: null, assinaturaId: 'sub_1' }])
    expect(await reconciliarAssinatura('u1', deps)).toBe('nada')
    expect(repo.renovarAcesso).not.toHaveBeenCalled()
  })
})
