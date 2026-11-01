/**
 * Histórico de alertas do Super Admin (01/11/2026): uma linha por assunto (quantas vezes saiu, a primeira e a última,
 * se já resolveu), em vez de uma linha por envio. Resumo e teste são avisos avulsos: não agrupam. Pura.
 */
export interface AlertaHistorico {
  id: number | string
  criado_em: string
  nivel: string
  assunto: string
  texto: string
  resolvido_em?: string | null
  canal?: string | null
  enviado?: boolean
  erro?: string | null
}

export type Situacao = 'ativo' | 'resolvido' | null

export interface GrupoAlerta { assunto: string; vezes: number; primeiro: AlertaHistorico; ultimo: AlertaHistorico; situacao: Situacao }

const agrupavel = (a: AlertaHistorico) => a.nivel === 'amarelo' || a.nivel === 'vermelho'

/** `alertas` em ordem do mais recente para o mais antigo (como o painel lê). Mantém essa ordem pelo último de cada grupo. */
export function agruparAlertas(alertas: AlertaHistorico[]): GrupoAlerta[] {
  const out: GrupoAlerta[] = []
  const porAssunto = new Map<string, GrupoAlerta>()
  for (const a of alertas) {
    if (!agrupavel(a)) { out.push({ assunto: a.assunto, vezes: 1, primeiro: a, ultimo: a, situacao: null }); continue }
    const g = porAssunto.get(a.assunto)
    if (g) { g.vezes++; g.primeiro = a; continue }
    const novo: GrupoAlerta = { assunto: a.assunto, vezes: 1, primeiro: a, ultimo: a, situacao: a.resolvido_em ? 'resolvido' : 'ativo' }
    porAssunto.set(a.assunto, novo)
    out.push(novo)
  }
  return out
}
