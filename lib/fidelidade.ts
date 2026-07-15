// Motor de progresso de fidelidade — orquestra as regras puras de lib/fidelidade-regras.ts
// com a camada de dados de lib/queries/fidelidade.ts e o envio de WhatsApp de lib/whatsapp.ts.
//
// Chamado (fire-and-forget) nos 3 caminhos que marcam um pedido como `entregue`: portal do
// entregador, cozinha (retirada) e o endpoint genérico de notificação (usado pelo Kanban e
// pela Logística, que fazem a transição de status client-side e chamam /notificar).
//
// Best-effort e idempotente: nunca lança pro chamador — todo o corpo roda dentro de um
// try/catch que só loga. A idempotência real (não processar o mesmo pedido 2x, não processar
// pedido que não está `entregue`) é garantida pelo UPDATE atômico de
// `marcarPedidoFidelidadeProcessado` (0 linhas afetadas = já processado ou não entregue).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  aplicarPedidoAoProgresso,
  fracaoProgresso,
  montarMensagemFidelidade,
  pedidoContaParaCampanha,
  premioLabelCampanha,
  resumoProgresso,
  type CampanhaFidelidade,
  type ProgressoCliente,
  type ProgressoParaMensagem,
  type RecompensaParaMensagem,
} from '@/lib/fidelidade-regras'
import {
  buscarProgressoCliente,
  criarRecompensaDisponivel,
  listarCampanhasFidelidadeAtivas,
  marcarPedidoFidelidadeProcessado,
  salvarProgressoCliente,
} from '@/lib/queries/fidelidade'
import { enviarWhatsapp, formatarTelefoneWhatsapp } from '@/lib/whatsapp'

/** Dia da semana (0=dom..6=sáb) de um timestamp ISO, calculado em America/Sao_Paulo — não no fuso do servidor. */
function diaSemanaSaoPaulo(isoDate: string): number {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date(isoDate))
  const mapa: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return mapa[weekday] ?? new Date(isoDate).getDay()
}

/** Busca em lote o nome dos itens premiados (premio_tipo=item_gratis), pra não fazer 1 query por campanha. */
async function buscarNomesItens(admin: SupabaseClient, itemIds: string[]): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map()
  const { data, error } = await admin.from('itens_cardapio').select('id, nome').in('id', itemIds)
  if (error) throw error
  return new Map((data ?? []).map((row: { id: string; nome: string }) => [row.id, row.nome]))
}

/** Nome da loja + instância do WhatsApp (Evolution API) do restaurante, pra montar/enviar a mensagem. */
async function buscarDadosLoja(admin: SupabaseClient, restauranteId: string): Promise<{ nome: string; evolutionInstance: string | null }> {
  const { data, error } = await admin.from('restaurantes').select('nome, evolution_instance').eq('id', restauranteId).maybeSingle()
  if (error) throw error
  return { nome: data?.nome ?? '', evolutionInstance: data?.evolution_instance ?? null }
}

interface ResultadoCampanha {
  campanha: CampanhaFidelidade
  progresso: ProgressoCliente
  completou: boolean
}

/**
 * Motor de progresso de fidelidade: aplica um pedido recém-entregue a todas as campanhas
 * ativas da loja e, se algo progrediu ou foi completado, manda no máximo 1 WhatsApp
 * agrupando tudo. Chamar sempre com `.catch(...)` — mas internamente já não propaga erro.
 *
 * Passos (ver task-4-brief.md):
 * 1. Trava de idempotência (marcarPedidoFidelidadeProcessado) — 0 linhas = já processado/não entregue, para aqui.
 * 2. Pedido sem telefone ou origem='pdv' não gera progresso de fidelidade.
 * 3. `pedido.recompensa_id` (resgate usado no próprio pedido) já é confirmado em `criarPedido` — nada a fazer aqui.
 * 4-6. Itera campanhas ativas, aplica regras puras, persiste progresso/recompensa e agrupa 1 mensagem de WhatsApp.
 */
export async function processarFidelidadePedidoEntregue(admin: SupabaseClient, restauranteId: string, pedidoId: string): Promise<void> {
  try {
    const pedido = await marcarPedidoFidelidadeProcessado(admin, restauranteId, pedidoId)
    if (!pedido) return // já processado ou pedido não está `entregue` — idempotência.
    if (!pedido.clienteTelefone || pedido.origem === 'pdv') return

    const campanhas = await listarCampanhasFidelidadeAtivas(admin, restauranteId)
    if (campanhas.length === 0) return

    const diaSemanaPedido = diaSemanaSaoPaulo(pedido.criadoEm)
    const telefone = pedido.clienteTelefone

    const resultados: ResultadoCampanha[] = []
    for (const campanha of campanhas) {
      const progressoAtual = await buscarProgressoCliente(admin, restauranteId, campanha.id, telefone)
      if (!pedidoContaParaCampanha(campanha, progressoAtual, diaSemanaPedido)) continue

      const { novo, completou } = aplicarPedidoAoProgresso(campanha, progressoAtual, {
        subtotal: pedido.subtotal,
        qtdItens: pedido.qtdItens,
      })
      await salvarProgressoCliente(admin, restauranteId, campanha.id, telefone, novo)
      if (completou) await criarRecompensaDisponivel(admin, restauranteId, campanha.id, telefone)

      resultados.push({ campanha, progresso: novo, completou })
    }

    if (resultados.length === 0) return

    const itemIds = [...new Set(
      resultados
        .filter((r) => r.campanha.premioTipo === 'item_gratis' && r.campanha.premioItemId)
        .map((r) => r.campanha.premioItemId as string)
    )]
    const nomesItens = await buscarNomesItens(admin, itemIds)

    const progressos: ProgressoParaMensagem[] = []
    const recompensasNovas: RecompensaParaMensagem[] = []
    for (const r of resultados) {
      const premioLabel = premioLabelCampanha(r.campanha, nomesItens.get(r.campanha.premioItemId ?? ''))
      if (r.completou) {
        recompensasNovas.push({ premioLabel, diasSemanaResgate: r.campanha.diasSemanaResgate })
      } else {
        const resumo = resumoProgresso(r.campanha, r.progresso)
        progressos.push({ faltaTexto: resumo.faltaTexto, premioLabel, fracao: fracaoProgresso(r.campanha, r.progresso) })
      }
    }

    const { nome: nomeLoja, evolutionInstance } = await buscarDadosLoja(admin, restauranteId)
    const mensagem = montarMensagemFidelidade(progressos, recompensasNovas, nomeLoja)
    if (!mensagem || !evolutionInstance) return

    const numero = formatarTelefoneWhatsapp(telefone)
    if (!numero) return

    await enviarWhatsapp(numero, mensagem, evolutionInstance)
  } catch (err) {
    console.error('[fidelidade] erro ao processar progresso do pedido', pedidoId, err)
  }
}
