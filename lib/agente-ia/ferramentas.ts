/**
 * Agente de IA — ferramentas (tool use). Todas rodam no SERVIDOR, presas à loja e ao telefone DA CONVERSA: nada do que
 * a IA manda escolhe loja, cliente, preço ou total. Saída curta (JSON) para gastar pouco token.
 */
import type { FerramentaClaude } from '@/lib/custo/anthropic'
import { falhaDoPedido } from './falhas'
import { resolverFrete } from '@/lib/frete'
import { brl, type DadosLojaAuto } from '@/lib/robo-auto/respostas'
import { pedidoPorNumero, pedidosAbertosDoTelefone } from '@/lib/robo-auto/motor'
import { buscarNoCardapio, familiaDaBusca, sugerirParecidos, type CardapioIa } from './cardapio'
import { extrasDaOferta } from './peca-tambem'
import { ACOES_POS_PEDIDO, alterarPedidoFeito } from './pos-pedido'
import { calcularPedido, criarPedidoDaConversa, type Carrinho, type ContextoPedido } from './pedido'
import { mesclarDoIa, montarOferta, proximaPergunta, rascunhoParaCarrinho, rascunhoValido, tipoEfetivo, valorParcial, type OpcoesLoja, type Rascunho, ajustarTipoAceito, descreverRascunho } from './rascunho'

export const MAX_FERRAMENTAS_POR_RESPOSTA = 4

const ENDERECO = {
  type: 'object',
  properties: { rua: { type: 'string' }, numero: { type: 'string' }, complemento: { type: 'string' }, bairro: { type: 'string' }, referencia: { type: 'string' }, cep: { type: 'string' } },
  required: ['rua', 'numero', 'bairro'],
}

export const FERRAMENTAS: FerramentaClaude[] = [
  {
    name: 'consultar_cardapio',
    description: 'Busca itens do cardápio desta loja pelo nome (ou parte). Devolve item_id, preço, se está disponível, descrição e opções (tamanhos, sabores, adicionais obrigatórios).',
    input_schema: { type: 'object', properties: { busca: { type: 'string', description: 'Ex.: "x tudo", "coca", "pizza calabresa"' } }, required: ['busca'] },
  },
  {
    name: 'consultar_loja',
    description: 'Horário (aberta agora?), endereço, entrega/retirada, formas de pagamento e tempo de entrega desta loja.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'calcular_taxa',
    description: 'Taxa de entrega para um bairro ou endereço (mesma regra do cardápio online).',
    input_schema: { type: 'object', properties: { bairro: { type: 'string' }, rua: { type: 'string' }, numero: { type: 'string' }, cep: { type: 'string' } }, required: ['bairro'] },
  },
  {
    name: 'status_pedido',
    description: 'Situação dos pedidos DESTE cliente (do telefone da conversa). Opcional: número do pedido.',
    input_schema: { type: 'object', properties: { numero: { type: 'integer' } } },
  },
  {
    name: 'montar_pedido',
    description: 'Anota o pedido EM ANDAMENTO (pode ser parcial: só o que o cliente já disse). O SISTEMA guarda, pergunta o que falta (uma coisa por mensagem: adicionais obrigatórios, extras, entrega ou retirada, endereço, pagamento, troco) e, com tudo certo, ENVIA o resumo com o total. Mande só o que é novo; itens, quando mandar, é a lista COMPLETA.',
    input_schema: {
      type: 'object',
      properties: {
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              item_id: { type: 'string' }, quantidade: { type: 'integer' }, observacao: { type: 'string' },
              complementos: { type: 'array', items: { type: 'string' }, description: 'Nomes exatos dos adicionais/opções escolhidos' },
              tamanho: { type: 'string' }, sabores: { type: 'array', items: { type: 'string' } }, borda: { type: 'string' }, massa: { type: 'string' },
            },
            required: ['item_id', 'quantidade'],
          },
        },
        tipo: { type: 'string', enum: ['entrega', 'retirada'] },
        endereco: ENDERECO,
        pagamento: { type: 'string', enum: ['pix', 'dinheiro', 'cartao'] },
        troco_para: { type: 'number', description: 'Só para dinheiro: troco para quanto' },
        sem_troco: { type: 'boolean', description: 'Dinheiro sem precisar de troco' },
        so_isso: { type: 'boolean', description: 'O cliente disse que não quer mais nenhum item ("é só isso")' },
        nome_cliente: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'criar_pedido',
    description: 'Cria o pedido montado. Só depois que o cliente CONFIRMOU o resumo numa mensagem nova ("sim", "pode mandar").',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'alterar_pedido_feito',
    description: 'Cliente quer mudar ou cancelar um pedido JÁ CRIADO (trocar a forma de pagamento, cancelar, mudar itens ou endereço). O SISTEMA decide o que pode (troca o pagamento, cancela, registra a alteração para a loja confirmar, ou chama alguém da loja) e responde ao cliente. Para dinheiro, pergunte ANTES se precisa de troco e para quanto. Para mudar itens/endereço, mande em `detalhes` o que o cliente quer; itens a adicionar vão em `adicionar` com o item_id de consultar_cardapio.',
    input_schema: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ACOES_POS_PEDIDO },
        detalhes: { type: 'string', description: 'Para alterar_itens / alterar_endereco / outro / cancelar: o que o cliente quer, nas palavras dele (ex.: "tirar a cebola do X-Tudo", "mais 1 Coca 2L", "endereço: Rua X, 10, Centro")' },
        adicionar: { type: 'array', description: 'Só alterar_itens: itens a ADICIONAR, com o item_id de consultar_cardapio (nunca inventar id)', items: { type: 'object', properties: { item_id: { type: 'string' }, quantidade: { type: 'integer' }, observacao: { type: 'string' } }, required: ['item_id', 'quantidade'] } },
        pagamento: { type: 'string', enum: ['pix', 'dinheiro', 'cartao'], description: 'Só para trocar_pagamento' },
        troco_para: { type: 'number', description: 'Só para dinheiro: troco para quanto (0 = sem troco)' },
        numero: { type: 'integer', description: 'Número do pedido, se o cliente disser (senão, o último pedido desta conversa)' },
      },
      required: ['acao'],
    },
  },
  {
    name: 'chamar_atendente',
    description: 'Chama uma pessoa da loja para continuar a conversa (cliente pediu, reclamação séria ou você não consegue resolver).',
    input_schema: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] },
  },
]

export interface EfeitosFerramentas {
  /** Resumo do pedido montado pelo servidor (vai ao cliente antes do texto da IA). */
  resumo?: string
  /** Próxima pergunta do pedido em andamento (texto do servidor, uma só). */
  pergunta?: string
  pedido?: { id: string; numero: number; total: number; pixOnline: boolean; repetido: boolean }
  atendente?: string
  /** Mensagens do SERVIDOR (troca de pagamento, cancelamento, atendente): o texto da IA não vai junto. */
  mensagens?: string[]
}

export interface ContextoFerramentas extends ContextoPedido {
  cardapio: CardapioIa
  loja: DadosLojaAuto
  semEntregador: boolean
  mensagemAtual: { texto: string; em: string }
}

const json = (v: unknown) => JSON.stringify(v)

/** Executa uma ferramenta. Nunca lança: erro volta como texto para a IA explicar ao cliente. */
export async function executarFerramenta(ctx: ContextoFerramentas, efeitos: EfeitosFerramentas, nome: string, input: Record<string, unknown>): Promise<{ conteudo: string; erro?: boolean }> {
  try {
    switch (nome) {
      case 'consultar_cardapio': {
        const achados = buscarNoCardapio(ctx.cardapio, String(input.busca ?? ''))
        if (!achados.length) {
          // "um refri" numa loja sem bebida (teste 11/10): diz que não tem, sem sugerir lanche no lugar.
          const familia = familiaDaBusca(String(input.busca ?? ''))
          if (familia && familia.rotulo !== 'lanche') {
            return { conteudo: json({ itens: [], aviso: `A loja NÃO tem ${familia.rotulo} no cardápio. Diga com naturalidade, por exemplo: "Aqui a gente não tem ${familia.rotulo}, só o que está no cardápio 😕", e siga com o pedido.` }) }
          }
          const parecidos = sugerirParecidos(ctx.cardapio, String(input.busca ?? ''))
          return {
            conteudo: json({
              itens: [],
              aviso: 'Esse item NÃO existe no cardápio. Diga com naturalidade que não tem, sugira estes parecidos (com o preço) e pergunte se quer algum; ou ofereça mandar o link do cardápio com as fotos.',
              parecidos: parecidos.map((i) => ({ item_id: i.id, nome: i.nome, preco: brl(i.preco), categoria: i.categoria })),
            }),
          }
        }
        const pizza = achados.some((i) => i.tipo === 'pizza') ? ctx.cardapio.pizza : undefined
        return {
          conteudo: json({
            itens: achados.map((i) => ({
              item_id: i.id, nome: i.nome, categoria: i.categoria, preco: brl(i.preco), ...(i.precoCheio ? { preco_sem_promocao: brl(i.precoCheio) } : {}),
              situacao: i.situacao === 'disponivel' ? 'disponível' : i.situacao === 'fora_do_dia' ? 'não vendido hoje' : i.situacao,
              ...(i.descricao ? { descricao: i.descricao } : {}),
              ...(i.tamanhos.length ? { tamanhos: i.tamanhos.map((t) => `${t.nome} ${brl(t.preco)}`) } : {}),
              ...(i.sabores.length ? { sabores: i.sabores } : {}),
              ...(i.grupos.length ? {
                opcoes: i.grupos.map((g) => ({
                  grupo: g.nome, obrigatorio: g.obrigatorio || g.min > 0, minimo: g.min, maximo: g.max || null,
                  escolhas: g.opcoes.filter((o) => !o.pausado).map((o) => (o.preco > 0 ? `${o.nome} (+${brl(o.preco)})` : o.nome)),
                })),
              } : {}),
            })),
            // 12/10 (teste real): a IA listava os adicionais ela mesma e o servidor não assumia as perguntas.
            ...(achados.some((i) => i.grupos.length) ? { aviso: 'Cliente quer um destes? Chame montar_pedido AGORA com o item_id (complementos só os que ele JÁ disse). O SISTEMA mostra as opções e pergunta. NÃO liste opções/adicionais nem pergunte complementos você mesmo.' } : {}),
            ...(pizza ? { pizza: { tamanhos: pizza.tamanhos.map((t) => `${t.nome} (até ${t.maxSabores} sabores)`), bordas: pizza.bordas.map((b) => (b.preco > 0 ? `${b.nome} (+${brl(b.preco)})` : b.nome)), massas: pizza.massas.map((m) => m.nome) } } : {}),
          }),
        }
      }
      case 'consultar_loja': {
        const l = ctx.loja
        return {
          conteudo: json({
            aberta_agora: l.aberta, ...(l.proximaAbertura ? { proxima_abertura: l.proximaAbertura } : {}), horarios: l.gradeHorario,
            endereco: l.endereco, entrega: l.aceitaEntrega, retirada: l.aceitaRetirada,
            tempo_entrega: l.tempoEntrega ? `${l.tempoEntrega}${l.tempoEntregaOrigem === 'media' ? ' (média real dos últimos pedidos)' : ''}` : 'sem dado: NÃO diga "não sei" — chame chamar_atendente com o motivo "tempo de entrega"',
            tempo_retirada: l.tempoRetirada ?? 'sem dado: NÃO diga "não sei" — chame chamar_atendente com o motivo "tempo de retirada"',
            pagamento: ['Pix', 'Dinheiro (com troco)', 'Cartão na entrega'].filter((f) => f !== 'Pix' || l.pixChave || l.pixOnline), link_cardapio: l.link,
          }),
        }
      }
      case 'calcular_taxa': {
        if (!ctx.loja.aceitaEntrega) return { conteudo: json({ entrega: false, motivo: 'A loja não está fazendo entregas agora.' }) }
        const f = await resolverFrete(ctx.admin, ctx.restauranteId, {
          bairro: String(input.bairro ?? '').slice(0, 80), rua: String(input.rua ?? '').slice(0, 120), numero: String(input.numero ?? '').slice(0, 20), cep: String(input.cep ?? '').replace(/\D/g, '').slice(0, 8),
        })
        return { conteudo: json(f.entregavel ? { entrega: true, taxa: f.taxa > 0 ? brl(f.taxa) : 'Grátis', tempo_entrega: ctx.loja.tempoEntrega ?? 'sem dado (chame chamar_atendente se o cliente perguntar o tempo)' } : { entrega: false, motivo: f.motivo || 'Fora da área de entrega.' }) }
      }
      case 'status_pedido': {
        const n = Number(input.numero)
        const lista = Number.isInteger(n) && n > 0
          ? [await pedidoPorNumero(ctx.admin, ctx.restauranteId, ctx.telefone, n, ctx.semEntregador)].filter(Boolean)
          : await pedidosAbertosDoTelefone(ctx.admin, ctx.restauranteId, ctx.telefone, ctx.semEntregador)
        return { conteudo: json({ pedidos: lista.map((p) => ({ numero: p!.numero, situacao: p!.rotuloStatus, total: brl(p!.total), itens: p!.itens.map((i) => `${i.quantidade}x ${i.nome}`) })) }) }
      }
      case 'montar_pedido': {
        const conv = await conversaIa(ctx)
        const anterior = rascunhoValido(conv?.ia_rascunho, Date.now(), conv?.ia_pedido_em ?? null) ? conv!.ia_rascunho! : null
        const m0 = mesclarDoIa(anterior, input, ctx.cardapio, new Date().toISOString())
        if (!m0.ok) return { conteudo: m0.erro, erro: true }
        if (!m0.rascunho.itens.length) return { conteudo: 'O pedido está sem itens: mande itens com o item_id de consultar_cardapio.', erro: true }
        const loja = opcoesDaLoja(ctx.loja)
        // Tipo que a loja não aceita (19/10): troca e avisa em texto humano, em vez de falhar no fim.
        const aj = ajustarTipoAceito(m0.rascunho, loja)
        const m = { ok: true as const, rascunho: aj.rascunho }
        if (aj.aviso) efeitos.mensagens = [...(efeitos.mensagens ?? []), aj.aviso]
        if (input.so_isso === true && !m.rascunho.itens.some((l) => !anterior?.itens.some((x) => x.itemId === l.itemId))) {
          m.rascunho.soIsso = true
          if (!m.rascunho.oferta) m.rascunho.oferta = montarOferta(m.rascunho, ctx.cardapio, await extrasDaOferta(ctx.admin, ctx.restauranteId).catch(() => ({})))
        }
        // Endereço novo de entrega: taxa e tempo na hora (mesma regra do checkout; cache por endereço). Fora da área: pede outro.
        const freteAviso = input.endereco && m.rascunho.endereco && tipoEfetivo(m.rascunho, loja) === 'entrega' ? await avisoDeFrete(ctx, m.rascunho) : null
        await ctx.admin.from('whatsapp_conversas').update({ ia_rascunho: m.rascunho }).eq('id', ctx.conversaId).eq('restaurante_id', ctx.restauranteId)
        const p = proximaPergunta(m.rascunho, ctx.cardapio, loja)
        if (p) {
          efeitos.pergunta = freteAviso ? `${freteAviso}\n\n${p.texto}` : p.texto
          return { conteudo: json({ ok: true, valor_ate_agora: brl(valorParcial(m.rascunho, ctx.cardapio)), aviso: 'O SISTEMA já mandou ao cliente a próxima pergunta (uma só, com as opções). NÃO pergunte nada e não liste opções; no máximo uma frase curta sem pergunta.' }) }
        }
        const nome = (typeof input.nome_cliente === 'string' ? input.nome_cliente.trim().slice(0, 80) : '') || (ctx.nomeWhatsapp ?? '').trim().slice(0, 80)
        const carrinho = rascunhoParaCarrinho(m.rascunho, ctx.cardapio, loja, nome)
        if (!carrinho) return { conteudo: 'Ainda falta algo no pedido.', erro: true }
        if (!carrinho.nomeCliente) return { conteudo: 'Falta o nome do cliente.', erro: true }
        try { return await fecharMontagem(ctx, efeitos, carrinho, conv) } catch (err) {
          // Falha ao fechar (loja fechada, retirada desligada, fora da área…): texto HUMANO do servidor ao cliente (19/10).
          const falha = falhaDoPedido(err, ctx.loja, descreverRascunho(m.rascunho, ctx.cardapio, loja))
          efeitos.mensagens = [...(efeitos.mensagens ?? []), falha.texto]
          if (falha.atendente) efeitos.atendente = falha.resumo ?? falha.texto
          if (falha.ajustarTipo) await ctx.admin.from('whatsapp_conversas').update({ ia_rascunho: { ...m.rascunho, tipo: falha.ajustarTipo } }).eq('id', ctx.conversaId).eq('restaurante_id', ctx.restauranteId)
          return { conteudo: json({ ok: false, aviso: 'O sistema já explicou ao cliente. Não escreva mais nada (no máximo uma frase curta, sem erro técnico).' }) }
        }
      }
      case 'criar_pedido': {
        const r = await criarPedidoDaConversa(ctx, ctx.mensagemAtual)
        if (!r.ok) return { conteudo: r.erro, erro: true }
        efeitos.pedido = { id: r.id, numero: r.numero, total: r.total, pixOnline: r.pixOnline, repetido: r.repetido }
        return { conteudo: json({ ok: true, numero: r.numero, aviso: 'O sistema já avisou o cliente com o número e o pagamento. Não escreva mais nada.' }) }
      }
      case 'alterar_pedido_feito': {
        const r = await alterarPedidoFeito(ctx, input)
        if (r.resumo) efeitos.resumo = r.resumo
        if (r.mensagens?.length) efeitos.mensagens = [...(efeitos.mensagens ?? []), ...r.mensagens]
        if (r.atendente) efeitos.atendente = r.atendente
        return { conteudo: r.conteudo, ...(r.erro ? { erro: true } : {}) }
      }
      case 'chamar_atendente': {
        efeitos.atendente = String(input.motivo ?? '').slice(0, 200) || 'pedido do cliente'
        return { conteudo: json({ ok: true, aviso: 'Um atendente da loja vai continuar. Avise o cliente em uma frase.' }) }
      }
      default:
        return { conteudo: `Ferramenta desconhecida: ${nome}`, erro: true }
    }
  } catch (e) {
    return { conteudo: (e as Error).message?.slice(0, 300) || 'Não deu certo agora.', erro: true }
  }
}

/**
 * Taxa e tempo do endereço que o cliente acabou de passar ("Entrega no *Centro*: taxa `R$ 3,00` · 40 min"). Fora da área:
 * tira o endereço do pedido (a próxima pergunta volta a ser o endereço) e diz por quê. Muda `r`.
 */
async function avisoDeFrete(ctx: ContextoFerramentas, r: Rascunho): Promise<string | null> {
  const e = r.endereco!
  const f = await resolverFrete(ctx.admin, ctx.restauranteId, { rua: e.rua, numero: e.numero, bairro: e.bairro, cep: e.cep }).catch(() => null)
  if (!f) return null
  if (!f.entregavel) {
    r.endereco = null
    return `Esse endereço fica fora da nossa área de entrega 😕${f.motivo ? `\n> ${f.motivo}` : ''}`
  }
  const tempo = ctx.loja.tempoEntrega ? ` · ${ctx.loja.tempoEntrega}` : ''
  return `Entrega no *${e.bairro}*: taxa \`${f.taxa > 0 ? brl(f.taxa) : 'grátis'}\`${tempo} 🛵`
}

export const opcoesDaLoja =(l: DadosLojaAuto): OpcoesLoja => ({ aceitaEntrega: l.aceitaEntrega, aceitaRetirada: l.aceitaRetirada, pix: !!(l.pixChave || l.pixOnline) })

type ConversaIa = { ia_rascunho?: Rascunho | null; ia_carrinho?: { hash?: string; carrinho?: unknown } | null; ia_resumo_em?: string | null; ia_bump_em?: string | null; ia_pedido_em?: string | null } | null

export async function conversaIa(ctx: Pick<ContextoFerramentas, 'admin' | 'conversaId' | 'restauranteId'>): Promise<ConversaIa> {
  const { data } = await ctx.admin.from('whatsapp_conversas').select('ia_rascunho, ia_carrinho, ia_resumo_em, ia_bump_em, ia_pedido_em').eq('id', ctx.conversaId).eq('restaurante_id', ctx.restauranteId).maybeSingle()
  return data as ConversaIa
}

/** Pedido completo: "Peça também" (1x por pedido) ou o resumo com o total (texto do servidor). */
export async function fecharMontagem(ctx: ContextoFerramentas, efeitos: EfeitosFerramentas, carrinho: Carrinho, salvo: ConversaIa): Promise<{ conteudo: string; erro?: boolean }> {
  const resumo = await calcularPedido(ctx, carrinho)
  // Mesmo pedido de um resumo JÁ mostrado (o Haiku real remonta no "sim", 12/10): não renova a hora do resumo
  // (senão a confirmação fica "antes" dele e o pedido nunca é criado) nem manda o resumo de novo.
  if (salvo?.ia_resumo_em && salvo.ia_carrinho?.hash === resumo.hash) {
    return { conteudo: json({ ok: true, total: brl(resumo.total), aviso: 'Este é o mesmo pedido do resumo que o cliente já recebeu. Se ele confirmou, chame criar_pedido agora; senão, só pergunte se pode confirmar.' }) }
  }
  // "Peça também" (14/10): agora é uma etapa do pedido em andamento (rascunho.oferta), antes de entrega/retirada.
  await ctx.admin.from('whatsapp_conversas')
    .update({ ia_carrinho: { carrinho, hash: resumo.hash }, ia_resumo_em: new Date().toISOString() })
    .eq('id', ctx.conversaId).eq('restaurante_id', ctx.restauranteId)
  efeitos.resumo = resumo.texto
  return { conteudo: json({ ok: true, total: brl(resumo.total), aviso: 'O sistema já enviou o resumo ao cliente. Não repita; só pergunte se pode confirmar.' }) }
}
