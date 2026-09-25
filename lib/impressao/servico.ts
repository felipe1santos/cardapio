import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarAuditoria } from '@/lib/auditoria'
import { traduzirErro } from '@/lib/servicos/conta-presencial'
import { gerarCodigoPareamento, gerarCredencial, hashCodigo, VALIDADE_CODIGO_MIN } from './credenciais'
import { snapshotReciboTeste } from './recibo-teste'

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
  impressora_caixa_nao_configurada: 'Nenhuma impressora de Caixa configurada. Configure no menu Impressão.',
  impressora_caixa_indisponivel: 'A impressora de Caixa está num computador desconectado. Revise no menu Impressão.',
  comanda_indisponivel: 'Esta conta não pode mais ter Recibo/Extrato (cancelada ou transferida).',
  beta_nao_liberado: 'O novo Assistente Beta ainda não está liberado para esta loja.',
  modo_invalido: 'Modo de impressão inválido.',
  sem_cozinha: 'Escolha antes a impressora da Cozinha.',
  agente_revogado: 'A impressora da Cozinha está num computador desconectado.',
  agente_offline: 'O computador da impressora da Cozinha está offline. Abra o Assistente Beta nele antes.',
  loja_inexistente: 'Loja não encontrada.',
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
  beta_nao_liberado: 403,
  sem_cozinha: 409,
  agente_revogado: 409,
  agente_offline: 409,
  loja_inexistente: 404,
  impressora_caixa_indisponivel: 409,
  comanda_indisponivel: 409,
  comanda_inexistente: 404,
  dispositivo_inexistente: 404,
  dispositivo_de_outra_loja: 404,
  trabalho_inexistente: 404,
}

const falha = (erro: string, status = 400, codigo = 'invalido') => ({ ok: false as const, erro, codigo, status })

// ─── pareamento ─────────────────────────────────────────────────────────────

export async function gerarPareamento(admin: SupabaseClient, op: Operador): Promise<Resultado<{ codigo: string; expiraEm: string }>> {
  // O Beta só entra em loja liberada para o piloto (0100): sem isso, nenhum computador pareia.
  const { data: loja } = await admin.from('restaurantes').select('impressao_beta_liberado').eq('id', op.restauranteId).maybeSingle()
  if (loja?.impressao_beta_liberado !== true) return falha(MENSAGENS.beta_nao_liberado, 403, 'beta_nao_liberado')
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
  return { ok: true, valor: { codigo, expiraEm } }
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
  /** Perfil individual (0100): nulo = padrão (576 pontos no 80 mm, 384 no 58 mm). */
  larguraPontos: number | null
  deslocamentoPontos: number
  diagnostico: Record<string, unknown> | null
  calibradoEm: string | null
  calibradoPorNome: string | null
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
  /** Só em teste_impressora: página de calibração ou Recibo/Extrato de teste. */
  subtipo: 'calibracao' | 'recibo_teste' | null
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
    admin.from('impressao_dispositivos').select('id, agente_id, nome_sistema, apelido, largura_mm, tamanho_fonte, largura_pontos, deslocamento_pontos, diagnostico, calibrado_em, calibrado_por_nome, disponivel, visto_em, ultimo_uso_em, ultimo_erro, ultimo_erro_em').eq('restaurante_id', restauranteId).order('criado_em'),
    admin.from('impressao_funcoes').select('funcao, dispositivo_id').eq('restaurante_id', restauranteId),
    admin.from('impressao_trabalhos').select('id, tipo, via, estado, erro, tentativas, criado_em, enviado_em, criado_por_nome, comanda_id, calibracao:snapshot->>calibracao, recibo_teste:snapshot->>recibo_teste, impressao_dispositivos ( apelido, nome_sistema )').eq('restaurante_id', restauranteId).order('criado_em', { ascending: false }).limit(30),
    admin.from('restaurantes').select('impressao_cozinha_por_funcao, impressao_agente_visto_em, impressao_beta_liberado, impressao_beta_modo, impressao_cozinha_transferida_em').eq('id', restauranteId).maybeSingle(),
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
    larguraPontos: (d.largura_pontos as number | null) ?? null,
    deslocamentoPontos: (d.deslocamento_pontos as number | null) ?? 0,
    diagnostico: (d.diagnostico as Record<string, unknown> | null) ?? null,
    calibradoEm: (d.calibrado_em as string | null) ?? null,
    calibradoPorNome: (d.calibrado_por_nome as string | null) ?? null,
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
    subtipo: String(t.recibo_teste) === 'true' ? 'recibo_teste' : String(t.calibracao) === 'true' ? 'calibracao' : null,
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
    betaLiberado: loja?.impressao_beta_liberado === true,
    modo: ((loja?.impressao_beta_modo as string | undefined) ?? 'teste') as ModoBeta,
    cozinhaTransferidaEm: (loja?.impressao_cozinha_transferida_em as string | null) ?? null,
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
  a: { apelido?: unknown; larguraMm?: unknown; tamanhoFonte?: unknown; larguraPontos?: unknown; deslocamentoPontos?: unknown },
): Promise<Resultado<null>> {
  const patch: Record<string, unknown> = {}
  // Perfil de calibração (0100): só desta impressora. null volta ao padrão de fábrica.
  if (a.larguraPontos !== undefined) {
    if (a.larguraPontos !== null && !(Number.isInteger(a.larguraPontos) && (a.larguraPontos as number) >= 256 && (a.larguraPontos as number) <= 832)) {
      return falha('Largura útil inválida (entre 256 e 832 pontos).')
    }
    patch.largura_pontos = a.larguraPontos
  }
  if (a.deslocamentoPontos !== undefined) {
    if (!(Number.isInteger(a.deslocamentoPontos) && (a.deslocamentoPontos as number) >= -64 && (a.deslocamentoPontos as number) <= 64)) {
      return falha('Deslocamento inválido (entre -64 e 64 pontos).')
    }
    patch.deslocamento_pontos = a.deslocamentoPontos
  }
  if (patch.largura_pontos !== undefined || patch.deslocamento_pontos !== undefined) {
    patch.calibrado_em = new Date().toISOString()
    patch.calibrado_por_nome = op.nome
  }
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
      // Sem impressora de cozinha, o Beta não tem onde imprimir a ficha: a cozinha volta ao
      // Assistente antigo. "Cozinha e Caixa" vira "Somente Caixa" pela troca auditada (0100).
      const { data: l } = await admin.from('restaurantes').select('impressao_beta_modo').eq('id', op.restauranteId).maybeSingle()
      if (l?.impressao_beta_modo === 'cozinha_caixa') await definirModo(admin, op, 'caixa')
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

export async function criarTeste(admin: SupabaseClient, op: Operador, dispositivoId: string, chave: string, calibracao = false) {
  return rpc<{ id: string; estado: string; idempotente: boolean }>(admin, calibracao ? 'impressao_calibracao_criar' : 'impressao_teste_criar', {
    p_restaurante: op.restauranteId, p_dispositivo: dispositivoId, p_chave: chave, p_ator: op.userId, p_ator_nome: op.nome,
  })
}

/**
 * Recibo/Extrato de TESTE numa impressora do Beta: documento de demonstração com os mesmos
 * blocos do Recibo/Extrato real, desenhado pelo mesmo renderizador do Assistente Beta e com
 * o perfil da impressora. Só texto na fila de impressão — não cria pedido, comanda,
 * pagamento, fidelidade nem cupom; o Assistente antigo nunca vê esta fila.
 * Clique duplo / reenvio (mesma chave): o mesmo trabalho (único por loja + chave).
 */
export async function criarReciboTeste(admin: SupabaseClient, op: Operador, dispositivoId: string, chave: unknown): Promise<Resultado<{ id: string; estado: string; idempotente: boolean }>> {
  if (typeof chave !== 'string' || !/^[0-9a-f-]{36}$/i.test(chave)) return falha(MENSAGENS.chave_invalida, 400, 'chave_invalida')
  const existente = async () =>
    (await admin.from('impressao_trabalhos').select('id, estado').eq('restaurante_id', op.restauranteId).eq('chave', chave).maybeSingle()).data as { id: string; estado: string } | null
  const ja = await existente()
  if (ja) return { ok: true, valor: { ...ja, idempotente: true } }
  const { data: d } = await admin
    .from('impressao_dispositivos')
    .select('id, agente_id, apelido, nome_sistema, largura_mm, largura_pontos, deslocamento_pontos, impressao_agentes ( nome, revogado_em ), restaurantes ( nome )')
    .eq('id', dispositivoId)
    .eq('restaurante_id', op.restauranteId)
    .maybeSingle()
  const disp = d as unknown as {
    id: string; agente_id: string; apelido: string | null; nome_sistema: string; largura_mm: number; largura_pontos: number | null; deslocamento_pontos: number
    impressao_agentes: { nome: string; revogado_em: string | null } | null; restaurantes: { nome: string } | null
  } | null
  if (!disp) return falha(MENSAGENS.dispositivo_inexistente, 404, 'dispositivo_inexistente')
  if (!disp.impressao_agentes || disp.impressao_agentes.revogado_em) return falha(MENSAGENS.impressora_caixa_indisponivel, 409, 'impressora_caixa_indisponivel')
  const impressora = disp.apelido ?? disp.nome_sistema
  const snapshot = snapshotReciboTeste({
    loja: disp.restaurantes?.nome ?? '', impressora, nomeSistema: disp.nome_sistema, computador: disp.impressao_agentes.nome,
    larguraMm: disp.largura_mm, larguraPontos: disp.largura_pontos, deslocamentoPontos: disp.deslocamento_pontos ?? 0,
  }, op.nome)
  const { data: novo, error } = await admin
    .from('impressao_trabalhos')
    .insert({
      restaurante_id: op.restauranteId, tipo: 'teste_impressora', dispositivo_id: disp.id, agente_id: disp.agente_id, snapshot, chave,
      criado_por: op.userId, criado_por_nome: op.nome, expira_em: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    .select('id, estado')
    .single()
  if (error) {
    // Dois cliques ao mesmo tempo: a chave é única por loja — o outro já criou.
    if (error.code === '23505') {
      const outro = await existente()
      if (outro) return { ok: true, valor: { ...outro, idempotente: true } }
    }
    console.error('[impressao] recibo de teste:', error.message)
    return falha('Não foi possível enviar o Recibo/Extrato de teste.', 500, 'erro')
  }
  await auditar(admin, op, 'impressao.recibo_teste', 'impressao_dispositivo', disp.id, { trabalho_id: novo.id, impressora, resumo: impressora })
  return { ok: true, valor: { id: novo.id as string, estado: novo.estado as string, idempotente: false } }
}

// ─── pré-conta ──────────────────────────────────────────────────────────────

export async function criarPreConta(admin: SupabaseClient, op: Operador, comandaId: string, chave: string, reimpressao: boolean) {
  const { data: loja } = await admin.from('restaurantes').select('impressao_beta_modo').eq('id', op.restauranteId).maybeSingle()
  if (loja && loja.impressao_beta_modo === 'teste') {
    return falha('O Assistente Beta está em "Somente teste": o Recibo/Extrato ainda não sai por ele. Mude o modo no menu Impressão.', 409, 'modo_somente_teste')
  }
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

export async function descobrir(admin: SupabaseClient, agenteId: string, nomes: unknown, diagnosticos?: unknown) {
  if (!Array.isArray(nomes) || !nomes.every((n) => typeof n === 'string')) return falha('Lista de impressoras inválida.')
  const r = await rpc<number>(admin, 'impressao_descobrir', { p_agente: agenteId, p_nomes: (nomes as string[]).slice(0, 60) })
  // Beta (0.2+): o que o Windows informa de cada impressora (DPI, papel, área imprimível).
  // Só guarda campos conhecidos, com tamanho limitado — nunca caminhos, tokens ou texto livre grande.
  if (r.ok && diagnosticos && typeof diagnosticos === 'object' && !Array.isArray(diagnosticos)) {
    for (const [nome, d] of Object.entries(diagnosticos as Record<string, unknown>).slice(0, 60)) {
      const limpo = sanearDiagnostico(d)
      if (!limpo) continue
      await admin.from('impressao_dispositivos').update({ diagnostico: limpo }).eq('agente_id', agenteId).eq('nome_sistema', nome)
    }
  }
  return r
}

const CAMPOS_DIAGNOSTICO = ['driver', 'porta', 'dpiX', 'dpiY', 'papelLarguraMm', 'papelAlturaMm', 'papelNome', 'areaImprimivelLarguraMm', 'margemEsquerdaMm', 'margemDireitaMm', 'pontosImprimiveis', 'online', 'status', 'coletadoEm'] as const

/** Diagnóstico do driver vindo do Assistente: só campos conhecidos, número ou texto curto. */
export function sanearDiagnostico(d: unknown): Record<string, string | number | boolean> | null {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null
  const o: Record<string, string | number | boolean> = {}
  for (const k of CAMPOS_DIAGNOSTICO) {
    const v = (d as Record<string, unknown>)[k]
    if (typeof v === 'number' && Number.isFinite(v)) o[k] = Math.round(v * 100) / 100
    else if (typeof v === 'boolean') o[k] = v
    else if (typeof v === 'string' && v.trim()) o[k] = v.trim().slice(0, 80)
  }
  return Object.keys(o).length ? o : null
}

export interface TrabalhoAgente {
  id: string
  tipo: 'pre_conta' | 'teste_impressora'
  via: number
  snapshot: Record<string, unknown>
  nomeSistema: string
  larguraMm: 58 | 80
  /** Perfil de calibração (0100): nulo = padrão. */
  larguraPontos: number | null
  deslocamentoPontos: number
  dispositivoId: string
  segundosRestantes: number
  tentativas: number
}

export async function reservarTrabalhos(admin: SupabaseClient, agenteId: string): Promise<Resultado<TrabalhoAgente[]>> {
  const r = await rpc<Record<string, unknown>[]>(admin, 'impressao_trabalhos_reservar', { p_agente: agenteId, p_limite: 10 })
  if (!r.ok) return r
  const ids = [...new Set((r.valor ?? []).map((t) => t.dispositivo_id as string))]
  const { data: perfis } = ids.length
    ? await admin.from('impressao_dispositivos').select('id, largura_pontos, deslocamento_pontos').in('id', ids)
    : { data: [] as { id: string; largura_pontos: number | null; deslocamento_pontos: number }[] }
  const perfil = new Map(((perfis ?? []) as { id: string; largura_pontos: number | null; deslocamento_pontos: number }[]).map((p) => [p.id, p]))
  return {
    ok: true,
    valor: (r.valor ?? []).map((t) => ({
      id: t.id as string,
      tipo: t.tipo as TrabalhoAgente['tipo'],
      via: t.via as number,
      snapshot: t.snapshot as Record<string, unknown>,
      nomeSistema: t.nome_sistema as string,
      larguraMm: t.largura_mm as 58 | 80,
      larguraPontos: perfil.get(t.dispositivo_id as string)?.largura_pontos ?? null,
      deslocamentoPontos: perfil.get(t.dispositivo_id as string)?.deslocamento_pontos ?? 0,
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
  larguraPontos: number | null
  deslocamentoPontos: number
  /** Quando a cozinha passou para o Beta (0100) — corte contra impressão em dobro. */
  transferidaEm: string | null
}

/** Se a loja roteia a cozinha por função e para qual impressora/computador. */
export async function destinoCozinha(admin: SupabaseClient, restauranteId: string): Promise<DestinoCozinha> {
  const [{ data: loja }, { data: f }] = await Promise.all([
    admin.from('restaurantes').select('impressao_cozinha_por_funcao, impressao_cozinha_transferida_em').eq('id', restauranteId).maybeSingle(),
    admin
      .from('impressao_funcoes')
      .select('impressao_dispositivos ( agente_id, nome_sistema, largura_mm, tamanho_fonte, copias, largura_pontos, deslocamento_pontos )')
      .eq('restaurante_id', restauranteId)
      .eq('funcao', 'cozinha')
      .maybeSingle(),
  ])
  const d = (f as unknown as { impressao_dispositivos: { agente_id: string; nome_sistema: string; largura_mm: 58 | 80; tamanho_fonte: string; copias: number; largura_pontos: number | null; deslocamento_pontos: number } | null } | null)
    ?.impressao_dispositivos
  return {
    ativo: loja?.impressao_cozinha_por_funcao === true && !!d,
    agenteId: d?.agente_id ?? null,
    nomeSistema: d?.nome_sistema ?? null,
    larguraMm: d?.largura_mm ?? 80,
    tamanhoFonte: d?.tamanho_fonte ?? 'grande',
    copias: d?.copias ?? 1,
    larguraPontos: d?.largura_pontos ?? null,
    deslocamentoPontos: d?.deslocamento_pontos ?? 0,
    transferidaEm: (loja?.impressao_cozinha_transferida_em as string | null) ?? null,
  }
}

export type ModoBeta = 'teste' | 'caixa' | 'cozinha_caixa'
export const MODOS_BETA: ModoBeta[] = ['teste', 'caixa', 'cozinha_caixa']

/**
 * Troca o que o Assistente Beta imprime (0100), numa função do banco que trava a loja:
 *   · teste         → só página de teste e calibração (volta ao antigo a qualquer momento);
 *   · caixa         → Recibo/Extrato; a cozinha continua no Assistente antigo;
 *   · cozinha_caixa → o Beta assume a ficha da cozinha. Exige impressora de Cozinha num
 *                     computador pareado e online. A troca grava o horário: pedidos de
 *                     antes dela ficam com o Assistente antigo por uma janela curta.
 */
export async function definirModo(admin: SupabaseClient, op: Operador, modo: unknown): Promise<Resultado<{ modo: ModoBeta; idempotente: boolean }>> {
  if (!MODOS_BETA.includes(modo as ModoBeta)) return falha(MENSAGENS.modo_invalido, 400, 'modo_invalido')
  return rpc<{ modo: ModoBeta; idempotente: boolean }>(admin, 'impressao_modo_definir', {
    p_restaurante: op.restauranteId, p_modo: modo, p_ator: op.userId, p_ator_nome: op.nome,
  })
}

/** Compatibilidade com a rota antiga (liga/desliga): ligar = "Cozinha e Caixa", desligar = "Somente Caixa". */
export async function definirCozinhaPorFuncao(admin: SupabaseClient, op: Operador, ativo: boolean): Promise<Resultado<null>> {
  const r = await definirModo(admin, op, ativo ? 'cozinha_caixa' : 'caixa')
  return r.ok ? { ok: true, valor: null } : r
}
