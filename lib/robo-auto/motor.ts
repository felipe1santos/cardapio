/**
 * Robô de autoatendimento — ligação com o banco e a fila (servidor). Chamado pelo webhook (lib/mensageria/entrada.ts)
 * só nas lojas com `autoatendimento_ativo`. Ordem: whatsapp_auto_entrada (trava) → decidir (puro) → dados → responder
 * (puro) → whatsapp_auto_aplicar (silêncio ANTES de enfileirar, para a resposta do atendente não ser cancelada) → fila.
 * Nenhuma API paga: só banco próprio e a Evolution (servidor próprio).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { enfileirar } from '@/lib/mensageria/fila'
import { pedidoDeDescadastro, textoDescadastro, variantesTelefone, linkDoRobo, type DadosLoja } from '@/lib/mensageria/robo'
import type { MensagemRecebida } from '@/lib/mensageria/provedor'
import { normalizarForaDaLista } from '@/lib/frete'
import { composeEndereco } from '@/lib/endereco'
import { rotuloStatusPedidoCliente } from '@/lib/status-pedido-cliente'
import { lojaEstaAberta, textoProximaAbertura, turnosDoDia, type HorarioFuncionamento, type StatusLoja } from '@/lib/timezone'
import { classificar, ASSUNTOS, type Assunto, type PalavrasExtras } from './classificador'
import { decidir, type EstadoAuto } from './decisao'
import { responder, type DadosLojaAuto, type PedidoAuto } from './respostas'
import type { ChaveTexto } from './textos'

export interface ConfigAuto {
  restaurante_id: string
  autoatendimento_ativo: boolean
  auto_assuntos_desligados: string[] | null
  auto_textos: Record<string, string> | null
  auto_palavras: Record<string, string[]> | null
  auto_tempo_entrega: string | null
  pix_chave: string | null
  pix_chave_tipo: string | null
}

export const COLUNAS_CONFIG_AUTO =
  'restaurante_id, autoatendimento_ativo, auto_assuntos_desligados, auto_textos, auto_palavras, auto_tempo_entrega, pix_chave, pix_chave_tipo'

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const STATUS_ABERTOS = ['recebido', 'preparando', 'pronto', 'em_rota', 'aguardando_pagamento']

export function assuntosDesligados(cfg: Pick<ConfigAuto, 'auto_assuntos_desligados'>): Set<Assunto> {
  return new Set((cfg.auto_assuntos_desligados ?? []).filter((a): a is Assunto => (ASSUNTOS as string[]).includes(a)))
}

export function palavrasExtras(cfg: Pick<ConfigAuto, 'auto_palavras'>): PalavrasExtras {
  const r: PalavrasExtras = {}
  for (const a of ASSUNTOS) {
    const l = cfg.auto_palavras?.[a]
    if (Array.isArray(l)) r[a] = l.filter((x) => typeof x === 'string' && x.trim()).slice(0, 100)
  }
  return r
}

/** Tudo o que o robô sabe da loja, de uma vez (o simulador usa o mesmo). */
export async function carregarLojaAuto(admin: SupabaseClient, restauranteId: string, cfg: ConfigAuto): Promise<DadosLojaAuto> {
  const [{ data: loja }, { data: bairros }, { count: raios }] = await Promise.all([
    admin
      .from('restaurantes')
      .select('nome, slug, status_loja, horario_funcionamento, taxa_entrega_padrao, frete_fora_da_lista, aceita_entrega, aceita_retirada, endereco, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado, pix_online_ativo')
      .eq('id', restauranteId)
      .maybeSingle(),
    admin.from('taxas_entrega_bairro').select('bairro, taxa').eq('restaurante_id', restauranteId),
    admin.from('taxas_entrega_raio').select('id', { count: 'exact', head: true }).eq('restaurante_id', restauranteId),
  ])
  const l = (loja ?? {}) as Record<string, unknown>
  const grade = (l.horario_funcionamento as HorarioFuncionamento | null) ?? null
  const h = { statusLoja: ((l.status_loja as StatusLoja | null) ?? 'automatico'), horarioFuncionamento: grade }
  const aberta = lojaEstaAberta(h)
  const linhas: string[] = []
  if (grade) {
    for (let d = 0; d < 7; d++) {
      const t = turnosDoDia(grade, d)
      linhas.push(`- ${DIAS[d]}: ${t.length ? t.map((x) => `${x.abre}–${x.fecha}`).join(' e ') : 'fechado'}`)
    }
  }
  const prox = aberta ? null : textoProximaAbertura(h)
  const partes = {
    rua: String(l.endereco_rua ?? ''), numero: String(l.endereco_numero ?? ''), complemento: String(l.endereco_complemento ?? ''),
    bairro: String(l.endereco_bairro ?? ''), cidade: String(l.endereco_cidade ?? ''), estado: String(l.endereco_estado ?? ''),
  }
  const endereco = composeEndereco(partes) || (String(l.endereco ?? '').trim() || null)
  return {
    nome: String(l.nome ?? ''),
    link: linkDoRobo(String(l.slug ?? '')),
    aberta,
    proximaAbertura: prox ? `A loja ${prox}` : null,
    gradeHorario: linhas.length ? linhas.join('\n') : null,
    endereco,
    aceitaEntrega: l.aceita_entrega !== false,
    aceitaRetirada: l.aceita_retirada === true,
    bairros: ((bairros ?? []) as { bairro: string; taxa: number }[]).map((b) => ({ bairro: String(b.bairro), taxa: Number(b.taxa) })),
    taxaPadrao: Number(l.taxa_entrega_padrao) || 0,
    foraDaLista: normalizarForaDaLista(l.frete_fora_da_lista),
    temRaio: (raios ?? 0) > 0,
    tempoEntrega: cfg.auto_tempo_entrega?.trim() || null,
    pixChave: cfg.pix_chave?.trim() || null,
    pixTipo: cfg.pix_chave_tipo ?? null,
    pixOnline: l.pix_online_ativo === true,
    textos: (cfg.auto_textos ?? null) as Partial<Record<ChaveTexto, string>> | null,
    assuntosDesligados: assuntosDesligados(cfg),
  }
}

async function montarPedido(admin: SupabaseClient, p: { id: string; numero: number; status: string; tipo: string; total: number }, semEntregador: boolean): Promise<PedidoAuto> {
  const { data: itens } = await admin.from('pedido_itens').select('nome, quantidade, cancelado_em').eq('pedido_id', p.id)
  return {
    numero: p.numero,
    status: p.status,
    rotuloStatus: rotuloStatusPedidoCliente({ status: p.status, saidaSemConfirmacao: semEntregador && p.tipo === 'entrega' }),
    total: Number(p.total) || 0,
    itens: ((itens ?? []) as { nome: string; quantidade: number; cancelado_em: string | null }[])
      .filter((i) => !i.cancelado_em)
      .map((i) => ({ quantidade: Number(i.quantidade) || 1, nome: String(i.nome) })),
  }
}

/** Pedidos em aberto do telefone (últimas 36 h). */
export async function pedidosAbertosDoTelefone(admin: SupabaseClient, restauranteId: string, telefone: string, semEntregador: boolean): Promise<PedidoAuto[]> {
  const variantes = variantesTelefone(telefone)
  if (!variantes.length) return []
  const { data } = await admin
    .from('pedidos')
    .select('id, numero, status, tipo, total')
    .eq('restaurante_id', restauranteId)
    .in('cliente_telefone', variantes)
    .in('status', STATUS_ABERTOS)
    .gte('criado_em', new Date(Date.now() - 36 * 3600_000).toISOString())
    .order('criado_em', { ascending: false })
    .limit(5)
  return Promise.all(((data ?? []) as { id: string; numero: number; status: string; tipo: string; total: number }[]).map((p) => montarPedido(admin, p, semEntregador)))
}

/** Pedido pelo número — só se for deste telefone (nunca mostra pedido de outra pessoa). */
export async function pedidoPorNumero(admin: SupabaseClient, restauranteId: string, telefone: string, numero: number, semEntregador: boolean): Promise<PedidoAuto | null> {
  const variantes = variantesTelefone(telefone)
  if (!variantes.length || !Number.isFinite(numero)) return null
  const { data } = await admin
    .from('pedidos')
    .select('id, numero, status, tipo, total')
    .eq('restaurante_id', restauranteId)
    .eq('numero', numero)
    .in('cliente_telefone', variantes)
    .order('criado_em', { ascending: false })
    .limit(1)
  const p = ((data ?? []) as { id: string; numero: number; status: string; tipo: string; total: number }[])[0]
  return p ? montarPedido(admin, p, semEntregador) : null
}

async function registrarNaoEntendida(admin: SupabaseClient, restauranteId: string, normalizado: string, exemplo: string) {
  const texto = normalizado.slice(0, 300)
  if (!texto) return
  try {
    const { data } = await admin.from('whatsapp_auto_nao_entendidas').select('id, vezes').eq('restaurante_id', restauranteId).eq('texto', texto).maybeSingle()
    if (data) {
      await admin.from('whatsapp_auto_nao_entendidas').update({ vezes: Number(data.vezes) + 1, ultima_em: new Date().toISOString() }).eq('id', data.id)
    } else {
      await admin.from('whatsapp_auto_nao_entendidas').insert({ restaurante_id: restauranteId, texto, exemplo: exemplo.slice(0, 300) })
    }
  } catch {
    /* registro auxiliar: nunca derruba a resposta */
  }
}

export interface ResultadoAuto {
  respostas: number
  motivo: string
}

/** Uma mensagem (já filtrada: não é grupo/difusão/número da loja/eco nosso) no modo autoatendimento. */
export async function processarMensagemAuto(
  admin: SupabaseClient,
  m: MensagemRecebida,
  ctx: { restauranteId: string; cfg: ConfigAuto; lojaV1: DadosLoja; semEntregador: boolean },
): Promise<ResultadoAuto> {
  const { restauranteId, cfg } = ctx
  const telefone = m.telefone ?? '' // o webhook só chama com número (filtra sem_numero antes)
  const extras = palavrasExtras(cfg)
  const c = m.deMim ? null : m.tipo === 'texto' ? classificar(m.texto, extras) : null
  const intencao = m.deMim ? 'outro' : c ? c.intencao : 'midia'
  const { data: ent, error } = await admin.rpc('whatsapp_auto_entrada', {
    p_restaurante: restauranteId,
    p_telefone: telefone,
    p_wa_id: m.waId,
    p_de_mim: m.deMim,
    p_tipo: m.tipo,
    p_texto: m.texto,
    p_instante: m.instante,
    p_intencao: intencao,
    p_nome: m.deMim ? null : m.nome,
  })
  if (error) throw error
  const e = ent as {
    duplicada: boolean; sem_envio?: boolean; conversa_id: string; mensagem_id?: string; acao: 'nada' | 'decidir'; protecao?: boolean; limite?: boolean
    silenciada?: boolean; reativada?: boolean; auto_estado?: EstadoAuto['autoEstado']; auto_estado_em?: string | null; auto_nao_entendeu?: number
    auto_saudacao_em?: string | null; nome?: string | null; auto_audio_em?: string | null; auto_versao?: number
  }
  if (e.duplicada && !(e.sem_envio && e.mensagem_id)) return { respostas: 0, motivo: 'duplicada' }
  if (m.deMim) return { respostas: 0, motivo: 'loja_respondeu' }

  let respostas = 0
  const fila = async (texto: string, ordem: number, tipo: 'robo' | 'descadastro' = 'robo') => {
    const envio = await enfileirar(admin, {
      restauranteId,
      chave: `${tipo === 'robo' ? 'resposta' : 'descadastro'}:${e.mensagem_id}${ordem > 0 ? `:${ordem}` : ''}`,
      tipo,
      telefone,
      texto,
      conversaId: e.conversa_id,
      // Só a 1ª mensagem leva a origem (é única por mensagem do cliente).
      origemMensagemId: ordem === 0 ? e.mensagem_id : null,
    })
    if (envio?.novo) respostas++
  }

  // SAIR / VOLTAR das campanhas (0112) continua valendo; no modo novo também para/reativa o robô na conversa.
  const descadastro = pedidoDeDescadastro(m.tipo, m.texto)
  if (descadastro) {
    const { error: errDesc } = await admin.rpc('whatsapp_descadastrar', { p_restaurante: restauranteId, p_telefone: telefone, p_sair: descadastro === 'sair', p_origem: 'cliente' })
    if (errDesc) throw errDesc
    if (descadastro === 'sair' && e.acao === 'decidir') {
      await admin.rpc('whatsapp_auto_aplicar_v2', {
        p_restaurante: restauranteId, p_conversa: e.conversa_id, p_mensagem: e.mensagem_id, p_acao: 'parar',
        p_estado: null, p_estado_em: null, p_nao_entendeu: 0, p_saudacao_em: e.auto_saudacao_em ?? null, p_silenciar: 'parar',
        p_audio_em: e.auto_audio_em ?? null, p_versao: e.auto_versao ?? 0,
      })
    }
    await fila(textoDescadastro(ctx.lojaV1, descadastro === 'sair'), 0, 'descadastro')
    return { respostas, motivo: descadastro === 'sair' ? 'descadastro' : 'recadastro' }
  }

  if (e.acao !== 'decidir') return { respostas: 0, motivo: e.protecao ? 'protecao_loop' : e.limite ? 'limite' : e.silenciada ? 'silenciada' : 'nada' }

  const loja = await carregarLojaAuto(admin, restauranteId, cfg)
  if (e.reativada) {
    await fila('*🔔 Pronto!* O atendimento automático voltou. Digite *oi* para ver as opções.', 0)
    return { respostas, motivo: 'reativada' }
  }

  // Mídia (11/10): a decisão trata pelo tipo — foto/vídeo/documento não respondem, áudio avisa 1× a cada 6 h.
  const classificacao = c ?? { intencao: 'outro' as const, assunto: 'outro' as const, porNumero: false, normalizado: '' }
  const estado: EstadoAuto = {
    autoEstado: e.auto_estado ?? null,
    autoEstadoEm: e.auto_estado_em ?? null,
    naoEntendeu: e.auto_nao_entendeu ?? 0,
    saudacaoEm: e.auto_saudacao_em ?? null,
    audioEm: e.auto_audio_em ?? null,
  }
  const agora = new Date()
  const d = decidir({ classificacao, texto: m.texto ?? '', estado, agora, assuntosDesligados: loja.assuntosDesligados, tipo: m.tipo })
  if (d.acao === 'nada') return { respostas: 0, motivo: m.tipo === 'texto' ? 'nada' : 'midia_sem_resposta' }

  let pedido: PedidoAuto | null = null
  let abertos = 0
  if (d.acao === 'status') {
    const lista = await pedidosAbertosDoTelefone(admin, restauranteId, telefone, ctx.semEntregador)
    abertos = lista.length
    pedido = abertos === 1 ? lista[0] : null
  } else if (d.acao === 'status_numero' && d.numeroPedido) {
    pedido = await pedidoPorNumero(admin, restauranteId, telefone, d.numeroPedido, ctx.semEntregador)
  }
  const r = responder(d, loja, { agora, nomeCliente: e.nome, pedido, abertos })
  const novo = { ...d.estado }
  if (r.autoEstado !== undefined) {
    novo.autoEstado = r.autoEstado
    novo.autoEstadoEm = r.autoEstado ? agora.toISOString() : null
  }
  const { data: aplicou, error: errAp } = await admin.rpc('whatsapp_auto_aplicar_v2', {
    p_restaurante: restauranteId, p_conversa: e.conversa_id, p_mensagem: e.mensagem_id, p_acao: d.acao,
    p_estado: novo.autoEstado, p_estado_em: novo.autoEstadoEm, p_nao_entendeu: novo.naoEntendeu, p_saudacao_em: novo.saudacaoEm,
    p_silenciar: d.silenciar ?? null, p_audio_em: novo.audioEm ?? null, p_versao: e.auto_versao ?? 0,
  })
  if (errAp) throw errAp
  // Outra mensagem da mesma conversa (ex.: foto do mesmo álbum) decidiu antes: esta não responde (nada em dobro).
  if (aplicou === false) return { respostas: 0, motivo: 'concorrencia' }
  if (d.naoEntendida && c) await registrarNaoEntendida(admin, restauranteId, c.normalizado, m.texto ?? '')
  for (let i = 0; i < r.mensagens.length; i++) await fila(r.mensagens[i], i)
  return { respostas, motivo: d.acao }
}
