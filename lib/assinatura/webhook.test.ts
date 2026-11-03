import { describe, expect, it, vi } from 'vitest'
import { cobrancaPaga, efeitoDoEvento, lerEvento, processarEventoAsaas, tokenConfere, type AssinaturaRegistro, type Repositorio, type UsuarioRegistro } from './webhook'

const TOKEN = 'a'.repeat(40)

describe('lerEvento', () => {
  it('lê o corpo do Asaas e ignora campos desconhecidos', () => {
    const ev = lerEvento({ id: 'evt_1', event: 'PAYMENT_RECEIVED', dateCreated: 'x', novo: 1, payment: { id: 'pay_1', subscription: 'sub_1', status: 'RECEIVED', dueDate: '2026-11-02', invoiceUrl: 'https://f', outra: true } })
    expect(ev).toEqual({ id: 'evt_1', evento: 'PAYMENT_RECEIVED', cobranca: { id: 'pay_1', assinaturaId: 'sub_1', status: 'RECEIVED', vencimento: '2026-11-02', faturaUrl: 'https://f' } })
  })
  it('sem id, evento ou cobrança = null', () => {
    expect(lerEvento(null)).toBeNull()
    expect(lerEvento({ event: 'PAYMENT_RECEIVED', payment: { id: 'p' } })).toBeNull()
    expect(lerEvento({ id: 'e', event: 'PAYMENT_RECEIVED' })).toBeNull()
  })
})

describe('tokenConfere', () => {
  it('só com token configurado (32+) e igual', () => {
    expect(tokenConfere(TOKEN, TOKEN)).toBe(true)
    expect(tokenConfere(TOKEN, `${TOKEN}b`)).toBe(false)
    expect(tokenConfere(null, TOKEN)).toBe(false)
    expect(tokenConfere('curto', 'curto')).toBe(false)
    expect(tokenConfere(TOKEN, undefined)).toBe(false)
  })
})

describe('efeitoDoEvento / cobrancaPaga', () => {
  it('mapeia os eventos', () => {
    expect(efeitoDoEvento('PAYMENT_CONFIRMED')).toBe('pago')
    expect(efeitoDoEvento('PAYMENT_RECEIVED')).toBe('pago')
    expect(efeitoDoEvento('PAYMENT_OVERDUE')).toBe('atrasado')
    expect(efeitoDoEvento('PAYMENT_DELETED')).toBe('cobranca_apagada')
    expect(efeitoDoEvento('PAYMENT_REFUNDED')).toBe('estornado')
    expect(efeitoDoEvento('PAYMENT_CREATED')).toBe('ignorar')
    expect(cobrancaPaga('RECEIVED_IN_CASH')).toBe(true)
    expect(cobrancaPaga('PENDING')).toBe(false)
  })
})

function cenario(opcoes: { restauranteId?: string | null; acessoExpiraEm?: string | null; statusCobranca?: string; assinaturaDaCobranca?: string | null; statusAssinatura?: string } = {}) {
  const eventos = new Set<string>()
  const assinatura: AssinaturaRegistro = { id: 'ass_1', usuarioId: 'u1', restauranteId: opcoes.restauranteId ?? null, plano: 'completo', status: 'aguardando' }
  const usuario: UsuarioRegistro = { id: 'u1', email: 'dono@x.com', nome: 'Dono', usuario: 'dono', nomeLoja: 'Burger do Dono', restauranteId: opcoes.restauranteId ?? null, acessoExpiraEm: opcoes.acessoExpiraEm ?? null }
  const repo: Repositorio = {
    registrarEvento: vi.fn(async (e) => { if (eventos.has(e.id)) return 'repetido'; eventos.add(e.id); return 'novo' }),
    marcarEvento: vi.fn(async () => {}),
    desfazerEvento: vi.fn(async (id) => { eventos.delete(id) }),
    buscarAssinatura: vi.fn(async (id) => (id === 'sub_1' ? assinatura : null)),
    buscarUsuario: vi.fn(async () => usuario),
    criarLoja: vi.fn(async () => ({ restauranteId: 'r1', slug: 'burger-do-dono' })),
    renovarAcesso: vi.fn(async () => {}),
    encerrarAcesso: vi.fn(async () => {}),
    ligarModulos: vi.fn(async () => {}),
    atualizarAssinatura: vi.fn(async () => {}),
  }
  const deps = {
    repo,
    buscarCobranca: vi.fn(async (id: string) => ({ id, status: opcoes.statusCobranca ?? 'RECEIVED', vencimento: '2026-11-02', faturaUrl: 'https://fatura', assinaturaId: opcoes.assinaturaDaCobranca === undefined ? 'sub_1' : opcoes.assinaturaDaCobranca })),
    buscarAssinaturaAsaas: vi.fn(async (id: string) => ({ id, status: opcoes.statusAssinatura ?? 'ACTIVE' })),
    avisarAcessoLiberado: vi.fn(async () => {}),
    agora: () => new Date('2026-11-02T20:00:00Z'),
  }
  return { repo, deps }
}

const pago = { id: 'evt_1', evento: 'PAYMENT_RECEIVED', cobranca: { id: 'pay_1', assinaturaId: 'sub_1', status: 'RECEIVED', vencimento: '2026-11-02', faturaUrl: 'https://fatura' } }

describe('processarEventoAsaas', () => {
  it('primeiro pagamento: cria a loja, liga as chaves do plano, marca em dia e avisa por e-mail', async () => {
    const { repo, deps } = cenario()
    expect(await processarEventoAsaas(pago, deps)).toBe('ativado')
    expect(repo.criarLoja).toHaveBeenCalledWith('u1', 'Burger do Dono', '2026-12-08T02:59:59.000Z')
    expect(repo.ligarModulos).toHaveBeenCalledWith('r1', { financeiro: true, agente_ia: true, disparos: true })
    expect(repo.atualizarAssinatura).toHaveBeenCalledWith('ass_1', expect.objectContaining({ restauranteId: 'r1', status: 'em_dia', ultimaCobrancaId: 'pay_1', proximoVencimento: '2026-12-02', pagoEm: '2026-11-02T20:00:00.000Z' }))
    expect(deps.avisarAcessoLiberado).toHaveBeenCalledWith(expect.objectContaining({ email: 'dono@x.com', slug: 'burger-do-dono', plano: 'completo' }))
    expect(repo.marcarEvento).toHaveBeenCalledWith('evt_1', 'ativado')
  })

  it('evento repetido: nada acontece', async () => {
    const { repo, deps } = cenario()
    await processarEventoAsaas(pago, deps)
    expect(await processarEventoAsaas(pago, deps)).toBe('repetido')
    expect(repo.criarLoja).toHaveBeenCalledTimes(1)
  })

  it('renovação: só estende a validade (nunca encurta) e não cria loja nem manda e-mail', async () => {
    const { repo, deps } = cenario({ restauranteId: 'r1', acessoExpiraEm: '2027-03-01T02:59:59.000Z' })
    expect(await processarEventoAsaas({ ...pago, id: 'evt_2' }, deps)).toBe('renovado')
    expect(repo.renovarAcesso).toHaveBeenCalledWith('u1', '2027-03-01T02:59:59.000Z')
    expect(repo.criarLoja).not.toHaveBeenCalled()
    expect(deps.avisarAcessoLiberado).not.toHaveBeenCalled()
  })

  it('o corpo diz pago, mas a API diz pendente: nada muda', async () => {
    const { repo, deps } = cenario({ statusCobranca: 'PENDING' })
    expect(await processarEventoAsaas(pago, deps)).toBe('cobranca_nao_paga')
    expect(repo.criarLoja).not.toHaveBeenCalled()
  })

  it('cobrança de outra assinatura na API: recusa', async () => {
    const { repo, deps } = cenario({ assinaturaDaCobranca: 'sub_outra' })
    expect(await processarEventoAsaas(pago, deps)).toBe('cobranca_de_outra_assinatura')
    expect(repo.criarLoja).not.toHaveBeenCalled()
  })

  it('e-mail que falha não desfaz a ativação', async () => {
    const { repo, deps } = cenario()
    deps.avisarAcessoLiberado = vi.fn(async () => { throw new Error('resend fora') })
    expect(await processarEventoAsaas(pago, deps)).toBe('ativado')
    expect(repo.marcarEvento).toHaveBeenCalledWith('evt_1', 'ativado')
  })

  it('atrasada: marca status e guarda a fatura; estorno: cancela sem reconsultar a cobrança', async () => {
    const { repo, deps } = cenario({ restauranteId: 'r1', statusCobranca: 'OVERDUE' })
    expect(await processarEventoAsaas({ ...pago, id: 'evt_3', evento: 'PAYMENT_OVERDUE' }, deps)).toBe('atrasada')
    expect(repo.atualizarAssinatura).toHaveBeenCalledWith('ass_1', expect.objectContaining({ status: 'atrasada', ultimaFaturaUrl: 'https://fatura' }))
    expect(await processarEventoAsaas({ ...pago, id: 'evt_4', evento: 'PAYMENT_REFUNDED' }, deps)).toBe('cancelada')
    expect(deps.buscarCobranca).toHaveBeenCalledTimes(1)
  })

  it('assinatura que não é nossa ou evento sem assinatura: 200 sem efeito', async () => {
    const { deps } = cenario()
    expect(await processarEventoAsaas({ ...pago, cobranca: { ...pago.cobranca, assinaturaId: 'sub_x' } }, deps)).toBe('assinatura_desconhecida')
    expect(await processarEventoAsaas({ ...pago, id: 'evt_5', cobranca: { ...pago.cobranca, assinaturaId: null } }, deps)).toBe('sem_assinatura')
    expect(await processarEventoAsaas({ ...pago, id: 'evt_6', evento: 'PAYMENT_CREATED' }, deps)).toBe('ignorado')
  })
})

/**
 * 03/11/2026 (auditoria da assinatura, achado crítico): o id do evento era gravado antes do efeito e nunca desfeito; se a
 * reconsulta no Asaas ou um UPDATE falhasse, a rota respondia 500 e o reenvio do Asaas (mesmo id) caía em "repetido" —
 * o pagamento se perdia para sempre (loja nunca criada, renovação não estendida). Agora: falha no meio → o evento é
 * desfeito e o reenvio reprocessa.
 */
describe('falha no meio do processamento: o reenvio do Asaas reprocessa', () => {
  it('reconsulta do Asaas falha → erro sobe, evento desfeito; a 2ª entrega do mesmo evento ativa a loja', async () => {
    const { repo, deps } = cenario()
    deps.buscarCobranca.mockRejectedValueOnce(new Error('Asaas fora'))
    await expect(processarEventoAsaas(pago, deps)).rejects.toThrow('Asaas fora')
    expect(repo.desfazerEvento).toHaveBeenCalledWith('evt_1')
    expect(repo.criarLoja).not.toHaveBeenCalled()
    expect(await processarEventoAsaas(pago, deps)).toBe('ativado')
    expect(repo.criarLoja).toHaveBeenCalledTimes(1)
  })
  it('evento concluído e reenviado continua "repetido" (nada é feito duas vezes)', async () => {
    const { repo, deps } = cenario()
    expect(await processarEventoAsaas(pago, deps)).toBe('ativado')
    expect(await processarEventoAsaas(pago, deps)).toBe('repetido')
    expect(repo.desfazerEvento).not.toHaveBeenCalled()
    expect(repo.criarLoja).toHaveBeenCalledTimes(1)
  })
})

/**
 * Regras do dono (03/11/2026):
 *  · estorno encerra o acesso NA HORA;
 *  · loja "sem validade" (acesso_expira_em null) é vitalícia: pagamento não cria validade;
 *  · loja com validade que venceu e pagou volta sozinha (autorizado + nova validade);
 *  · cobrança avulsa apagada no Asaas (PAYMENT_DELETED) não é cancelamento: reconsulta a assinatura; só cancela se ela
 *    estiver inativa, e mesmo assim o acesso fica até a validade (ele paga depois e volta).
 */
describe('regras de acesso da assinatura (03/11)', () => {
  const evento = (tipo: string) => ({ ...pago, evento: tipo })
  it('estorno: assinatura cancelada e acesso encerrado na hora', async () => {
    const { repo, deps } = cenario({ restauranteId: 'r1', acessoExpiraEm: '2026-12-08T02:59:59.000Z' })
    expect(await processarEventoAsaas(evento('PAYMENT_REFUNDED'), deps)).toBe('cancelada')
    expect(repo.encerrarAcesso).toHaveBeenCalledWith('u1', '2026-11-02T20:00:00.000Z')
    expect(repo.atualizarAssinatura).toHaveBeenCalledWith('ass_1', expect.objectContaining({ status: 'cancelada' }))
  })
  it('cobrança apagada com a assinatura ainda ativa no Asaas → ignorado, acesso intacto', async () => {
    const { repo, deps } = cenario({ restauranteId: 'r1', statusAssinatura: 'ACTIVE' })
    expect(await processarEventoAsaas(evento('PAYMENT_DELETED'), deps)).toBe('ignorado')
    expect(repo.encerrarAcesso).not.toHaveBeenCalled()
    expect(repo.atualizarAssinatura).not.toHaveBeenCalled()
  })
  it('cobrança apagada com a assinatura inativa no Asaas → cancelada, mas o acesso fica até a validade', async () => {
    const { repo, deps } = cenario({ restauranteId: 'r1', statusAssinatura: 'INACTIVE' })
    expect(await processarEventoAsaas(evento('PAYMENT_DELETED'), deps)).toBe('cancelada')
    expect(repo.encerrarAcesso).not.toHaveBeenCalled()
  })
  it('renovação de loja com validade: reautoriza e grava a nova validade (pagou → volta sozinha)', async () => {
    const { repo, deps } = cenario({ restauranteId: 'r1', acessoExpiraEm: '2026-11-01T02:59:59.000Z' })
    expect(await processarEventoAsaas(pago, deps)).toBe('renovado')
    expect(repo.renovarAcesso).toHaveBeenCalledWith('u1', '2026-12-08T02:59:59.000Z')
  })
  it('renovação de loja vitalícia (sem validade): continua sem validade', async () => {
    const { repo, deps } = cenario({ restauranteId: 'r1', acessoExpiraEm: null })
    expect(await processarEventoAsaas(pago, deps)).toBe('renovado')
    expect(repo.renovarAcesso).toHaveBeenCalledWith('u1', null)
  })
})
