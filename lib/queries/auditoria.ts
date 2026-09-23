import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Leitura da trilha de auditoria.
 *
 * `eventos_auditoria` é append-only para a aplicação (0062): só `service_role` escreve
 * (via `lib/auditoria.ts`, nas rotas de servidor) e só quem tem `auditoria.ver` lê — a
 * policy exige `auth_e_gestor()`. Esta consulta roda com o JWT do usuário, então a RLS
 * é quem filtra a loja; não existe caminho por aqui para ler evento de outro tenant.
 */

export interface EventoAuditoriaLinha {
  id: string
  criadoEm: string
  ator: string
  usuarioNome: string | null
  acao: string
  entidade: string
  entidadeId: string | null
  dados: Record<string, unknown>
}

/** Rótulo legível por ação. Ação sem rótulo aparece com o código cru, não em branco. */
export const ROTULO_EVENTO: Record<string, string> = {
  'mesa.abriu': 'Abriu a mesa',
  'mesa.enviou_cozinha': 'Enviou lançamento para a cozinha',
  'mesa.transferiu': 'Transferiu a conta de mesa',
  'mesa.mesclou': 'Juntou contas de duas mesas',
  'mesa.transferiu_itens': 'Transferiu itens entre mesas',
  'mesa.bloquear': 'Bloqueou a mesa',
  'mesa.desbloquear': 'Desbloqueou a mesa',
  'mesa.desativar': 'Desativou a mesa',
  'mesa.reativar': 'Reativou a mesa',
  'mesa.rodou_qr': 'Gerou um QR Code novo para a mesa',
  'mesa.revogou_qr': 'Revogou o QR Code da mesa',
  'mesas.configurou_conta': 'Alterou a configuração de conta e pagamentos',
  'mesas.configurou_cardapio': 'Personalizou o cardápio da mesa (QR)',
  'mesas.ligou_modulo': 'Ligou o módulo Mesas e Comandas',
  'mesas.desligou_modulo': 'Desligou o módulo Mesas e Comandas',
  'conta.pagamento': 'Registrou pagamento',
  'conta.estorno': 'Estornou pagamento',
  'conta.fechou': 'Fechou a conta',
  'conta.ajustou': 'Ajustou a conta',
  'conta.alterou_taxa': 'Alterou a taxa de serviço',
  'conta.removeu_taxa': 'Removeu a taxa de serviço',
  'conta.desconto': 'Aplicou ou alterou desconto',
  'conta.solicitou_cancelamento': 'Pediu cancelamento à gestão',
  'conta.aprovou_cancelamento': 'Aprovou pedido de cancelamento',
  'conta.recusou_cancelamento': 'Recusou pedido de cancelamento',
  'conta.cancelou_item': 'Cancelou item',
  'conta.cancelou_pedido': 'Cancelou lançamento',
  'conta.cancelou_comanda': 'Cancelou a conta',
  'conta.reimprimiu': 'Pediu reimpressão',
  'chamado.criou': 'Cliente chamou o garçom',
  'chamado.assumiu': 'Assumiu o chamado',
  'chamado.concluiu': 'Atendeu o chamado',
  'equipe.criou': 'Cadastrou funcionário',
  'equipe.editou': 'Alterou nome ou papel de funcionário',
  'equipe.desativou': 'Desativou funcionário',
  'equipe.reativou': 'Reativou funcionário',
  'equipe.redefiniu_senha': 'Redefiniu a senha de um funcionário',
  'impressao.gerou_token': 'Gerou um token novo para o Assistente de Impressão',
}

/** Grupos para o filtro da tela — o dono pensa por assunto, não por código de ação. */
export const GRUPOS_EVENTO: { id: string; label: string; prefixos: string[] }[] = [
  { id: 'todos', label: 'Tudo', prefixos: [] },
  // Duas famílias: `mesa.*` (uma mesa) e `mesas.*` (configuração do salão).
  { id: 'mesa', label: 'Mesas', prefixos: ['mesa.', 'mesas.'] },
  { id: 'conta', label: 'Contas e dinheiro', prefixos: ['conta.'] },
  { id: 'chamado', label: 'Chamados', prefixos: ['chamado.'] },
  { id: 'equipe', label: 'Equipe', prefixos: ['equipe.'] },
  { id: 'impressao', label: 'Impressão', prefixos: ['impressao.'] },
]

export function rotuloEvento(acao: string): string {
  return ROTULO_EVENTO[acao] ?? acao
}

/** Resumo de uma linha em uma frase: o que mudou, de onde para onde, por quê. */
export function resumoEvento(dados: Record<string, unknown>): string {
  const partes: string[] = []
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  const mesa = texto(dados.mesa)
  if (mesa) partes.push(mesa)
  const de = texto(dados.de)
  const para = texto(dados.para)
  if (de && para) partes.push(`${de} → ${para}`)
  const resumo = texto(dados.resumo)
  if (resumo) partes.push(resumo)
  const motivo = texto(dados.motivo)
  if (motivo && motivo !== resumo) partes.push(motivo)
  // Eventos de equipe: quem foi mexido, e para qual papel.
  const alvo = texto(dados.alvo) ?? texto(dados.nome)
  if (alvo) partes.push(alvo)
  const papel = texto(dados.papelNovo) ?? texto(dados.papel)
  if (papel) partes.push(papel)

  return partes.join(' · ')
}

export async function listarAuditoria(
  supabase: SupabaseClient,
  restauranteId: string,
  filtro: { prefixos?: string[]; busca?: string; limite?: number } = {},
): Promise<EventoAuditoriaLinha[]> {
  let q = supabase
    .from('eventos_auditoria')
    .select('id, criado_em, ator, usuario_nome, acao, entidade, entidade_id, dados')
    .eq('restaurante_id', restauranteId)
    .order('criado_em', { ascending: false })
    .limit(Math.min(filtro.limite ?? 200, 500))

  const prefixos = filtro.prefixos ?? []
  // `or` com `like` por prefixo: um grupo pode cobrir várias ações sem listar todas.
  if (prefixos.length > 0) {
    q = q.or(prefixos.map((p) => `acao.like.${p}*`).join(','))
  }

  const { data, error } = await q
  if (error) throw error

  const termo = (filtro.busca ?? '').trim().toLowerCase()
  return ((data ?? []) as unknown as {
    id: string; criado_em: string; ator: string; usuario_nome: string | null
    acao: string; entidade: string; entidade_id: string | null; dados: Record<string, unknown> | null
  }[])
    .map((e) => ({
      id: e.id,
      criadoEm: e.criado_em,
      ator: e.ator,
      usuarioNome: e.usuario_nome,
      acao: e.acao,
      entidade: e.entidade,
      entidadeId: e.entidade_id,
      dados: e.dados ?? {},
    }))
    // Busca no cliente: o volume por loja é pequeno (200 linhas) e assim o termo casa
    // com o rótulo em português, não só com o código da ação.
    .filter((e) => {
      if (!termo) return true
      return [rotuloEvento(e.acao), e.acao, e.usuarioNome ?? '', resumoEvento(e.dados)]
        .join(' ')
        .toLowerCase()
        .includes(termo)
    })
}
