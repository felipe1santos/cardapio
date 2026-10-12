/**
 * Agente de IA — ferramentas (tool use). Todas rodam no SERVIDOR, presas à loja e ao telefone DA CONVERSA: nada do que
 * a IA manda escolhe loja, cliente, preço ou total. Saída curta (JSON) para gastar pouco token.
 */
import type { FerramentaClaude } from '@/lib/custo/anthropic'
import { resolverFrete } from '@/lib/frete'
import { brl, type DadosLojaAuto } from '@/lib/robo-auto/respostas'
import { pedidoPorNumero, pedidosAbertosDoTelefone } from '@/lib/robo-auto/motor'
import { buscarNoCardapio, sugerirParecidos, type CardapioIa } from './cardapio'
import { calcularPedido, criarPedidoDaConversa, limparCarrinho, type ContextoPedido } from './pedido'

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
    description: 'Monta o pedido com tudo que o cliente escolheu. O sistema calcula preços, taxa e total e ENVIA o resumo ao cliente. Depois disso, só pergunte se pode confirmar.',
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
        nome_cliente: { type: 'string' },
      },
      required: ['itens', 'tipo', 'pagamento', 'nome_cliente'],
    },
  },
  {
    name: 'criar_pedido',
    description: 'Cria o pedido montado. Só depois que o cliente CONFIRMOU o resumo numa mensagem nova ("sim", "pode mandar").',
    input_schema: { type: 'object', properties: {} },
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
  pedido?: { id: string; numero: number; total: number; pixOnline: boolean; repetido: boolean }
  atendente?: string
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
            ...(pizza ? { pizza: { tamanhos: pizza.tamanhos.map((t) => `${t.nome} (até ${t.maxSabores} sabores)`), bordas: pizza.bordas.map((b) => `${b.nome} (+${brl(b.preco)})`), massas: pizza.massas.map((m) => m.nome) } } : {}),
          }),
        }
      }
      case 'consultar_loja': {
        const l = ctx.loja
        return {
          conteudo: json({
            aberta_agora: l.aberta, ...(l.proximaAbertura ? { proxima_abertura: l.proximaAbertura } : {}), horarios: l.gradeHorario,
            endereco: l.endereco, entrega: l.aceitaEntrega, retirada: l.aceitaRetirada, tempo_entrega: l.tempoEntrega ?? 'não informado',
            pagamento: ['Pix', 'Dinheiro (com troco)', 'Cartão na entrega'].filter((f) => f !== 'Pix' || l.pixChave || l.pixOnline), link_cardapio: l.link,
          }),
        }
      }
      case 'calcular_taxa': {
        if (!ctx.loja.aceitaEntrega) return { conteudo: json({ entrega: false, motivo: 'A loja não está fazendo entregas agora.' }) }
        const f = await resolverFrete(ctx.admin, ctx.restauranteId, {
          bairro: String(input.bairro ?? '').slice(0, 80), rua: String(input.rua ?? '').slice(0, 120), numero: String(input.numero ?? '').slice(0, 20), cep: String(input.cep ?? '').replace(/\D/g, '').slice(0, 8),
        })
        return { conteudo: json(f.entregavel ? { entrega: true, taxa: f.taxa > 0 ? brl(f.taxa) : 'Grátis', tempo_entrega: ctx.loja.tempoEntrega ?? 'não informado' } : { entrega: false, motivo: f.motivo || 'Fora da área de entrega.' }) }
      }
      case 'status_pedido': {
        const n = Number(input.numero)
        const lista = Number.isInteger(n) && n > 0
          ? [await pedidoPorNumero(ctx.admin, ctx.restauranteId, ctx.telefone, n, ctx.semEntregador)].filter(Boolean)
          : await pedidosAbertosDoTelefone(ctx.admin, ctx.restauranteId, ctx.telefone, ctx.semEntregador)
        return { conteudo: json({ pedidos: lista.map((p) => ({ numero: p!.numero, situacao: p!.rotuloStatus, total: brl(p!.total), itens: p!.itens.map((i) => `${i.quantidade}x ${i.nome}`) })) }) }
      }
      case 'montar_pedido': {
        const c = limparCarrinho(input, ctx.nomeWhatsapp)
        if (!c.ok) return { conteudo: c.erro, erro: true }
        const resumo = await calcularPedido(ctx, c.carrinho)
        // Mesmo pedido de um resumo JÁ mostrado (o Haiku real remonta no "sim", 12/10): não renova a hora do resumo
        // (senão a confirmação fica "antes" dele e o pedido nunca é criado) nem manda o resumo de novo.
        const { data: atual } = await ctx.admin.from('whatsapp_conversas').select('ia_carrinho, ia_resumo_em').eq('id', ctx.conversaId).eq('restaurante_id', ctx.restauranteId).maybeSingle()
        const salvo = atual as { ia_carrinho?: { hash?: string } | null; ia_resumo_em?: string | null } | null
        if (salvo?.ia_resumo_em && salvo.ia_carrinho?.hash === resumo.hash) {
          return { conteudo: json({ ok: true, total: brl(resumo.total), aviso: 'Este é o mesmo pedido do resumo que o cliente já recebeu. Se ele confirmou, chame criar_pedido agora; senão, só pergunte se pode confirmar.' }) }
        }
        await ctx.admin.from('whatsapp_conversas')
          .update({ ia_carrinho: { carrinho: c.carrinho, hash: resumo.hash }, ia_resumo_em: new Date().toISOString() })
          .eq('id', ctx.conversaId).eq('restaurante_id', ctx.restauranteId)
        efeitos.resumo = resumo.texto
        return { conteudo: json({ ok: true, total: brl(resumo.total), aviso: 'O sistema já enviou o resumo ao cliente. Não repita; só pergunte se pode confirmar.' }) }
      }
      case 'criar_pedido': {
        const r = await criarPedidoDaConversa(ctx, ctx.mensagemAtual)
        if (!r.ok) return { conteudo: r.erro, erro: true }
        efeitos.pedido = { id: r.id, numero: r.numero, total: r.total, pixOnline: r.pixOnline, repetido: r.repetido }
        return { conteudo: json({ ok: true, numero: r.numero, aviso: 'O sistema já avisou o cliente com o número e o pagamento. Não escreva mais nada.' }) }
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

