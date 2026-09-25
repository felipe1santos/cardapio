import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { listaDeOrdemValida } from '@/lib/ordem-cardapio'

/**
 * Ordem do Gestor de Cardápio (0101): categorias da loja ou itens de UMA categoria.
 *
 * Só quem edita o catálogo (`cardapio.editar`: dono e gerente), conferido aqui além do
 * middleware. A loja vem SEMPRE da sessão. A gravação é uma função do banco que tranca
 * as linhas, exige a lista completa e exata e grava tudo numa transação, com auditoria —
 * nada de um update por linha disparado do navegador.
 *
 *   PUT { tipo: 'categorias', ids: [...] }
 *   PUT { tipo: 'itens', grupoId, ids: [...] }
 *
 * 409 `ordem_desatualizada`: outra aba criou, moveu ou excluiu algo; a tela recarrega.
 */

const MENSAGENS: Record<string, { status: number; error: string }> = {
  ordem_desatualizada: { status: 409, error: 'O cardápio mudou em outra tela. Recarregamos a lista; tente de novo.' },
  ordem_repetida: { status: 400, error: 'Item repetido na ordem.' },
  ordem_invalida: { status: 400, error: 'Ordem inválida.' },
  item_fora_da_categoria: { status: 400, error: 'A ordem tem item que não é desta categoria.' },
  categoria_de_outra_loja: { status: 400, error: 'A ordem tem categoria que não é desta loja.' },
}

export async function PUT(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!pode(sessao.papel, 'cardapio.editar')) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  let corpo: { tipo?: unknown; grupoId?: unknown; ids?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const tipo = corpo.tipo
  if (tipo !== 'itens' && tipo !== 'categorias') return NextResponse.json({ error: 'Tipo inválido.' }, { status: 400 })
  const lista = listaDeOrdemValida(corpo.ids, tipo === 'itens' ? 2000 : 500)
  if (!lista.ok) return NextResponse.json({ error: lista.erro, codigo: 'ordem_invalida' }, { status: 400 })

  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  const ator = { p_ator: sessao.userId, p_ator_nome: sessao.nome }
  let resultado
  if (tipo === 'itens') {
    const grupoId = corpo.grupoId
    if (typeof grupoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(grupoId)) {
      return NextResponse.json({ error: 'Categoria inválida.' }, { status: 400 })
    }
    resultado = await admin.rpc('cardapio_ordenar_itens', {
      p_restaurante: sessao.restauranteId,
      p_grupo: grupoId,
      p_itens: lista.ids,
      ...ator,
    })
  } else {
    resultado = await admin.rpc('cardapio_ordenar_categorias', {
      p_restaurante: sessao.restauranteId,
      p_grupos: lista.ids,
      ...ator,
    })
  }

  if (resultado.error) {
    const codigo = Object.keys(MENSAGENS).find((c) => resultado.error.message?.includes(c))
    if (codigo) return NextResponse.json({ error: MENSAGENS[codigo].error, codigo }, { status: MENSAGENS[codigo].status })
    return NextResponse.json({ error: 'Não foi possível salvar a ordem.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
