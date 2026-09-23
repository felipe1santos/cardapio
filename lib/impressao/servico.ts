import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarAuditoria } from '@/lib/auditoria'
import { traduzirErro } from '@/lib/servicos/conta-presencial'
import { gerarCodigoPareamento, gerarCredencial, hashCodigo, VALIDADE_CODIGO_MIN } from './credenciais'

/**
 * Impressão com vários computadores e impressoras — leitura e operações de servidor.
 * Tudo com service_role e com a loja da sessão (painel) ou do agente autenticado.
 */

export type Funcao = 'cozinha' | 'caixa'
export const FUNCOES: Funcao[] = ['cozinha', 'caixa']
export const ehFuncao = (v: unknown): v is Funcao => v === 'cozinha' || v === 'caixa'

/** Agente "online" = sinal nos últimos 30 s (ele consulta a cada poucos segundos). */
export const ONLINE_SEGUNDOS = 30

export interface Operador {
  restauranteId: string
  userId: string
  nome: string
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string; codigo: string; status: number }

async function rpc<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Resultado<T>> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) {
    console.error(`[impressao] ${fn}:`, error.message)
    const t = traduzirErro(error.message)
    return { ok: false, erro: MENSAGENS[t.codigo] ?? t.erro, codigo: t.codigo, status: STATUS[t.codigo] ?? t.status }
  }
  return { ok: true, valor: data as T }
}

const MENSAGENS: Record<string, string> = {
  codigo_invalido: 'Código de pareamento inválido, já usado ou vencido. Gere outro no painel.',
  agente_invalido: 'Este computador foi desconectado da loja. Pareie de novo.',
  impressoras_demais: 'Impressoras demais neste computador (máximo 50).',
  impressora_caixa_nao_configurada: 'Nenhuma impressora de Caixa configurada. Configure em Ajustes › Impressão.',
  impressora_caixa_indisponivel: 'A impressora de Caixa está num computador desconectado. Revise em Ajustes › Impressão.',
  comanda_indisponivel: 'Esta conta não pode mais ter pré-conta (cancelada ou transferida).',
  comanda_inexistente: 'Conta não encontrada.',
  dispositivo_inexistente: 'Impressora não encontrada nesta loja.',
  dispositivo_de_outra_loja: 'Impressora não encontrada nesta loja.',
  trabalho_inexistente: 'Trabalho de impressão não encontrado.',
  trabalho_imutavel: 'O que foi impresso não pode ser alterado.',
  chave_invalida: 'Operação sem identificador. Recarregue a tela.',
}
const STATUS: Record<string, number> = {
  codigo_invalido: 401,
  agente_invalido: 401,
  impressora_caixa_nao_configurada: 409,
  impressora_caixa_indisponivel: 409,
  comanda_indisponivel: 409,
  comanda_inexistente: 404,
  dispositivo_inexistente: 404,
  dispositivo_de_outra_loja: 404,
  trabalho_inexistente: 404,
}

const falha = (erro: string, status = 400, codigo = 'invalido') => ({ ok: false as const, erro, codigo, status })

// ─── pareamento ─────────────────────────────────────────────────────────────

export async function gerarPareamento(admin: SupabaseClient, op: Operador): Promise<{ codigo: string; expiraEm: string }> {
  const { codigo, hash } = gerarCodigoPareamento()
  const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_MIN * 60_000).toISOString()
  const { error } = await admin.from('impressao_pareamentos').insert({
    restaurante_id: op.restauranteId, codigo_hash: hash, expira_em: expiraEm, criado_por: op.userId, criado_por_nome: op.nome,
  })
  if (error) throw error
  // Sem o código na auditoria: quem gerou e quando.
  await registrarAuditoria(admin, {
    restauranteId: op.restauranteId, usuarioId: op.userId, usuarioNome: op.nome,
    acao: 'impressao.codigo_gerado', entidade: 'restaurante', entidadeId: op.restauranteId, dados: { validade_min: VALIDADE_CODIGO_MIN },
  })
  return { codigo, expiraEm }
}

export async function parear(admin: SupabaseClient, a: { codigo: string; nome: string; versao: string | null }) {
  const { credencial, hash } = gerarCredencial()
  const r = await rpc<{ agente_id: string; restaurante_id: string; nome: string }>(admin, 'impressao_parear', {
    p_codigo_hash: hashCodigo(a.codigo), p_credencial_hash: hash, p_nome: a.nome, p_versao: a.versao,
  })
  if (!r.ok) return r
  return { ok: true as const, valor: { credencial, agenteId: r.valor.agente_id, nome: r.valor.nome } }
}

// ─── painel ─────────────────────────────────────────────────────────────────

export interface AgenteVisao {
  id: string
  nome: string
  versao: string | null
  vistoEm: string | null
  online: boolean
  revogado: boolean
  criadoEm: string
  criadoPorNome: string | null
}

export interface DispositivoVisao {
  id: string
  agenteId: string
  nomeSistema: string
  apelido: string | null
  larguraMm: 58 | 80
  tamanhoFonte: 'grande' | 'media' | 'pequena'
  disponivel: boolean
  vistoEm: string | null
  ultimoUsoEm: string | null
  ultimoErro: string | null
  ultimoErroEm: string | null
  funcoes: Funcao[]
}

export interface TrabalhoVisao {
  id: string
  tipo: string
  via: number
  estado: string
  erro: string | null
  tentativas: number
  criadoEm: string
  enviadoEm: string | null
  criadoPorNome: string
  impressora: string
  comandaId: string | null
}

export async function painelImpressao(admin: SupabaseClient, restauranteId: string) {
  const [{ data: ags }, { data: dsp }, { data: fns }, { data: tbs }, { data: loja }] = await Promise.all([
    admin.from('impressao_agentes').select('id, nome, versao, visto_em, revogado_em, criado_em, criado_por_nome').eq('restaurante_id', restauranteId).order('criado_em'),
    admin.from('impressao_dispositivos').select('id, agente_id, nome_sistema, apelido, largura_mm, tamanho_fonte, disponivel, visto_em, ultimo_uso_em, ultimo_erro, ultimo_erro_em').eq('restaurante_id', restauranteId).order('criado_em'),
    admin.from('impressao_funcoes').select('funcao, dispositivo_id').eq('restaurante_id', restauranteId),
    admin.from('impressao_trabalhos').select('id, tipo, via, estado, erro, tentativas, criado_em, enviado_em, criado_por_nome, comanda_id, impressao_dispositivos ( apelido, nome_sistema )').eq('restaurante_id', restauranteId).order('criado_em', { ascending: false }).limit(30),
    admin.from('restaurantes').select('impressao_cozinha_por_funcao, impressao_agente_visto_em').eq('id', restauranteId).maybeSingle(),
  ])
  const agora = Date.now()
  const funcoes = (fns ?? []) as { funcao: Funcao; dispositivo_id: string }[]
  const agentes: AgenteVisao[] = ((ags ?? []) as Record<string, string | null>[]).map((a) => ({
    id: a.id as string,
    nome: a.nome as string,
    versao: a.versao,
    vistoEm: a.visto_em,
    online: !a.revogado_em && !!a.visto_em && agora - new Date(a.visto_em).getTime() < ONLINE_SEGUNDOS * 1000,
    revogado: !!a.revogado_em,
    criadoEm: a.criado_em as string,
    criadoPorNome: a.criado_por_nome,
  }))
  const dispositivos: DispositivoVisao[] = ((dsp ?? []) as Record<string, unknown>[]).map((d) => ({
    id: d.id as string,
    agenteId: d.agente_id as string,
    nomeSistema: d.nome_sistema as string,
    apelido: (d.apelido as string | null) ?? null,
    larguraMm: d.largura_mm as 58 | 80,
    tamanhoFonte: d.tamanho_fonte as DispositivoVisao['tamanhoFonte'],
    disponivel: d.disponivel as boolean,
    vistoEm: (d.visto_em as string | null) ?? null,
    ultimoUsoEm: (d.ultimo_uso_em as string | null) ?? null,
    ultimoErro: (d.ultimo_erro as string | null) ?? null,
    ultimoErroEm: (d.ultimo_erro_em as string | null) ?? null,
    funcoes: funcoes.filter((f) => f.dispositivo_id === d.id).map((f) => f.funcao),
  }))
  const trabalhos: TrabalhoVisao[] = ((tbs ?? []) as unknown as (Record<string, unknown> & { impressao_dispositivos: { apelido: string | null; nome_sistema: string } | null })[]).map((t) => ({
    id: t.id as string,
    tipo: t.tipo as string,
    via: t.via as number,
    estado: t.estado as string,
    erro: (t.erro as string | null) ?? null,
    tentativas: t.tentativas as number,
    criadoEm: t.criado_em as string,
    enviadoEm: (t.enviado_em as string | null) ?? null,
    criadoPorNome: t.criado_por_nome as string,
    impressora: t.impressao_dispositivos?.apelido ?? t.impressao_dispositivos?.nome_sistema ?? '—',
    comandaId: (t.comanda_id as string | null) ?? null,
  }))
  const vistoLegado = (loja?.impressao_agente_visto_em as string | null) ?? null
  return {
    agentes,
    dispositivos,
    funcoes: Object.fromEntries(FUNCOES.map((f) => [f, funcoes.find((x) => x.funcao === f)?.dispositivo_id ?? null])) as Record<Funcao, string | null>,
    trabalhos,
    cozinhaPorFuncao: loja?.impressao_cozinha_por_funcao === true,
    assistenteAntigoVistoEm: vistoLegado,
    assistenteAntigoOnline: !!vistoLegado && agora - new Date(vistoLegado).getTime() < 2 * 60_000,
  }
}

// ─── operações do painel ────────────────────────────────────────────────────

function auditar(admin: SupabaseClient, op: Operador, acao: string, entidade: string, entidadeId: string, dados: Record<string, unknown>) {
  return registrarAuditoria(admin, { restauranteId: op.restauranteId, usuarioId: op.userId, usuarioNome: op.nome, acao, entidade, entidadeId, dados })
}

export async function renomearAgente(admin: SupabaseClient, op: Operador, id: string, nome: string): Promise<Resultado<null>> {
  const n = nome.replace(/\s+/g, ' ').trim()
  if (!n || n.length > 60) return falha('Nome do computador entre 1 e 60 caracteres.')
  const { data, error } = await admin.from('impressao_agentes').update({ nome: n }).eq('id', id).eq('restaurante_id', op.restauranteId).select('id')
  if (error) return falha('Não foi possível salvar.', 500, 'erro')
  if (!data?.length) return falha('Computador não encontrado.', 404, 'agente_inexistente')
  await auditar(admin, op, 'impressao.agente_renomeado', 'impressao_agente', id, { nome: n, resumo: n })
  return { ok: true, valor: null }
}

export async function revogarAgente(admin: SupabaseClient, op: Operador, id: string): Promise<Resultado<null>> {
  const { data, error } = await admin
    .from('impressao_agentes')
    .update({ revogado_em: new Date().toISOString(), revogado_por_nome: op.nome })
    .eq('id', id)
    .eq('restaurante_id', op.restauranteId)
    .is('revogado_em', null)
    .select('id, nome')
  if (error) return falha('Não foi possível revogar.', 500, 'erro')
  if (!data?.length) return falha('Computador não encontrado ou já revogado.', 404, 'agente_inexistente')
  // Trabalhos ainda na fila desse computador não saem mais por ele.
  await admin.from('impressao_trabalhos').update({ estado: 'cancelado', erro: 'computador revogado' }).eq('agente_id', id).in('estado', ['pendente', 'reservado'])
  await auditar(admin, op, 'impressao.agente_revogado', 'impressao_agente', id, { nome: data[0].nome, resumo: data[0].nome })
  return { ok: true, valor: null }
}

export async function ajustarDispositivo(
  admin: SupabaseClient,
  op: Operador,
  id: string,
  a: { apelido?: unknown; larguraMm?: unknown; tamanhoFonte?: unknown },
): Promise<Resultado<null>> {
  const patch: Record<string, unknown> = {}
  if (a.apelido !== undefined) {
    const ap = typeof a.apelido === 'string' ? a.apelido.replace(/\s+/g, ' ').trim() : ''
    if (ap.length > 40) return falha('Apelido com no máximo 40 caracteres.')
    patch.apelido = ap || null
  }
  if (a.larguraMm !== undefined) {
    if (a.larguraMm !== 58 && a.larguraMm !== 80) return falha('Largura do papel: 58 ou 80 mm.')
    patch.largura_mm = a.larguraMm
  }
  if (a.tamanhoFonte !== undefined) {
    if (!['grande', 'media', 'pequena'].includes(a.tamanhoFonte as string)) return falha('Tamanho de fonte inválido.')
    patch.tamanho_fonte = a.tamanhoFonte
  }
  if (Object.keys(patch).length === 0) return { ok: true, valor: null }
  const { data, error } = await admin.from('impressao_dispositivos').update(patch).eq('id', id).eq('restaurante_id', op.restauranteId).select('id, nome_sistema')
  if (error) return falha('Não foi possível salvar.', 500, 'erro')
  if (!data?.length) return falha('Impressora não encontrada nesta loja.', 404, 'dispositivo_inexistente')
  await auditar(admin, op, 'impressao.impressora_ajustada', 'impressao_dispositivo', id, { ...patch, resumo: (patch.apelido as string) ?? data[0].nome_sistema })
  return { ok: true, valor: null }
}

/**
 * Atribui (ou tira) a função. A mesma impressora em duas funções só com
 * `confirmarCompartilhada` — nunca por acaso.
 */
export async function atribuirFuncao(
  admin: SupabaseClient,
  op: Operador,
  funcao: Funcao,
  dispositivoId: string | null,
  confirmarCompartilhada: boolean,
): Promise<Resultado<null>> {
  if (dispositivoId === null) {
    await admin.from('impressao_funcoes').delete().eq('restaurante_id', op.restauranteId).eq('funcao', funcao)
    if (funcao === 'cozinha') {
      // Sem impressora de cozinha, o roteamento por função não tem destino: volta ao modo de sempre.
      await admin.from('restaurantes').update({ impressao_cozinha_por_funcao: false }).eq('id', op.restauranteId)
    }
    await auditar(admin, op, 'impressao.funcao_removida', 'restaurante', op.restauranteId, { funcao, resumo: funcao })
    return { ok: true, valor: null }
  }
  const { data: d } = await admin
    .from('impressao_dispositivos')
    .select('id, apelido, nome_sistema, impressao_agentes ( revogado_em )')
    .eq('id', dispositivoId)
    .eq('restaurante_id', op.restauranteId)
    .maybeSingle()
  if (!d) return falha('Impressora não encontrada nesta loja.', 404, 'dispositivo_inexistente')
  const ag = (d as unknown as { impressao_agentes: { revogado_em: string | null } | null }).impressao_agentes
  if (ag?.revogado_em) return falha('Esta impressora está num computador desconectado.', 409, 'agente_revogado')

  const outra: Funcao = funcao === 'cozinha' ? 'caixa' : 'cozinha'
  const { data: jaTem } = await admin.from('impressao_funcoes').select('dispositivo_id').eq('restaurante_id', op.restauranteId).eq('funcao', outra).maybeSingle()
  if (jaTem?.dispositivo_id === dispositivoId && !confirmarCompartilhada) {
    return falha(`Esta impressora já faz a função ${outra === 'cozinha' ? 'Cozinha' : 'Caixa'}. Confirme para ela fazer as duas.`, 409, 'confirmar_compartilhada')
  }
  const { error } = await admin
    .from('impressao_funcoes')
    .upsert({ restaurante_id: op.restauranteId, funcao, dispositivo_id: dispositivoId, atribuido_em: new Date().toISOString(), atribuido_por_nome: op.nome })
  if (error) return falha('Não foi possível atribuir a função.', 500, 'erro')
  await auditar(admin, op, 'impressao.funcao_atribuida', 'impressao_dispositivo', dispositivoId, {
    funcao, compartilhada: jaTem?.dispositivo_id === dispositivoId, resumo: `${funcao} → ${d.apelido ?? d.nome_sistema}`,
  })
  return { ok: true, valor: null }
}

export async function criarTeste(admin: SupabaseClient, op: Operador, dispositivoId: string, chave: string) {
  return rpc<{ id: string; estado: string; idempotente: boolean }>(admin, 'impressao_teste_criar', {
    p_restaurante: op.restauranteId, p_dispositivo: dispositivoId, p_chave: chave, p_ator: op.userId, p_ator_nome: op.nome,
  })
}

// ─── pré-conta ──────────────────────────────────────────────────────────────

export async function criarPreConta(admin: SupabaseClient, op: Operador, comandaId: string, chave: string, reimpressao: boolean) {
  return rpc<{ id: string; via: number; estado: string; idempotente: boolean; impressora?: string }>(admin, 'impressao_pre_conta_criar', {
    p_restaurante: op.restauranteId, p_comanda: comandaId, p_chave: chave, p_reimpressao: reimpressao, p_ator: op.userId, p_ator_nome: op.nome,
  })
}

export interface PreContaVisao {
  id: string
  via: number
  estado: string
  erro: string | null
  criadoEm: string
  enviadoEm: string | null
  criadoPorNome: string
  impressora: string
  computadorOnline: boolean
  total: number
}

export async function ultimasPreContas(admin: SupabaseClient, restauranteId: string, comandaId: string): Promise<PreContaVisao[]> {
  const { data } = await admin
    .from('impressao_trabalhos')
    .select('id, via, estado, erro, criado_em, enviado_em, criado_por_nome, snapshot, impressao_dispositivos ( apelido, nome_sistema ), impressao_agentes ( visto_em, revogado_em )')
    .eq('restaurante_id', restauranteId)
    .eq('comanda_id', comandaId)
    .eq('tipo', 'pre_conta')
    .order('criado_em', { ascending: false })
    .limit(5)
  const agora = Date.now()
  return ((data ?? []) as unknown as {
    id: string; via: number; estado: string; erro: string | null; criado_em: string; enviado_em: string | null; criado_por_nome: string
    snapshot: { total?: number }
    impressao_dispositivos: { apelido: string | null; nome_sistema: string } | null
    impressao_agentes: { visto_em: string | null; revogado_em: string | null } | null
  }[]).map((t) => ({
    id: t.id,
    via: t.via,
    estado: t.estado,
    erro: t.erro,
    criadoEm: t.criado_em,
    enviadoEm: t.enviado_em,
    criadoPorNome: t.criado_por_nome,
    impressora: t.impressao_dispositivos?.apelido ?? t.impressao_dispositivos?.nome_sistema ?? '—',
    computadorOnline: !t.impressao_agentes?.revogado_em && !!t.impressao_agentes?.visto_em && agora - new Date(t.impressao_agentes.visto_em).getTime() < ONLINE_SEGUNDOS * 1000,
    total: Number(t.snapshot?.total ?? 0),
  }))
}

// ─── lado do agente ─────────────────────────────────────────────────────────

export async function descobrir(admin: SupabaseClient, agenteId: string, nomes: unknown) {
  if (!Array.isArray(nomes) || !nomes.every((n) => typeof n === 'string')) return falha('Lista de impressoras inválida.')
  return rpc<number>(admin, 'impressao_descobrir', { p_agente: agenteId, p_nomes: (nomes as string[]).slice(0, 60) })
}

export interface TrabalhoAgente {
  id: string
  tipo: 'pre_conta' | 'teste_impressora'
  via: number
  snapshot: Record<string, unknown>
  nomeSistema: string
  larguraMm: 58 | 80
  dispositivoId: string
  segundosRestantes: number
  tentativas: number
}

export async function reservarTrabalhos(admin: SupabaseClient, agenteId: string): Promise<Resultado<TrabalhoAgente[]>> {
  const r = await rpc<Record<string, unknown>[]>(admin, 'impressao_trabalhos_reservar', { p_agente: agenteId, p_limite: 10 })
  if (!r.ok) return r
  return {
    ok: true,
    valor: (r.valor ?? []).map((t) => ({
      id: t.id as string,
      tipo: t.tipo as TrabalhoAgente['tipo'],
      via: t.via as number,
      snapshot: t.snapshot as Record<string, unknown>,
      nomeSistema: t.nome_sistema as string,
      larguraMm: t.largura_mm as 58 | 80,
      dispositivoId: t.dispositivo_id as string,
      segundosRestantes: t.segundos_restantes as number,
      tentativas: t.tentativas as number,
    })),
  }
}

export async function informarResultado(admin: SupabaseClient, agenteId: string, trabalhoId: string, ok: boolean, erro: string | null) {
  return rpc<{ id: string; estado: string; ignorado: boolean }>(admin, 'impressao_trabalho_resultado', {
    p_agente: agenteId, p_trabalho: trabalhoId, p_ok: ok, p_erro: erro,
  })
}

// ─── roteamento da ficha da cozinha por função (opção da loja) ───────────────

export interface DestinoCozinha {
  ativo: boolean
  agenteId: string | null
  nomeSistema: string | null
  larguraMm: 58 | 80
  tamanhoFonte: string
  copias: number
}

/** Se a loja roteia a cozinha por função e para qual impressora/computador. */
export async function destinoCozinha(admin: SupabaseClient, restauranteId: string): Promise<DestinoCozinha> {
  const [{ data: loja }, { data: f }] = await Promise.all([
    admin.from('restaurantes').select('impressao_cozinha_por_funcao').eq('id', restauranteId).maybeSingle(),
    admin
      .from('impressao_funcoes')
      .select('impressao_dispositivos ( agente_id, nome_sistema, largura_mm, tamanho_fonte, copias )')
      .eq('restaurante_id', restauranteId)
      .eq('funcao', 'cozinha')
      .maybeSingle(),
  ])
  const d = (f as unknown as { impressao_dispositivos: { agente_id: string; nome_sistema: string; largura_mm: 58 | 80; tamanho_fonte: string; copias: number } | null } | null)
    ?.impressao_dispositivos
  return {
    ativo: loja?.impressao_cozinha_por_funcao === true && !!d,
    agenteId: d?.agente_id ?? null,
    nomeSistema: d?.nome_sistema ?? null,
    larguraMm: d?.largura_mm ?? 80,
    tamanhoFonte: d?.tamanho_fonte ?? 'grande',
    copias: d?.copias ?? 1,
  }
}

/**
 * Liga/desliga o roteamento da ficha da cozinha pela função.
 *
 * Ligar só quando é seguro trocar de consumidor sem imprimir duas vezes:
 *   · existe impressora de Cozinha num computador pareado, não revogado e ONLINE;
 *   · nenhum Assistente antigo (token da loja) consultou a fila nos últimos 2 minutos —
 *     o antigo não reserva pedidos, e poderia imprimir junto no instante da troca.
 * A fila continua a mesma (pedidos.impresso + reservas da 0086): muda só QUEM consome.
 */
export async function definirCozinhaPorFuncao(admin: SupabaseClient, op: Operador, ativo: boolean): Promise<Resultado<null>> {
  if (ativo) {
    const d = await destinoCozinha(admin, op.restauranteId)
    if (!d.agenteId) return falha('Escolha antes a impressora da função Cozinha.', 409, 'sem_cozinha')
    const { data: ag } = await admin.from('impressao_agentes').select('visto_em, revogado_em').eq('id', d.agenteId).maybeSingle()
    if (!ag || ag.revogado_em) return falha('A impressora da Cozinha está num computador desconectado.', 409, 'agente_revogado')
    if (!ag.visto_em || Date.now() - new Date(ag.visto_em).getTime() > ONLINE_SEGUNDOS * 1000) {
      return falha('O computador da impressora da Cozinha está offline. Ligue o Assistente nele antes.', 409, 'agente_offline')
    }
    const { data: loja } = await admin.from('restaurantes').select('impressao_agente_visto_em').eq('id', op.restauranteId).maybeSingle()
    const antigo = loja?.impressao_agente_visto_em as string | null
    if (antigo && Date.now() - new Date(antigo).getTime() < 2 * 60_000) {
      return falha(
        'Há um Assistente antigo (token da loja) imprimindo a cozinha agora. Feche-o ou pareie esse computador com código, espere 2 minutos e tente de novo.',
        409,
        'assistente_antigo_ativo',
      )
    }
  }
  const { error } = await admin.from('restaurantes').update({ impressao_cozinha_por_funcao: ativo }).eq('id', op.restauranteId)
  if (error) return falha('Não foi possível salvar.', 500, 'erro')
  await registrarAuditoria(admin, {
    restauranteId: op.restauranteId, usuarioId: op.userId, usuarioNome: op.nome,
    acao: ativo ? 'impressao.cozinha_por_funcao_ligada' : 'impressao.cozinha_por_funcao_desligada',
    entidade: 'restaurante', entidadeId: op.restauranteId, dados: {},
  })
  return { ok: true, valor: null }
}
