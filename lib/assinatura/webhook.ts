/**
 * Processamento do webhook do Asaas (docs/ASSINATURA-ASAAS.md). Puro quanto ao banco e à API: recebe um
 * `Repositorio` e um `buscarCobranca` — o teste injeta falsos; a rota injeta o Supabase e o Asaas.
 *
 * Regras (CORRECOES-DE-BUGS): evento repetido descartado ANTES de qualquer efeito; o corpo nunca é a verdade
 * (a cobrança é reconsultada); renovação nunca encurta a validade; e-mail que falha não desfaz nada.
 */
import { timingSafeEqual } from 'node:crypto'
import { novaValidade, PLANOS, somarMeses, type Plano } from './planos'

export interface EventoAsaas {
  id: string
  evento: string
  cobranca: { id: string; assinaturaId: string | null; status: string; vencimento: string; faturaUrl: string | null }
}

/** Lê e valida o corpo do webhook. Campo desconhecido é ignorado; campo essencial faltando = null (200 sem efeito). */
export function lerEvento(corpo: unknown): EventoAsaas | null {
  if (!corpo || typeof corpo !== 'object') return null
  const c = corpo as Record<string, unknown>
  const id = typeof c.id === 'string' ? c.id.slice(0, 80) : ''
  const evento = typeof c.event === 'string' ? c.event.slice(0, 60) : ''
  const p = c.payment && typeof c.payment === 'object' ? (c.payment as Record<string, unknown>) : null
  if (!id || !evento || !p || typeof p.id !== 'string') return null
  return {
    id, evento,
    cobranca: {
      id: p.id.slice(0, 80),
      assinaturaId: typeof p.subscription === 'string' ? p.subscription.slice(0, 80) : null,
      status: typeof p.status === 'string' ? p.status : '',
      vencimento: typeof p.dueDate === 'string' ? p.dueDate.slice(0, 10) : '',
      faturaUrl: typeof p.invoiceUrl === 'string' ? p.invoiceUrl.slice(0, 500) : null,
    },
  }
}

/** Header `asaas-access-token` contra `ASAAS_WEBHOOK_TOKEN`, em tempo constante. Sem token configurado = recusa tudo. */
export function tokenConfere(recebido: string | null | undefined, esperado: string | undefined): boolean {
  if (!esperado || esperado.length < 32 || !recebido) return false
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type Efeito = 'pago' | 'atrasado' | 'cancelado' | 'ignorar'

export function efeitoDoEvento(evento: string): Efeito {
  if (evento === 'PAYMENT_CONFIRMED' || evento === 'PAYMENT_RECEIVED') return 'pago'
  if (evento === 'PAYMENT_OVERDUE') return 'atrasado'
  if (evento === 'PAYMENT_DELETED' || evento === 'PAYMENT_REFUNDED') return 'cancelado'
  return 'ignorar'
}

/** Status da cobrança (reconsultada) que vale como paga. RECEIVED_IN_CASH = baixa manual no painel do Asaas. */
export function cobrancaPaga(status: string): boolean {
  return status === 'CONFIRMED' || status === 'RECEIVED' || status === 'RECEIVED_IN_CASH'
}

export interface AssinaturaRegistro {
  id: string
  usuarioId: string
  restauranteId: string | null
  plano: Plano
  status: 'aguardando' | 'em_dia' | 'atrasada' | 'cancelada'
}

export interface UsuarioRegistro {
  id: string
  email: string
  nome: string
  usuario: string
  nomeLoja: string
  restauranteId: string | null
  acessoExpiraEm: string | null
}

export interface Repositorio {
  /** Insere o id do evento; 'repetido' quando já existia. */
  registrarEvento(e: { id: string; evento: string; cobrancaId: string; assinaturaId: string | null }): Promise<'novo' | 'repetido'>
  marcarEvento(id: string, resultado: string): Promise<void>
  /** Falha no meio do processamento: solta o id para o reenvio do Asaas reprocessar (03/11). Só apaga evento sem resultado. */
  desfazerEvento(id: string): Promise<void>
  buscarAssinatura(asaasAssinaturaId: string): Promise<AssinaturaRegistro | null>
  buscarUsuario(usuarioId: string): Promise<UsuarioRegistro | null>
  /** Cria a loja e amarra ao dono (papel dono, autorizado, validade). Devolve id e slug da loja. */
  criarLoja(usuarioId: string, nomeLoja: string, acessoExpiraEm: string): Promise<{ restauranteId: string; slug: string }>
  /** Renovação: só a validade (não mexe em `autorizado`, que é decisão do Super Admin). */
  estenderValidade(usuarioId: string, acessoExpiraEm: string): Promise<void>
  ligarModulos(restauranteId: string, modulos: Record<string, boolean>): Promise<void>
  atualizarAssinatura(id: string, campos: Partial<{ restauranteId: string; status: AssinaturaRegistro['status']; ultimaCobrancaId: string; ultimaFaturaUrl: string | null; proximoVencimento: string; pagoEm: string }>): Promise<void>
}

export interface CobrancaConsultada { id: string; status: string; vencimento: string; faturaUrl: string | null; assinaturaId: string | null }

export interface Dependencias {
  repo: Repositorio
  buscarCobranca(cobrancaId: string): Promise<CobrancaConsultada>
  /** Primeira ativação: dados para o e-mail "acesso liberado". Falha é só registrada. */
  avisarAcessoLiberado(d: { email: string; nome: string; usuario: string; nomeLoja: string; slug: string; plano: Plano }): Promise<void>
  agora?: () => Date
}

export type ResultadoEvento =
  | 'repetido' | 'ignorado' | 'sem_assinatura' | 'assinatura_desconhecida' | 'cobranca_nao_paga' | 'cobranca_de_outra_assinatura'
  | 'ativado' | 'renovado' | 'atrasada' | 'cancelada'

export async function processarEventoAsaas(ev: EventoAsaas, deps: Dependencias): Promise<ResultadoEvento> {
  const { repo } = deps
  if ((await repo.registrarEvento({ id: ev.id, evento: ev.evento, cobrancaId: ev.cobranca.id, assinaturaId: ev.cobranca.assinaturaId })) === 'repetido') return 'repetido'
  try {
    return await aplicarEvento(ev, deps)
  } catch (e) {
    // 03/11: o id foi gravado antes do efeito; sem isto o reenvio do Asaas (mesmo id) caía em "repetido" e o pagamento
    // se perdia (loja nunca criada, renovação não estendida). Solta o id e deixa o erro subir (a rota responde 500).
    await repo.desfazerEvento(ev.id).catch(() => undefined)
    throw e
  }
}

async function aplicarEvento(ev: EventoAsaas, deps: Dependencias): Promise<ResultadoEvento> {
  const { repo } = deps
  const terminar = async (r: ResultadoEvento): Promise<ResultadoEvento> => { await repo.marcarEvento(ev.id, r); return r }

  const efeito = efeitoDoEvento(ev.evento)
  if (efeito === 'ignorar') return terminar('ignorado')
  if (!ev.cobranca.assinaturaId) return terminar('sem_assinatura')
  const assinatura = await repo.buscarAssinatura(ev.cobranca.assinaturaId)
  if (!assinatura) return terminar('assinatura_desconhecida')

  if (efeito === 'cancelado') {
    await repo.atualizarAssinatura(assinatura.id, { status: 'cancelada', ultimaCobrancaId: ev.cobranca.id })
    return terminar('cancelada')
  }

  // Daqui em diante o que vale é a cobrança reconsultada na API, não o corpo do webhook.
  const cobranca = await deps.buscarCobranca(ev.cobranca.id)
  if (cobranca.assinaturaId !== ev.cobranca.assinaturaId) return terminar('cobranca_de_outra_assinatura')

  if (efeito === 'atrasado') {
    if (cobrancaPaga(cobranca.status)) return terminar('cobranca_nao_paga') // já pagou entre o aviso e a consulta: nada a marcar
    await repo.atualizarAssinatura(assinatura.id, { status: 'atrasada', ultimaCobrancaId: cobranca.id, ultimaFaturaUrl: cobranca.faturaUrl })
    return terminar('atrasada')
  }

  if (!cobrancaPaga(cobranca.status)) return terminar('cobranca_nao_paga')
  const usuario = await repo.buscarUsuario(assinatura.usuarioId)
  if (!usuario) return terminar('assinatura_desconhecida')
  const pagoEm = (deps.agora?.() ?? new Date()).toISOString()
  const proximoVencimento = somarMeses(cobranca.vencimento, 1)
  const validade = novaValidade(usuario.acessoExpiraEm, cobranca.vencimento)

  if (!usuario.restauranteId) {
    const { restauranteId, slug } = await repo.criarLoja(usuario.id, usuario.nomeLoja, validade)
    await repo.ligarModulos(restauranteId, PLANOS[assinatura.plano].modulos)
    await repo.atualizarAssinatura(assinatura.id, { restauranteId, status: 'em_dia', ultimaCobrancaId: cobranca.id, ultimaFaturaUrl: cobranca.faturaUrl, proximoVencimento, pagoEm })
    try {
      await deps.avisarAcessoLiberado({ email: usuario.email, nome: usuario.nome, usuario: usuario.usuario, nomeLoja: usuario.nomeLoja, slug, plano: assinatura.plano })
    } catch (e) {
      console.error('[assinatura] e-mail de acesso liberado falhou', (e as Error).message)
    }
    return terminar('ativado')
  }

  await repo.estenderValidade(usuario.id, validade)
  await repo.atualizarAssinatura(assinatura.id, { status: 'em_dia', ultimaCobrancaId: cobranca.id, ultimaFaturaUrl: cobranca.faturaUrl, proximoVencimento, pagoEm })
  return terminar('renovado')
}
