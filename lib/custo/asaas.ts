/**
 * Asaas — assinatura mensal do lojista (docs/ASSINATURA-ASAAS.md). ÚNICO arquivo que fala com api.asaas.com.
 *
 * Toda chamada passa por `chamarApiPaga` (api 'asaas', teto LIMITE_ASAAS_DIA, 200/dia): são poucas por mês (criar
 * cliente, criar assinatura, consultar cobrança no webhook), e o teto é só contra laço. Chave `ASAAS_API_KEY` e URL
 * `ASAAS_API_URL` (vazia = produção; sandbox = https://api-sandbox.asaas.com/v3) só no Coolify, sem Build time.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarApiPaga } from './guarda'

const TIMEOUT_MS = 15_000

export class AsaasError extends Error {
  constructor(message: string, public readonly status: number | null) {
    super(message)
    this.name = 'AsaasError'
  }
}

function urlBase(): string {
  return (process.env.ASAAS_API_URL || 'https://api.asaas.com/v3').replace(/\/$/, '')
}

export function asaasConfigurado(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.ASAAS_API_KEY
}

/** Mensagem que o lojista entende; o detalhe técnico vai para o log. */
function mensagemErro(status: number, corpo: Record<string, unknown>): string {
  const erros = Array.isArray(corpo.errors) ? (corpo.errors as { code?: string; description?: string }[]) : []
  const desc = erros.map((e) => `${e.code ?? ''} ${e.description ?? ''}`).join('; ')
  if (/cpfCnpj|CPF|CNPJ/i.test(desc)) return 'CPF ou CNPJ inválido. Confira os números.'
  if (status === 401) return 'A cobrança não pôde ser gerada (chave da Menuzia). Fale com o suporte.'
  return 'Não foi possível gerar a cobrança agora. Tente de novo em instantes.'
}

async function requisicao<T>(admin: SupabaseClient, metodo: 'GET' | 'POST' | 'DELETE', caminho: string, chave: string, corpo?: unknown, opcoes: { aceitar404?: boolean } = {}): Promise<T> {
  const apiKey = process.env.ASAAS_API_KEY
  if (!apiKey) throw new AsaasError('ASAAS_API_KEY ausente', null)
  const r = await chamarApiPaga(admin, { api: 'asaas', chave }, async () => {
    const res = await fetch(`${urlBase()}${caminho}`, {
      method: metodo,
      headers: { access_token: apiKey, Accept: 'application/json', 'User-Agent': 'Menuzia', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const texto = await res.text()
    let j: Record<string, unknown> = {}
    try { j = texto ? (JSON.parse(texto) as Record<string, unknown>) : {} } catch { j = {} }
    if (!res.ok && !(opcoes.aceitar404 && res.status === 404)) {
      console.error(`[asaas] ${metodo} ${caminho.split('?')[0]} → ${res.status} ${texto.slice(0, 200)}`)
      throw new AsaasError(mensagemErro(res.status, j), res.status)
    }
    return j as T
  })
  if (r.ok) return r.valor
  if (r.motivo === 'erro' && r.erro) throw new AsaasError(r.erro, null)
  throw new AsaasError('A cobrança não pôde ser gerada agora (limite de segurança). Tente mais tarde.', null)
}

export interface NovoClienteAsaas { nome: string; email: string; celular: string; documento: string; referencia: string }

export async function criarClienteAsaas(admin: SupabaseClient, c: NovoClienteAsaas): Promise<string> {
  const r = await requisicao<{ id: string }>(admin, 'POST', '/customers', `cliente:${c.referencia}`, {
    name: c.nome, email: c.email, mobilePhone: c.celular.replace(/\D/g, ''), cpfCnpj: c.documento.replace(/\D/g, ''), externalReference: c.referencia,
  })
  return r.id
}

export interface NovaAssinaturaAsaas { clienteId: string; valor: number; vencimento: string; descricao: string; referencia: string }

export async function criarAssinaturaAsaas(admin: SupabaseClient, a: NovaAssinaturaAsaas): Promise<string> {
  const r = await requisicao<{ id: string }>(admin, 'POST', '/subscriptions', `assinatura:${a.referencia}`, {
    customer: a.clienteId, billingType: 'UNDEFINED', value: a.valor, nextDueDate: a.vencimento, cycle: 'MONTHLY', description: a.descricao, externalReference: a.referencia,
  })
  return r.id
}

export interface CobrancaAsaas { id: string; status: string; valor: number; vencimento: string; faturaUrl: string | null; assinaturaId: string | null }

function lerCobranca(p: Record<string, unknown>): CobrancaAsaas {
  return {
    id: String(p.id ?? ''), status: String(p.status ?? ''), valor: Number(p.value ?? 0), vencimento: String(p.dueDate ?? '').slice(0, 10),
    faturaUrl: typeof p.invoiceUrl === 'string' ? p.invoiceUrl : null, assinaturaId: typeof p.subscription === 'string' ? p.subscription : null,
  }
}

/** A primeira cobrança nasce junto com a assinatura; é a fatura para onde o lojista vai pagar. */
export async function primeiraCobrancaDaAssinatura(admin: SupabaseClient, assinaturaId: string): Promise<CobrancaAsaas | null> {
  const r = await requisicao<{ data?: Record<string, unknown>[] }>(admin, 'GET', `/subscriptions/${encodeURIComponent(assinaturaId)}/payments?limit=1`, `cobrancas:${assinaturaId}`)
  const p = r.data?.[0]
  return p ? lerCobranca(p) : null
}

/**
 * Cancela a assinatura no Asaas (03/11): cadastro que falhou depois de criar a assinatura, ou lojista excluído pelo
 * Super Admin — sem isto o Asaas seguia cobrando todo mês um CPF sem conta. Nunca lança: true = cancelada ou já não
 * existia (404); false = não conseguiu (fica registrado no log para cancelar à mão no painel do Asaas).
 */
export async function cancelarAssinaturaAsaas(admin: SupabaseClient, assinaturaId: string): Promise<boolean> {
  try {
    // 404 = já não existe no Asaas: nada a cancelar (a guarda engole o status, por isso o 404 é aceito dentro da chamada).
    await requisicao<{ deleted?: boolean }>(admin, 'DELETE', `/subscriptions/${encodeURIComponent(assinaturaId)}`, `cancelar:${assinaturaId}`, undefined, { aceitar404: true })
    return true
  } catch (e) {
    console.error('[asaas] cancelar assinatura falhou', assinaturaId, (e as Error).message)
    return false
  }
}

/** Assinatura no Asaas (ACTIVE | INACTIVE | EXPIRED): usada quando uma cobrança é apagada, para saber se é cancelamento. */
export async function buscarAssinaturaAsaas(admin: SupabaseClient, assinaturaId: string): Promise<{ id: string; status: string }> {
  const p = await requisicao<Record<string, unknown>>(admin, 'GET', `/subscriptions/${encodeURIComponent(assinaturaId)}`, `assinatura-status:${assinaturaId}`)
  return { id: String(p.id ?? ''), status: String(p.status ?? '') }
}

/** Últimas cobranças da assinatura (conferência no login de loja expirada, lib/assinatura/reconciliar.ts). */
export async function listarCobrancasAsaas(admin: SupabaseClient, assinaturaId: string, limite = 5): Promise<CobrancaAsaas[]> {
  const r = await requisicao<{ data?: Record<string, unknown>[] }>(admin, 'GET', `/subscriptions/${encodeURIComponent(assinaturaId)}/payments?limit=${limite}`, `cobrancas:${assinaturaId}`)
  return (r.data ?? []).map(lerCobranca)
}

/** Reconsulta da cobrança (o webhook nunca é tomado como verdade). */
export async function buscarCobrancaAsaas(admin: SupabaseClient, cobrancaId: string): Promise<CobrancaAsaas> {
  const p = await requisicao<Record<string, unknown>>(admin, 'GET', `/payments/${encodeURIComponent(cobrancaId)}`, `cobranca:${cobrancaId}`)
  return lerCobranca(p)
}
