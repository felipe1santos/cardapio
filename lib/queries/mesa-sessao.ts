import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Sessão da mesa e seleção do cliente.
 *
 * A regra que este módulo inteiro protege: **a seleção do cliente não é pedido**. Nada
 * aqui cria pedido, abre comanda, chama a cozinha ou toca em estoque. O caminho do
 * pedido oficial é outro (`criarPedido`, a partir do painel autenticado do garçom).
 *
 * Tudo roda com `service_role`, depois que a rota pública resolveu o token da mesa — a
 * chave anônima não tem grant em nenhuma destas tabelas.
 */

export interface SessaoMesa {
  id: string
  mesaId: string
  status: 'aberta' | 'encerrada'
  abertaEm: string
  comandaId: string | null
}

export interface OpcaoSelecionada {
  grupo: string
  escolha: string
  preco: number
}

export interface ItemSelecionado {
  id?: string
  itemId: string | null
  nome: string
  precoUnitario: number
  quantidade: number
  observacao: string
  opcoes: OpcaoSelecionada[]
}

export interface SelecaoDaMesa {
  id: string
  versao: number
  atualizadoEm: string
  itens: ItemSelecionado[]
}

/** Preço de uma linha: base + adicionais, vezes a quantidade. Regra pura. */
export function totalDaLinha(item: Pick<ItemSelecionado, 'precoUnitario' | 'quantidade' | 'opcoes'>): number {
  const adicionais = item.opcoes.reduce((s, o) => s + (Number.isFinite(o.preco) ? o.preco : 0), 0)
  return (item.precoUnitario + adicionais) * item.quantidade
}

/** Total da seleção. É só uma estimativa que o cliente mostra ao garçom. */
export function totalDaSelecao(itens: ItemSelecionado[]): number {
  return itens.reduce((s, i) => s + totalDaLinha(i), 0)
}

/** Quantas unidades a seleção tem (o contador da barra flutuante). */
export function quantidadeDaSelecao(itens: ItemSelecionado[]): number {
  return itens.reduce((s, i) => s + i.quantidade, 0)
}

const LIMITE_ITENS = 60
const LIMITE_QTD = 99

/**
 * Saneia o que chega do navegador antes de gravar.
 *
 * O preço NUNCA vem do cliente para valer: quem chama passa o catálogo, e o preço é
 * relido dele. Se o item não está no catálogo da loja, a linha é descartada — assim a
 * seleção não vira vitrine de item de outra loja nem de preço inventado.
 */
export function sanearSelecao(
  bruto: unknown,
  catalogo: Map<string, { nome: string; preco: number }>,
): ItemSelecionado[] {
  if (!Array.isArray(bruto)) return []
  const itens: ItemSelecionado[] = []

  for (const linha of bruto.slice(0, LIMITE_ITENS)) {
    if (!linha || typeof linha !== 'object') continue
    const l = linha as Record<string, unknown>
    const itemId = typeof l.itemId === 'string' ? l.itemId : null
    if (!itemId) continue

    const doCatalogo = catalogo.get(itemId)
    if (!doCatalogo) continue

    const quantidade = Math.min(LIMITE_QTD, Math.max(1, Math.floor(Number(l.quantidade) || 1)))
    const observacao = typeof l.observacao === 'string' ? l.observacao.slice(0, 280) : ''

    const opcoes: OpcaoSelecionada[] = Array.isArray(l.opcoes)
      ? (l.opcoes as unknown[])
          .slice(0, 30)
          .map((o) => {
            const x = (o ?? {}) as Record<string, unknown>
            return {
              grupo: typeof x.grupo === 'string' ? x.grupo.slice(0, 80) : '',
              escolha: typeof x.escolha === 'string' ? x.escolha.slice(0, 120) : '',
              preco: Number.isFinite(Number(x.preco)) ? Math.max(0, Number(x.preco)) : 0,
            }
          })
          .filter((o) => o.escolha)
      : []

    itens.push({
      itemId,
      nome: doCatalogo.nome,
      precoUnitario: doCatalogo.preco,
      quantidade,
      observacao,
      opcoes,
    })
  }

  return itens
}

// ── sessão ──────────────────────────────────────────────────────────────────

interface SessaoRow {
  id: string
  mesa_id: string
  status: string
  aberta_em: string
  comanda_id: string | null
}

function mapSessao(row: SessaoRow): SessaoMesa {
  return {
    id: row.id,
    mesaId: row.mesa_id,
    status: row.status === 'encerrada' ? 'encerrada' : 'aberta',
    abertaEm: row.aberta_em,
    comandaId: row.comanda_id,
  }
}

const SESSAO_SELECT = 'id, mesa_id, status, aberta_em, comanda_id'

/**
 * Sessão aberta da mesa, criando uma se não houver.
 *
 * Abrir sessão é só registrar que tem gente sentada: **não abre conta, não conta como
 * venda, não cria comanda**. A comanda nasce no primeiro lançamento oficial.
 */
export async function abrirOuObterSessao(
  admin: SupabaseClient,
  restauranteId: string,
  mesaId: string,
): Promise<SessaoMesa> {
  const existente = await buscarSessaoAberta(admin, restauranteId, mesaId)
  if (existente) return existente

  const { data, error } = await admin
    .from('sessoes_mesa')
    .insert({ restaurante_id: restauranteId, mesa_id: mesaId })
    .select(SESSAO_SELECT)
    .single()

  if (error) {
    // Corrida: outro celular da mesma mesa criou a sessão entre o select e o insert.
    if (error.code === '23505') {
      const recuperada = await buscarSessaoAberta(admin, restauranteId, mesaId)
      if (recuperada) return recuperada
    }
    throw error
  }
  return mapSessao(data as SessaoRow)
}

export async function buscarSessaoAberta(
  admin: SupabaseClient,
  restauranteId: string,
  mesaId: string,
): Promise<SessaoMesa | null> {
  const { data, error } = await admin
    .from('sessoes_mesa')
    .select(SESSAO_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('mesa_id', mesaId)
    .eq('status', 'aberta')
    .maybeSingle()
  if (error) throw error
  return data ? mapSessao(data as SessaoRow) : null
}

// ── seleção ─────────────────────────────────────────────────────────────────

/** Lê a seleção daquele aparelho. Sem seleção ainda, devolve lista vazia. */
export async function buscarSelecao(
  admin: SupabaseClient,
  sessaoId: string,
  dispositivo: string,
): Promise<SelecaoDaMesa | null> {
  const { data, error } = await admin
    .from('selecoes_mesa')
    .select('id, versao, atualizado_em, selecao_itens ( item_id, nome_snapshot, preco_snapshot, quantidade, observacao, opcoes )')
    .eq('sessao_id', sessaoId)
    .eq('dispositivo', dispositivo)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as unknown as {
    id: string
    versao: number
    atualizado_em: string
    selecao_itens: {
      item_id: string | null
      nome_snapshot: string
      preco_snapshot: number
      quantidade: number
      observacao: string | null
      opcoes: OpcaoSelecionada[] | null
    }[]
  }

  return {
    id: row.id,
    versao: row.versao,
    atualizadoEm: row.atualizado_em,
    itens: (row.selecao_itens ?? []).map((i) => ({
      itemId: i.item_id,
      nome: i.nome_snapshot,
      precoUnitario: Number(i.preco_snapshot),
      quantidade: i.quantidade,
      observacao: i.observacao ?? '',
      opcoes: i.opcoes ?? [],
    })),
  }
}

/**
 * Grava a seleção do aparelho, substituindo a anterior.
 *
 * Substituir inteiro (e não fazer merge) é de propósito: a lista é do aparelho, é curta,
 * e o cliente acabou de vê-la na tela. Qualquer merge esperto aqui abriria espaço para o
 * item some/volta sozinho na frente do garçom.
 */
export async function salvarSelecao(
  admin: SupabaseClient,
  entrada: { restauranteId: string; mesaId: string; sessaoId: string; dispositivo: string; itens: ItemSelecionado[] },
): Promise<SelecaoDaMesa> {
  const { data: existente } = await admin
    .from('selecoes_mesa')
    .select('id, versao')
    .eq('sessao_id', entrada.sessaoId)
    .eq('dispositivo', entrada.dispositivo)
    .maybeSingle()

  let selecaoId: string
  let versao: number

  if (existente) {
    selecaoId = (existente as { id: string }).id
    versao = ((existente as { versao: number }).versao ?? 1) + 1
    const { error } = await admin
      .from('selecoes_mesa')
      .update({ versao, atualizado_em: new Date().toISOString() })
      .eq('id', selecaoId)
    if (error) throw error
    const { error: erroLimpeza } = await admin.from('selecao_itens').delete().eq('selecao_id', selecaoId)
    if (erroLimpeza) throw erroLimpeza
  } else {
    const { data, error } = await admin
      .from('selecoes_mesa')
      .insert({
        restaurante_id: entrada.restauranteId,
        mesa_id: entrada.mesaId,
        sessao_id: entrada.sessaoId,
        dispositivo: entrada.dispositivo,
      })
      .select('id, versao')
      .single()
    if (error) throw error
    selecaoId = (data as { id: string }).id
    versao = (data as { versao: number }).versao
  }

  if (entrada.itens.length > 0) {
    const { error } = await admin.from('selecao_itens').insert(
      entrada.itens.map((i) => ({
        selecao_id: selecaoId,
        item_id: i.itemId,
        nome_snapshot: i.nome,
        preco_snapshot: i.precoUnitario,
        quantidade: i.quantidade,
        observacao: i.observacao || null,
        opcoes: i.opcoes,
      })),
    )
    if (error) throw error
  }

  return { id: selecaoId, versao, atualizadoEm: new Date().toISOString(), itens: entrada.itens }
}
