import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession, type AppSession } from '@/lib/auth/session'
import { normalizarAcessos, podeClientesCsv } from '@/lib/acessos'
import { telefoneWhatsapp } from '@/lib/telefone-br'
import type { ClienteImportado } from '@/lib/clientes-csv'

/**
 * Importação de clientes (0131), lado do servidor. Tudo com service_role, sempre com a loja
 * da SESSÃO (o corpo nunca escolhe a loja). Idempotente: a importação é achada pela `chave`
 * que o navegador gera uma vez por arquivo, e cada lote já gravado fica em `lotes`.
 */

export type Modo = 'ignorar' | 'completar' | 'atualizar'

/** Sessão com permissão de importar/exportar clientes, ou a resposta de erro pronta. */
export async function autorizarClientesCsv(): Promise<{ sessao: AppSession; admin: SupabaseClient } | { erro: NextResponse }> {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  const { data } = await admin.from('usuarios').select('acessos').eq('id', sessao.userId).maybeSingle()
  if (!podeClientesCsv(sessao.papel, normalizarAcessos((data as { acessos?: unknown } | null)?.acessos))) {
    return { erro: NextResponse.json({ error: 'Você não tem permissão para importar ou exportar clientes.', codigo: 'sem_permissao_acao' }, { status: 403 }) }
  }
  return { sessao, admin }
}

export interface TelefoneConhecido { telefone: string; no_cadastro: boolean; com_pedido: boolean; descadastrado: boolean }

export async function telefonesConhecidos(admin: SupabaseClient, restauranteId: string, telefones: string[]): Promise<TelefoneConhecido[]> {
  const out: TelefoneConhecido[] = []
  for (let i = 0; i < telefones.length; i += 2000) {
    const { data, error } = await admin.rpc('clientes_telefones_conhecidos', { p_restaurante: restauranteId, p_telefones: telefones.slice(i, i + 2000) })
    if (error) throw error
    out.push(...((data ?? []) as TelefoneConhecido[]))
  }
  return out
}

const CAMPOS_DB: [keyof ClienteImportado, string][] = [
  ['nome', 'nome'], ['email', 'email'], ['data_nascimento', 'data_nascimento'], ['cep', 'endereco_cep'], ['rua', 'endereco_rua'],
  ['numero', 'endereco_numero'], ['complemento', 'endereco_complemento'], ['bairro', 'endereco_bairro'], ['cidade', 'endereco_cidade'],
  ['uf', 'endereco_uf'], ['observacoes', 'observacoes'],
]
const COLUNAS = CAMPOS_DB.map(([, c]) => c)
/** Colunas de clientes NOT NULL com default '' (0013/0014). */
const TEXTO_NAO_NULO = new Set(['nome', 'endereco_rua', 'endereco_numero', 'endereco_complemento', 'endereco_bairro', 'endereco_cep'])

/** Revalida o que veio do navegador: telefone no formato do sistema, nome obrigatório, tamanhos. */
export function saneada(l: Partial<ClienteImportado>): ClienteImportado | null {
  const telefone = telefoneWhatsapp(String(l.telefone ?? ''))
  const nome = String(l.nome ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!telefone || !nome) return null
  const t = (v: unknown, max: number) => { const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; return s || null }
  const nasc = typeof l.data_nascimento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.data_nascimento) ? l.data_nascimento : null
  const uf = t(l.uf, 2)?.toUpperCase() ?? null
  return {
    nome, telefone, email: t(l.email, 160), data_nascimento: nasc, cep: t(l.cep, 12), rua: t(l.rua, 200), numero: t(l.numero, 20),
    complemento: t(l.complemento, 120), bairro: t(l.bairro, 120), cidade: t(l.cidade, 120), uf: uf && /^[A-Z]{2}$/.test(uf) ? uf : null, observacoes: t(l.observacoes, 500),
  }
}

const vazio = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

/** O que muda num cliente que já existe, conforme o modo. */
export function patchParaExistente(atual: Record<string, unknown>, novo: ClienteImportado, modo: Modo): Record<string, unknown> {
  const p: Record<string, unknown> = {}
  if (modo === 'ignorar') return p
  for (const [campo, col] of CAMPOS_DB) {
    const v = novo[campo]
    if (vazio(v)) continue
    if (modo === 'completar' && !vazio(atual[col])) continue
    if (String(atual[col] ?? '') !== String(v)) p[col] = v
  }
  return p
}

export interface Contagem { criados: number; atualizados: number; ignorados: number; erros: number }

export async function obterImportacao(admin: SupabaseClient, restauranteId: string, chave: string) {
  const { data, error } = await admin.from('clientes_importacoes').select('*').eq('restaurante_id', restauranteId).eq('chave', chave).maybeSingle()
  if (error) throw error
  return data as null | { id: string; status: string; lotes: number[]; modo: Modo; criados: number; atualizados: number; ignorados: number; erros: number; total_linhas: number }
}

/**
 * Grava um lote. A reserva é atômica no banco: repetir o mesmo lote (clique duplo, reenvio
 * depois de cair a internet) não grava de novo. Se o lote falhar no meio, a reserva é
 * liberada para ele poder ser reenviado.
 */
export async function gravarLote(admin: SupabaseClient, imp: { id: string; modo: Modo }, restauranteId: string, lote: number, linhas: Partial<ClienteImportado>[]): Promise<Contagem & { repetido: boolean }> {
  const { data: reservou, error: er } = await admin.rpc('clientes_importacao_reservar_lote', { p_id: imp.id, p_lote: lote })
  if (er) throw er
  if (!reservou) return { criados: 0, atualizados: 0, ignorados: 0, erros: 0, repetido: true }
  try {
    const c = await gravarLoteReservado(admin, imp, restauranteId, linhas)
    await admin.rpc('clientes_importacao_somar', { p_id: imp.id, p_criados: c.criados, p_atualizados: c.atualizados, p_ignorados: c.ignorados, p_erros: c.erros })
    return { ...c, repetido: false }
  } catch (e) {
    await admin.rpc('clientes_importacao_liberar_lote', { p_id: imp.id, p_lote: lote })
    throw e
  }
}

async function gravarLoteReservado(admin: SupabaseClient, imp: { id: string; modo: Modo }, restauranteId: string, linhas: Partial<ClienteImportado>[]): Promise<Contagem> {
  const c: Contagem = { criados: 0, atualizados: 0, ignorados: 0, erros: 0 }
  const vistos = new Set<string>()
  const validas: ClienteImportado[] = []
  for (const l of linhas) {
    const s = saneada(l)
    if (!s || vistos.has(s.telefone)) { c.erros++; continue }
    vistos.add(s.telefone)
    validas.push(s)
  }
  const tels = validas.map((v) => v.telefone)
  const conhecidos = new Map((await telefonesConhecidos(admin, restauranteId, tels)).map((k) => [k.telefone, k]))
  // De 100 em 100: o filtro "in" vai na URL e 500 telefones passam do limite (URI too long).
  const atuais: Record<string, unknown>[] = []
  for (let i = 0; i < tels.length; i += 100) {
    const { data, error } = await admin.from('clientes').select(['id', 'telefone', ...COLUNAS].join(', ')).eq('restaurante_id', restauranteId).in('telefone', tels.slice(i, i + 100))
    if (error) throw error
    atuais.push(...((data ?? []) as unknown as Record<string, unknown>[]))
  }
  const porTel = new Map(atuais.map((r) => [String(r.telefone), r]))

  const novos: Record<string, unknown>[] = []
  const alteracoes: { importacao_id: string; cliente_id: string; acao: 'criado' | 'atualizado'; antes: Record<string, unknown> | null }[] = []
  for (const v of validas) {
    const atual = porTel.get(v.telefone)
    const soPedido = !atual && conhecidos.get(v.telefone)?.com_pedido
    if (!atual) {
      // Cliente que só existe pelos pedidos: no modo "Ignorar" fica como está.
      if (soPedido && imp.modo === 'ignorar') { c.ignorados++; continue }
      const linha: Record<string, unknown> = { restaurante_id: restauranteId, telefone: v.telefone, importacao_id: imp.id, origem: soPedido ? null : 'importado' }
      // Todas as colunas em todas as linhas: no insert em lote o PostgREST junta as colunas
      // e manda NULL onde faltar (não o default) — e nome/endereço são NOT NULL ''.
      for (const [campo, col] of CAMPOS_DB) linha[col] = vazio(v[campo]) ? (TEXTO_NAO_NULO.has(col) ? '' : null) : v[campo]
      novos.push(linha)
      continue
    }
    const patch = patchParaExistente(atual, v, imp.modo)
    if (!Object.keys(patch).length) { c.ignorados++; continue }
    const antes = Object.fromEntries(Object.keys(patch).map((k) => [k, atual[k] ?? null]))
    const { error: eu } = await admin.from('clientes').update(patch).eq('id', String(atual.id)).eq('restaurante_id', restauranteId)
    if (eu) { c.erros++; continue }
    c.atualizados++
    alteracoes.push({ importacao_id: imp.id, cliente_id: String(atual.id), acao: 'atualizado', antes })
  }
  if (novos.length) {
    // on conflict do nothing: se outro lote/clique gravou o mesmo telefone, não duplica.
    const { data: criados, error: ec } = await admin.from('clientes').upsert(novos, { onConflict: 'restaurante_id,telefone', ignoreDuplicates: true }).select('id')
    if (ec) throw ec
    c.criados += (criados ?? []).length
    c.ignorados += novos.length - (criados ?? []).length
    for (const r of criados ?? []) alteracoes.push({ importacao_id: imp.id, cliente_id: r.id as string, acao: 'criado', antes: null })
  }
  if (alteracoes.length) {
    const { error: ea } = await admin.from('clientes_importacao_alteracoes').insert(alteracoes)
    if (ea) throw ea
  }
  return c
}

export const DIAS_DESFAZER = 7

/**
 * Desfaz: apaga os clientes que esta importação CRIOU e que ainda não pediram nem entraram
 * na conta depois dela; os atualizados voltam ao valor de antes.
 */
export async function desfazerImportacao(admin: SupabaseClient, restauranteId: string, id: string): Promise<{ ok: true; removidos: number; mantidos: number; restaurados: number } | { ok: false; erro: string; status: number }> {
  const { data: imp } = await admin.from('clientes_importacoes').select('id, status, criado_em').eq('id', id).eq('restaurante_id', restauranteId).maybeSingle()
  if (!imp) return { ok: false, erro: 'Importação não encontrada.', status: 404 }
  if (imp.status === 'desfeita') return { ok: false, erro: 'Esta importação já foi desfeita.', status: 409 }
  if (Date.now() - new Date(imp.criado_em).getTime() > DIAS_DESFAZER * 86_400_000) return { ok: false, erro: `Só dá para desfazer em até ${DIAS_DESFAZER} dias.`, status: 409 }
  // Marca antes de mexer: dois cliques não desfazem duas vezes.
  const { data: marcou } = await admin.from('clientes_importacoes').update({ status: 'desfeita', desfeita_em: new Date().toISOString() }).eq('id', id).neq('status', 'desfeita').select('id')
  if (!marcou?.length) return { ok: false, erro: 'Esta importação já foi desfeita.', status: 409 }
  const alts = [] as { cliente_id: string; acao: string; antes: Record<string, unknown> | null }[]
  for (let de = 0; ; de += 1000) {
    const { data } = await admin.from('clientes_importacao_alteracoes').select('cliente_id, acao, antes').eq('importacao_id', id).order('id').range(de, de + 999)
    alts.push(...((data ?? []) as typeof alts))
    if (!data || data.length < 1000) break
  }
  let removidos = 0, mantidos = 0, restaurados = 0
  const criados = alts.filter((a) => a.acao === 'criado').map((a) => a.cliente_id)
  const pediramDepois = await telefonesComPedidoDepois(admin, restauranteId, imp.criado_em)
  // De 100 em 100 (ids na URL do filtro "in").
  for (let i = 0; i < criados.length; i += 100) {
    const ids = criados.slice(i, i + 100)
    const { data: linhas } = await admin.from('clientes').select('id, telefone, verificado_em').in('id', ids).eq('restaurante_id', restauranteId)
    const apagar = (linhas ?? []).filter((l) => !l.verificado_em && !pediramDepois.has(l.telefone as string)).map((l) => l.id as string)
    mantidos += (linhas ?? []).length - apagar.length
    if (apagar.length) {
      const { error } = await admin.from('clientes').delete().in('id', apagar).eq('restaurante_id', restauranteId)
      if (error) throw error
      removidos += apagar.length
    }
  }
  for (const a of alts.filter((x) => x.acao === 'atualizado' && x.antes)) {
    const { error } = await admin.from('clientes').update(a.antes!).eq('id', a.cliente_id).eq('restaurante_id', restauranteId)
    if (!error) restaurados++
  }
  return { ok: true, removidos, mantidos, restaurados }
}

/** Telefones (no formato do sistema) que fizeram pedido desde a importação (até 7 dias). */
async function telefonesComPedidoDepois(admin: SupabaseClient, restauranteId: string, desde: string): Promise<Set<string>> {
  const achados = new Set<string>()
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from('pedidos').select('cliente_telefone').eq('restaurante_id', restauranteId).gte('criado_em', desde).order('id').range(de, de + 999)
    if (error) throw error
    for (const p of data ?? []) { const t = telefoneWhatsapp(p.cliente_telefone as string); if (t) achados.add(t) }
    if (!data || data.length < 1000) break
  }
  return achados
}
