import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolverMesaPorToken } from '@/lib/queries/mesas'
import { buscarSessaoAberta } from '@/lib/queries/mesa-sessao'
import { abrirChamado } from '@/lib/queries/chamados'
import { ehMotivo } from '@/lib/chamados'

/**
 * "Chamar garçom" do cliente na mesa. **Não cria pedido nem comanda.**
 *
 * Este arquivo não importa `criarPedido`, não toca em `pedidos`, `pedido_itens`,
 * `comandas` nem `pagamentos_comanda`, e não chama cozinha, impressão, WhatsApp ou
 * logística. É um aviso operacional: o salão vê a mesa que chamou e vai até lá.
 *
 * Roda com `service_role` porque a chave anônima não tem grant em `mesas`,
 * `sessoes_mesa` nem `chamados_mesa` — o token opaco da URL é a credencial, resolvido a
 * cada requisição (mesa inativa, bloqueada, token revogado ou módulo desligado devolvem
 * 404 igual, sem virar oráculo de enumeração).
 *
 * O anti-spam é do banco (0068): um chamado aberto por mesa+motivo, carência entre
 * chamados e expiração do abandonado. Aqui não há trava de botão fazendo esse papel.
 */

async function contexto(token: string) {
  const admin = getAdminSupabase()
  const mesa = await resolverMesaPorToken(admin, token)
  // Mesa em limpeza não recebe chamado (o banco também recusa).
  if (!mesa || mesa.emLimpeza) return null
  return { admin, mesa }
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ctx = await contexto(token)
  if (!ctx) return NextResponse.json({ error: 'Mesa não encontrada' }, { status: 404 })

  // Só o que a tela do cliente precisa: existe chamado meu em pé e já foi assumido?
  // Nada de nome de funcionário, id de sessão ou histórico da loja.
  const { data } = await ctx.admin
    .from('chamados_mesa')
    .select('id, motivo, status, criado_em')
    .eq('restaurante_id', ctx.mesa.restauranteId)
    .eq('mesa_id', ctx.mesa.mesaId)
    .in('status', ['pendente', 'assumido'])
    .order('criado_em', { ascending: true })

  return NextResponse.json({
    chamados: (data ?? []).map((c) => ({
      id: c.id as string,
      motivo: c.motivo as string,
      status: c.status as string,
      criadoEm: c.criado_em as string,
    })),
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  let corpo: { motivo?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const motivo = ehMotivo(corpo.motivo) ? corpo.motivo : 'garcom'

  const ctx = await contexto(token)
  if (!ctx) return NextResponse.json({ error: 'Mesa não encontrada' }, { status: 404 })

  // Cardápio em "somente visualização" (0075): a tela não mostra o botão, e o servidor
  // recusa do mesmo jeito — senão bastaria um POST no token para encher o painel do
  // salão de chamados de uma loja que desligou a função.
  const { data: modo } = await ctx.admin
    .from('restaurantes')
    .select('mesa_somente_visualizacao')
    .eq('id', ctx.mesa.restauranteId)
    .maybeSingle()
  if ((modo as { mesa_somente_visualizacao?: boolean } | null)?.mesa_somente_visualizacao === true) {
    return NextResponse.json({ error: 'Este cardápio é só para visualização.' }, { status: 403 })
  }

  // Loja, mesa e sessão vêm do token, nunca do corpo: o navegador só escolhe o motivo,
  // e mesmo esse passa por allowlist.
  const sessao = await buscarSessaoAberta(ctx.admin, ctx.mesa.restauranteId, ctx.mesa.mesaId)

  const r = await abrirChamado(ctx.admin, {
    restauranteId: ctx.mesa.restauranteId,
    mesaId: ctx.mesa.mesaId,
    sessaoId: sessao?.id ?? null,
    motivo,
  })

  if (!r.ok) {
    // `muito_rapido` é o limite de frequência: 429 para a tela mostrar o "aguarde", e não
    // um erro genérico que pareceria falha.
    const status = r.codigo === 'muito_rapido' ? 429 : r.codigo === 'mesa_indisponivel' ? 409 : 400
    return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status })
  }

  return NextResponse.json({
    ok: true,
    id: r.valor.id,
    status: r.valor.status,
    criadoEm: r.valor.criado_em,
    jaExistia: r.valor.ja_existia,
    motivo,
  })
}
