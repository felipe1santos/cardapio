/**
 * Webhook de entrada do robô: o que fazer com cada mensagem que chegou.
 *
 * A LOJA vem só do segredo da URL (whatsapp_robo_config.webhook_segredo). Nada do corpo
 * — instância, número, texto — escolhe a loja; a instância do corpo só serve para recusar
 * um evento que não bate com a loja do segredo.
 *
 * Nunca responde: grupo, status/broadcast/canal, mensagem sem número identificável, o
 * próprio número da loja, e mensagens da loja (fromMe). Mensagem da loja escrita à mão no
 * celular silencia a conversa; a que o próprio robô (ou a Menuzia: atendente, aviso, disparo) mandou (id do provedor ou mesmo texto
 * há menos de 2 min) é ignorada.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { provedorAtual } from './provedor'
import { enfileirar, processarFila } from './fila'
import { classificarIntencao, numeroPermitido, palavraAmbiguaDeSair, pedidoDeDescadastro, roboLiberadoNoServidor, textoDescadastro, variantesTelefone, type Acao, type DadosLoja } from './robo'
import { statusDoProvedor } from './campanhas'
import { ehSaidaNossa } from './historico'
import { COLUNAS_CONFIG_AUTO, processarMensagemAuto, type ConfigAuto } from '@/lib/robo-auto/motor'

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

/**
 * A mensagem que a loja "mandou" é uma campanha? Pelo id do provedor ou, se o webhook
 * chegar antes de o id ser gravado, por um envio de campanha para o mesmo número em
 * andamento ou concluído há menos de 2 minutos.
 */
async function ecoDeCampanha(admin: SupabaseClient, restauranteId: string, waId: string, telefone: string): Promise<boolean> {
  const { data: porId } = await admin.from('campanha_envios').select('id').eq('restaurante_id', restauranteId).eq('id_externo', waId).limit(1)
  if ((porId ?? []).length > 0) return true
  const variantes = variantesTelefone(telefone)
  if (!variantes.length) return false
  const { data: recente } = await admin
    .from('campanha_envios')
    .select('id')
    .eq('restaurante_id', restauranteId)
    .in('telefone', variantes)
    .or(`status.eq.reservado,enviado_em.gte.${new Date(Date.now() - 2 * 60_000).toISOString()}`)
    .limit(1)
  return (recente ?? []).length > 0
}

/** Metadado do webhook (contagens, sem texto nem número). Nunca derruba a entrada. */
async function registrarEvento(admin: SupabaseClient, restauranteId: string, r: ResumoInterno) {
  try {
    await admin.from('whatsapp_eventos').insert({
      restaurante_id: restauranteId,
      tipo: 'webhook',
      resultado: { processadas: r.processadas, respostas: r.respostas, ignoradas: r.ignoradas, ...(r.soStatus ? { so_status: true } : {}) },
    })
  } catch {
    /* evento é só registro */
  }
}

export async function processarEntrada(admin: SupabaseClient, segredo: string, corpo: unknown): Promise<ResumoEntrada> {
  const r = await processarEntradaInterna(admin, segredo, corpo)
  if (r.restauranteId) {
    // Entrega/leitura chegam para TODA mensagem que o número da loja manda (avisos de
    // pedido, conversas pessoais). Só status de mensagem que não é campanha não vira
    // registro — a não ser um marcador por hora, que prova que o provedor está mandando.
    if (!r.soStatus || r.statusDeCampanha || !(await marcadorDeStatusRecente(admin, r.restauranteId))) {
      await registrarEvento(admin, r.restauranteId, r)
    }
  }
  delete r.restauranteId
  delete r.soStatus
  delete r.statusDeCampanha
  return r
}

async function marcadorDeStatusRecente(admin: SupabaseClient, restauranteId: string): Promise<boolean> {
  const { data } = await admin
    .from('whatsapp_eventos')
    .select('id')
    .eq('restaurante_id', restauranteId)
    .eq('tipo', 'webhook')
    .gte('criado_em', new Date(Date.now() - 3600_000).toISOString())
    .contains('resultado', { so_status: true })
    .limit(1)
  return (data ?? []).length > 0
}

type ResumoInterno = ResumoEntrada & { restauranteId?: string; soStatus?: boolean; statusDeCampanha?: boolean }

async function processarEntradaInterna(admin: SupabaseClient, segredo: string, corpo: unknown): Promise<ResumoInterno> {
  const r: ResumoInterno = { status: 200, processadas: 0, ignoradas: {}, respostas: 0 }
  if (!SEGREDO_VALIDO.test(segredo)) return { ...r, status: 404 }

  const { data: cfg } = await admin
    .from('whatsapp_robo_config')
    .select(`boas_vindas, ${COLUNAS_CONFIG_AUTO}`)
    .eq('webhook_segredo', segredo)
    .maybeSingle()
  if (!cfg) return { ...r, status: 404 }

  const { data: lojaRow } = await admin
    .from('restaurantes')
    .select('id, nome, slug, evolution_instance, entrega_sem_entregador, usa_logistica')
    .eq('id', cfg.restaurante_id)
    .maybeSingle()
  if (!lojaRow) return { ...r, status: 404 }
  r.restauranteId = lojaRow.id as string

  const evento = provedorAtual().interpretarWebhook(corpo)
  if (evento.instancia && lojaRow.evolution_instance && evento.instancia !== lojaRow.evolution_instance) {
    contar(r, 'instancia_de_outra_loja')
    return r
  }
  // Entrega/leitura das campanhas: independe do robô (é métrica, não resposta).
  for (const a of evento.atualizacoes) {
    const status = statusDoProvedor(a.status)
    if (!status) { contar(r, 'status_sem_interesse'); continue }
    const { data: res, error } = await admin.rpc('campanha_registrar_status', {
      p_restaurante: lojaRow.id, p_id_externo: a.waId, p_status: status, p_em: new Date().toISOString(),
    })
    if (error) throw error
    contar(r, res === 'ok' ? `campanha_${status}` : res === 'repetido' ? 'campanha_status_repetido' : 'status_de_outra_mensagem')
    if (res === 'ok' || res === 'repetido') r.statusDeCampanha = true
  }
  if (evento.atualizacoes.length && !evento.mensagens.length) {
    r.soStatus = true
    return r
  }
  // Servidor não liberado: nada é gravado (nem a mensagem), só o metadado do webhook.
  if (!roboLiberadoNoServidor()) {
    contar(r, 'robo_nao_liberado_no_servidor')
    return r
  }
  // Robô único (0182): só o robô de atendimento (0177) responde. O robô antigo (v1) não responde mais em loja nenhuma;
  // com o robô desligado a mensagem é gravada para a central e a conversa entra como atendimento humano.
  const auto = cfg.autoatendimento_ativo === true

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
      // Mensagem de campanha: o eco dela não é a loja assumindo a conversa.
      if (!proprio && (await ecoDeCampanha(admin, restauranteId, m.waId, m.telefone))) { contar(r, 'enviada_pela_campanha'); continue }
      if (proprio) { contar(r, 'enviada_pelo_robo'); continue }
      // Atendente, aviso de pedido, fidelidade, código do checkout ou disparo que a Menuzia
      // mandou (0107): o eco não é a loja respondendo pelo celular.
      if (await ehSaidaNossa(admin, restauranteId, m.telefone, m.waId, m.texto)) { contar(r, 'enviada_pela_menuzia'); continue }
    }

    if (auto) {
      const semEntregadorAuto = lojaRow.entrega_sem_entregador === true || lojaRow.usa_logistica === false
      const ra = await processarMensagemAuto(admin, m, { restauranteId, cfg: cfg as unknown as ConfigAuto, lojaV1: loja, semEntregador: semEntregadorAuto, instancia: (lojaRow.evolution_instance as string | null) ?? null })
      if (ra.motivo === 'duplicada') contar(r, 'duplicada')
      else { r.processadas++; contar(r, `auto_${ra.motivo}`) }
      r.respostas += ra.respostas
      continue
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
      p_robo_ativo: false,
    })
    if (error) throw error
    const d = dec as { duplicada: boolean; sem_envio?: boolean; conversa_id: string; mensagem_id?: string; acao: Acao; boas_vindas?: boolean; protecao?: boolean }
    // Reentrega do webhook. Só segue quando a 1ª vez registrou a mensagem mas nada entrou
    // na fila (0116 devolve a decisão gravada): antes o cliente ficava sem resposta (B11).
    // A chave resposta:<mensagem> garante que, se a 1ª vez enfileirou, não duplica.
    if (d.duplicada && !(d.sem_envio && d.mensagem_id)) { contar(r, 'duplicada'); continue }
    if (d.duplicada) contar(r, 'duplicada_sem_resposta')
    else r.processadas++
    if (m.deMim) { contar(r, 'loja_respondeu'); continue }

    // SAIR / VOLTAR (0112): vale com o robô ligado OU desligado — é direito do cliente
    // parar de receber campanhas. Avisos de pedido não mudam. A confirmação sai pela fila.
    // "cancelar" sozinho só é SAIR para quem recebeu disparo nos últimos 7 dias (12/10); sem isso é do pedido.
    const recebeuDisparo = palavraAmbiguaDeSair(m.tipo, m.texto) ? await recebeuDisparoRecente(admin, restauranteId, m.telefone) : false
    const descadastro = pedidoDeDescadastro(m.tipo, m.texto, { recebeuDisparo })
    if (descadastro) {
      // Confirma UMA vez: SAIR de quem já saiu (ou VOLTAR de quem já está) não gera outra resposta.
      const jaFora = await jaDescadastrado(admin, restauranteId, m.telefone)
      if (jaFora === (descadastro === 'sair')) { contar(r, 'descadastro_repetido'); continue }
      const { error: errDesc } = await admin.rpc('whatsapp_descadastrar', { p_restaurante: restauranteId, p_telefone: m.telefone, p_sair: descadastro === 'sair', p_origem: 'cliente' })
      if (errDesc) throw errDesc
      const envio = await enfileirar(admin, {
        restauranteId,
        chave: `descadastro:${d.mensagem_id}`,
        tipo: 'descadastro',
        telefone: m.telefone,
        texto: textoDescadastro(loja, descadastro === 'sair'),
        conversaId: d.conversa_id,
        origemMensagemId: d.mensagem_id,
      })
      if (envio?.novo) r.respostas++
      contar(r, descadastro === 'sair' ? 'descadastro' : 'recadastro')
      continue
    }
    contar(r, 'robo_desligado')
  }

  if (r.respostas > 0) await processarFila(admin, { restauranteId, limite: 10 })
  return r
}

/** Recebeu disparo (campanha enviada) desta loja nos últimos 7 dias? Mesma chave de telefone do descadastro. */
async function recebeuDisparoRecente(admin: SupabaseClient, restauranteId: string, telefone: string): Promise<boolean> {
  const { data } = await admin.rpc('whatsapp_recebeu_disparo', { p_restaurante: restauranteId, p_telefone: telefone, p_dias: 7 })
  return data === true
}

async function jaDescadastrado(admin: SupabaseClient, restauranteId: string, telefone: string): Promise<boolean> {
  const { data } = await admin.rpc('whatsapp_esta_descadastrado', { p_restaurante: restauranteId, p_telefone: telefone })
  return data === true
}
