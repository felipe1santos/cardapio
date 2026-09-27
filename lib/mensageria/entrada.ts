/**
 * Webhook de entrada do robô: o que fazer com cada mensagem que chegou.
 *
 * A LOJA vem só do segredo da URL (whatsapp_robo_config.webhook_segredo). Nada do corpo
 * — instância, número, texto — escolhe a loja; a instância do corpo só serve para recusar
 * um evento que não bate com a loja do segredo.
 *
 * Nunca responde: grupo, status/broadcast/canal, mensagem sem número identificável, o
 * próprio número da loja, e mensagens da loja (fromMe). Mensagem da loja escrita à mão no
 * celular silencia a conversa; a que o próprio robô mandou (id do provedor ou mesmo texto
 * há menos de 2 min) é ignorada.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { provedorAtual } from './provedor'
import { enfileirar, processarFila } from './fila'
import {
  classificarIntencao, extrairBairro, numeroPermitido, roboLiberadoNoServidor, textoAtendente, textoBoasVindas, textoCardapio,
  textoHorario, textoPadrao, textoStatus, textoTaxa, variantesTelefone, type Acao, type DadosLoja, type FreteLoja,
} from './robo'
import { rotuloStatusPedidoCliente } from '@/lib/status-pedido-cliente'
import { normalizarForaDaLista } from '@/lib/frete'
import type { HorarioFuncionamento, StatusLoja } from '@/lib/timezone'

export const SEGREDO_VALIDO = /^[0-9a-f]{48}$/

export interface ResumoEntrada {
  status: number
  processadas: number
  ignoradas: Record<string, number>
  respostas: number
}

function contar(r: ResumoEntrada, motivo: string) {
  r.ignoradas[motivo] = (r.ignoradas[motivo] ?? 0) + 1
}

async function ultimoPedido(admin: SupabaseClient, restauranteId: string, telefone: string, semEntregador: boolean) {
  const variantes = variantesTelefone(telefone)
  if (!variantes.length) return null
  const { data } = await admin
    .from('pedidos')
    .select('numero, status, tipo, criado_em')
    .eq('restaurante_id', restauranteId)
    .in('cliente_telefone', variantes)
    .order('criado_em', { ascending: false })
    .limit(1)
  const p = (data ?? [])[0] as { numero: number; status: string; tipo: string; criado_em: string } | undefined
  if (!p) return null
  return { numero: p.numero, criadoEm: p.criado_em, rotulo: rotuloStatusPedidoCliente({ status: p.status, saidaSemConfirmacao: semEntregador && p.tipo === 'entrega' }) }
}

/** Taxas da loja para o robô: só bairros cadastrados; faixas por raio só como aviso. */
async function freteDaLoja(admin: SupabaseClient, restauranteId: string, loja: { taxa_entrega_padrao: unknown; frete_fora_da_lista: unknown }): Promise<FreteLoja> {
  const [{ data: bairros }, { count }] = await Promise.all([
    admin.from('taxas_entrega_bairro').select('bairro, taxa').eq('restaurante_id', restauranteId),
    admin.from('taxas_entrega_raio').select('id', { count: 'exact', head: true }).eq('restaurante_id', restauranteId),
  ])
  return {
    bairros: ((bairros ?? []) as { bairro: string; taxa: number }[]).map((b) => ({ bairro: String(b.bairro), taxa: Number(b.taxa) })),
    temRaio: (count ?? 0) > 0,
    taxaPadrao: Number(loja.taxa_entrega_padrao) || 0,
    foraDaLista: normalizarForaDaLista(loja.frete_fora_da_lista),
  }
}

/** Metadado do webhook (contagens, sem texto nem número). Nunca derruba a entrada. */
async function registrarEvento(admin: SupabaseClient, restauranteId: string, r: ResumoEntrada) {
  try {
    await admin.from('whatsapp_eventos').insert({
      restaurante_id: restauranteId,
      tipo: 'webhook',
      resultado: { processadas: r.processadas, respostas: r.respostas, ignoradas: r.ignoradas },
    })
  } catch {
    /* evento é só registro */
  }
}

export async function processarEntrada(admin: SupabaseClient, segredo: string, corpo: unknown): Promise<ResumoEntrada> {
  const r = await processarEntradaInterna(admin, segredo, corpo)
  if (r.restauranteId) await registrarEvento(admin, r.restauranteId, r)
  delete r.restauranteId
  return r
}

async function processarEntradaInterna(admin: SupabaseClient, segredo: string, corpo: unknown): Promise<ResumoEntrada & { restauranteId?: string }> {
  const r: ResumoEntrada & { restauranteId?: string } = { status: 200, processadas: 0, ignoradas: {}, respostas: 0 }
  if (!SEGREDO_VALIDO.test(segredo)) return { ...r, status: 404 }

  const { data: cfg } = await admin
    .from('whatsapp_robo_config')
    .select('restaurante_id, robo_ativo, boas_vindas')
    .eq('webhook_segredo', segredo)
    .maybeSingle()
  if (!cfg) return { ...r, status: 404 }

  const { data: lojaRow } = await admin
    .from('restaurantes')
    .select('id, nome, slug, evolution_instance, entrega_sem_entregador, usa_logistica, status_loja, horario_funcionamento, taxa_entrega_padrao, frete_fora_da_lista')
    .eq('id', cfg.restaurante_id)
    .maybeSingle()
  if (!lojaRow) return { ...r, status: 404 }
  r.restauranteId = lojaRow.id as string

  const evento = provedorAtual().interpretarWebhook(corpo)
  if (evento.instancia && lojaRow.evolution_instance && evento.instancia !== lojaRow.evolution_instance) {
    contar(r, 'instancia_de_outra_loja')
    return r
  }
  // Nada é gravado (nem a mensagem) com o robô desligado ou o servidor não liberado:
  // só o metadado do webhook, em registrarEvento.
  if (!roboLiberadoNoServidor()) {
    contar(r, 'robo_nao_liberado_no_servidor')
    return r
  }
  if (!cfg.robo_ativo) {
    contar(r, 'robo_desligado')
    return r
  }

  const loja: DadosLoja = { nome: lojaRow.nome as string, slug: lojaRow.slug as string, boasVindas: (cfg.boas_vindas as string | null) ?? null }
  const restauranteId = lojaRow.id as string

  for (const m of evento.mensagens) {
    if (m.grupo) { contar(r, 'grupo'); continue }
    if (m.difusao) { contar(r, 'difusao'); continue }
    if (!m.telefone) { contar(r, 'sem_numero'); continue }
    if (evento.numeroDaLoja && m.telefone === evento.numeroDaLoja) { contar(r, 'numero_da_loja'); continue }
    // Teste real controlado: só o(s) número(s) autorizado(s), nada é gravado dos outros.
    if (!numeroPermitido(m.telefone, process.env.WHATSAPP_ROBO_SOMENTE)) { contar(r, 'fora_da_lista_de_teste'); continue }

    if (m.deMim) {
      // O próprio robô (ou um aviso da fila) mandou esta mensagem? Então não é a loja
      // falando à mão: ignora. Pelo id do provedor ou, se o webhook chegar antes de o id
      // ser gravado, pelo mesmo texto para o mesmo número há menos de 2 minutos.
      const { data: nosso } = await admin.from('whatsapp_envios').select('id').eq('restaurante_id', restauranteId).eq('id_externo', m.waId).limit(1)
      let proprio = (nosso ?? []).length > 0
      if (!proprio && m.texto) {
        const { data: recente } = await admin
          .from('whatsapp_envios')
          .select('id')
          .eq('restaurante_id', restauranteId)
          .eq('telefone', m.telefone)
          .eq('texto', m.texto)
          .gte('criado_em', new Date(Date.now() - 2 * 60_000).toISOString())
          .limit(1)
        proprio = (recente ?? []).length > 0
      }
      if (proprio) { contar(r, 'enviada_pelo_robo'); continue }
    }

    const intencao = m.deMim ? 'outro' : classificarIntencao(m.tipo, m.texto)
    const { data: dec, error } = await admin.rpc('whatsapp_registrar_entrada', {
      p_restaurante: restauranteId,
      p_telefone: m.telefone,
      p_wa_id: m.waId,
      p_de_mim: m.deMim,
      p_tipo: m.tipo,
      p_texto: m.texto,
      p_instante: m.instante,
      p_intencao: intencao,
      p_nome: m.deMim ? null : m.nome,
    })
    if (error) throw error
    const d = dec as { duplicada: boolean; conversa_id: string; mensagem_id?: string; acao: Acao; boas_vindas?: boolean }
    if (d.duplicada) { contar(r, 'duplicada'); continue }
    r.processadas++
    if (m.deMim) { contar(r, 'loja_respondeu'); continue }
    if (d.acao === 'nada') { contar(r, 'silenciada_ou_repetida'); continue }

    const saudar = d.boas_vindas === true
    // Loja sem motoboy (sem Logística ou "entrega sem entregador") conclui na saída.
    const semEntregador = lojaRow.entrega_sem_entregador === true || lojaRow.usa_logistica === false
    let texto: string
    if (d.acao === 'boas_vindas') texto = textoBoasVindas(loja)
    else if (d.acao === 'status') texto = textoStatus(loja, await ultimoPedido(admin, restauranteId, m.telefone, semEntregador), saudar)
    else if (d.acao === 'atendente') texto = textoAtendente(loja)
    else if (d.acao === 'cardapio') texto = textoCardapio(loja, saudar)
    else if (d.acao === 'horario') {
      texto = textoHorario(loja, {
        statusLoja: ((lojaRow.status_loja as StatusLoja | null) ?? 'automatico'),
        horarioFuncionamento: (lojaRow.horario_funcionamento as HorarioFuncionamento | null) ?? null,
      }, saudar)
    } else if (d.acao === 'taxa') texto = textoTaxa(loja, extrairBairro(m.texto), await freteDaLoja(admin, restauranteId, lojaRow), saudar)
    else texto = textoPadrao(loja, m.tipo, saudar)

    const envio = await enfileirar(admin, {
      restauranteId,
      chave: `resposta:${d.mensagem_id}`,
      tipo: 'robo',
      telefone: m.telefone,
      texto,
      conversaId: d.conversa_id,
      origemMensagemId: d.mensagem_id,
    })
    if (envio?.novo) r.respostas++
  }

  if (r.respostas > 0) await processarFila(admin, { restauranteId, limite: 10 })
  return r
}
