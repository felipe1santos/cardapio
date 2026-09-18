/**
 * Quem pode o quê, em um lugar só.
 *
 * O painel admin é 100% client-side: as páginas falam direto com o PostgREST usando o
 * JWT do usuário, e quem barra de verdade é a RLS. Esta matriz existe para que a
 * interface, as rotas de API e as policies do banco digam **a mesma coisa** — e para
 * que isso seja testável sem subir banco nenhum.
 *
 * Duas regras de ouro:
 *
 * 1. **Allowlist, nunca negação.** Nada de "todo mundo menos garçom": papel novo não
 *    herda acesso por descuido. Quem não está na lista, não entra.
 * 2. **Canal separado.** Garçom precisa operar mesa; isso não pode dar a ele o delivery,
 *    com endereço, telefone e faturamento junto.
 */

export const PAPEIS = ['dono', 'gerente', 'garcom', 'atendente', 'cozinha', 'logistica', 'entregador'] as const

export type Papel = (typeof PAPEIS)[number]

export const PERMISSOES = [
  // Delivery (vitrine e telefone)
  'pedidos.delivery.ver',
  'pedidos.delivery.criar',
  'pedidos.delivery.avancar',
  'pedidos.delivery.cancelar',
  // Mesa (presencial)
  'pedidos.mesa.ver',
  'pedidos.mesa.criar',
  'pedidos.mesa.enviar_cozinha',
  'pedidos.mesa.cancelar',
  'pedidos.mesa.solicitar_cancelamento',
  // Balcão (PDV)
  'pedidos.balcao.criar',
  // Cozinha
  'cozinha.pedidos.ver',
  'cozinha.pedidos.atualizar_status',
  // Salão
  'mesas.operar',
  'mesas.gerenciar',
  'comanda.ver',
  'comanda.fechar',
  'comanda.transferir',
  'comanda.desconto',
  'comanda.estornar',
  'comanda.fiado',
  // Retaguarda
  'clientes.ver',
  'dashboard.faturamento',
  'cardapio.editar',
  'campanhas.gerenciar',
  'fidelidade.gerenciar',
  'logistica.operar',
  'auditoria.ver',
  'integracoes.gerenciar',
  'ajustes.editar',
  'equipe.gerenciar',
] as const

export type Permissao = (typeof PERMISSOES)[number]

/**
 * Papéis autorizados em cada permissão. Toda entrada é explícita: se a permissão nova
 * não listar um papel, aquele papel não a tem — e o teste de completude reprova
 * permissão sem decisão registrada.
 *
 * `cozinha`, `logistica` e `entregador` ainda entram por portal de token, sem login no
 * painel. As linhas deles documentam o que valeria e já deixam a RLS pronta.
 */
const MATRIZ: Record<Permissao, readonly Papel[]> = {
  'pedidos.delivery.ver': ['dono', 'gerente', 'atendente', 'logistica'],
  'pedidos.delivery.criar': ['dono', 'gerente', 'atendente'],
  'pedidos.delivery.avancar': ['dono', 'gerente', 'atendente', 'logistica'],
  'pedidos.delivery.cancelar': ['dono', 'gerente', 'atendente'],

  'pedidos.mesa.ver': ['dono', 'gerente', 'garcom', 'cozinha'],
  'pedidos.mesa.criar': ['dono', 'gerente', 'garcom'],
  'pedidos.mesa.enviar_cozinha': ['dono', 'gerente', 'garcom'],
  // Cancelar lançamento já enviado mexe em conta e histórico: fica com a gestão.
  'pedidos.mesa.cancelar': ['dono', 'gerente'],
  // O garçom não cancela o que já foi para a cozinha: ele PEDE, com motivo, e a gestão
  // decide. Assim o salão tem um caminho que não depende de achar o gerente no corredor.
  'pedidos.mesa.solicitar_cancelamento': ['dono', 'gerente', 'garcom'],

  // Garçom NÃO opera o balcão: o PDV é outro posto de trabalho.
  'pedidos.balcao.criar': ['dono', 'gerente', 'atendente'],

  // Preparo é da cozinha. O garçom lança e serve; não simula produção.
  'cozinha.pedidos.ver': ['dono', 'gerente', 'cozinha'],
  'cozinha.pedidos.atualizar_status': ['dono', 'gerente', 'cozinha'],

  // Operar = atender chamado e lançar. O caixa não faz nenhum dos dois.
  'mesas.operar': ['dono', 'gerente', 'garcom'],
  'mesas.gerenciar': ['dono', 'gerente'],
  // Ver o salão e a conta: quem atende e quem cobra.
  'comanda.ver': ['dono', 'gerente', 'garcom', 'atendente'],
  // Receber e fechar é trabalho de caixa. O garçom só recebe se a loja ligar a regra
  // (`salao_garcom_recebe`, ver `podeNoSalao`).
  'comanda.fechar': ['dono', 'gerente', 'atendente'],
  // A loja pode tirar do garçom (`salao_garcom_transfere`).
  'comanda.transferir': ['dono', 'gerente', 'garcom'],
  // Taxa e desconto. O caixa só se a loja ligar (`salao_caixa_desconto`).
  'comanda.desconto': ['dono', 'gerente'],
  // Devolver dinheiro e deixar conta pendurada são decisões da gestão.
  'comanda.estornar': ['dono', 'gerente'],
  'comanda.fiado': ['dono', 'gerente'],

  // Base de clientes é do delivery: telefone e endereço não são assunto do salão.
  'clientes.ver': ['dono', 'gerente', 'atendente'],
  'dashboard.faturamento': ['dono', 'gerente'],
  'cardapio.editar': ['dono', 'gerente'],
  'campanhas.gerenciar': ['dono', 'gerente'],
  'fidelidade.gerenciar': ['dono', 'gerente'],
  'logistica.operar': ['dono', 'gerente', 'logistica'],
  'auditoria.ver': ['dono', 'gerente'],
  'integracoes.gerenciar': ['dono'],
  'ajustes.editar': ['dono'],
  'equipe.gerenciar': ['dono', 'gerente'],
}

/** True se `papel` tem `permissao`. Papel desconhecido nunca tem nada. */
export function pode(papel: string | null | undefined, permissao: Permissao): boolean {
  if (!papel) return false
  return (MATRIZ[permissao] as readonly string[]).includes(papel)
}

/**
 * Quem pode disparar a notificação de WhatsApp de um pedido, por canal.
 *
 * `/api/pedidos/[id]/notificar` nasceu sem autenticação: qualquer um com o UUID de um
 * pedido mandava mensagem no WhatsApp do cliente da loja, de graça e quantas vezes
 * quisesse. Os consumidores legítimos são todos telas do painel já autenticadas (Kanban,
 * Logística e o painel de rotas), que fazem a transição de status pelo PostgREST e depois
 * avisam o cliente — então exigir sessão não quebra ninguém.
 *
 * Allowlist por canal, como o resto da matriz: quem pode MOVER o pedido daquele canal
 * pode avisar o cliente dele. Papel novo não herda o direito de mandar mensagem.
 */
export function podeNotificarCanal(papel: string | null | undefined, canal: string): boolean {
  if (canal === 'delivery') return pode(papel, 'pedidos.delivery.avancar') || pode(papel, 'logistica.operar')
  if (canal === 'mesa') return pode(papel, 'pedidos.mesa.ver')
  if (canal === 'balcao') return pode(papel, 'pedidos.balcao.criar')
  // Canal desconhecido (dado novo que o código ainda não conhece): ninguém dispara.
  return false
}

/**
 * Regras do salão que a loja escolhe (0071). Mexem só em três células da matriz e só
 * para o lado que a loja pediu — nunca dão ao papel algo fora do salão.
 */
export interface RegrasSalao {
  /** Garçom registra pagamento e fecha a conta. */
  garcomRecebe: boolean
  /** Garçom transfere mesa e itens. */
  garcomTransfere: boolean
  /** Atendente/caixa ajusta taxa de serviço e desconto. */
  caixaDesconto: boolean
}

/** O que vale para loja sem configuração: exatamente a matriz. */
export const REGRAS_SALAO_PADRAO: RegrasSalao = {
  garcomRecebe: false,
  garcomTransfere: true,
  caixaDesconto: false,
}

/**
 * `pode` com as regras da loja aplicadas. Toda decisão do salão passa por aqui — rota,
 * tela e teste —, então a regra liga e desliga no mesmo lugar para todo mundo.
 */
export function podeNoSalao(
  papel: string | null | undefined,
  permissao: Permissao,
  regras: RegrasSalao = REGRAS_SALAO_PADRAO,
): boolean {
  if (papel === 'garcom' && permissao === 'comanda.fechar') return regras.garcomRecebe
  if (papel === 'garcom' && permissao === 'comanda.transferir') return regras.garcomTransfere
  if (papel === 'atendente' && permissao === 'comanda.desconto') return regras.caixaDesconto
  return pode(papel, permissao)
}

/** Todas as permissões de um papel — usado pelo menu e pelos testes de paridade. */
export function permissoesDo(papel: string | null | undefined): Permissao[] {
  if (!papel) return []
  return PERMISSOES.filter((p) => pode(papel, p))
}

/** Papel válido? Protege contra papel novo no banco que o código ainda não conhece. */
export function ehPapel(valor: string | null | undefined): valor is Papel {
  return !!valor && (PAPEIS as readonly string[]).includes(valor)
}

// ── Equipe ──────────────────────────────────────────────────────────────────

/**
 * Hierarquia. Só serve para comparar quem pode administrar quem — nada além disso
 * depende desses números.
 */
const NIVEL: Record<Papel, number> = {
  dono: 100,
  gerente: 80,
  garcom: 40,
  atendente: 40,
  cozinha: 30,
  logistica: 30,
  entregador: 20,
}

/**
 * Papéis que a tela de Equipe oferece.
 *
 * `cozinha`, `logistica` e `entregador` ficam de fora enquanto entrarem por portal de
 * token: criar conta com login que não leva a lugar nenhum só gera confusão e
 * superfície de ataque. Os valores continuam no enum por compatibilidade.
 */
export function papeisQuePodeGerenciar(papel: string | null | undefined): Papel[] {
  if (!pode(papel, 'equipe.gerenciar')) return []
  const oferecidos: Papel[] = ['gerente', 'garcom', 'atendente']
  const meu = NIVEL[papel as Papel] ?? 0
  // Ninguém administra nível igual ou superior ao seu — o que também impede um gerente
  // de criar outro gerente, e qualquer um de criar um dono.
  return oferecidos.filter((p) => NIVEL[p] < meu)
}

export interface AlvoEquipe {
  id: string
  papel: string
  /** Outros usuários ATIVOS da loja que hoje têm `equipe.gerenciar`. */
  outrosAdminsAtivos: number
}

export interface Ator {
  id: string
  papel: string
}

export type MotivoRecusa =
  | 'sem_permissao'
  | 'proprio_usuario'
  | 'nivel_igual_ou_superior'
  | 'ultimo_administrador'

/**
 * Pode administrar (editar/desativar/redefinir senha) esse usuário?
 *
 * Quatro travas, nesta ordem: precisa da permissão; ninguém mexe na própria conta pela
 * tela de equipe; ninguém toca em nível igual ou superior; e a loja nunca fica sem
 * administrador — desativar o último deixaria todo mundo trancado do lado de fora.
 */
export function podeAdministrar(ator: Ator, alvo: AlvoEquipe): { ok: true } | { ok: false; motivo: MotivoRecusa } {
  if (!pode(ator.papel, 'equipe.gerenciar')) return { ok: false, motivo: 'sem_permissao' }
  if (ator.id === alvo.id) return { ok: false, motivo: 'proprio_usuario' }

  const nivelAtor = NIVEL[ator.papel as Papel] ?? 0
  const nivelAlvo = NIVEL[alvo.papel as Papel] ?? 0
  if (nivelAlvo >= nivelAtor) return { ok: false, motivo: 'nivel_igual_ou_superior' }

  if (pode(alvo.papel, 'equipe.gerenciar') && alvo.outrosAdminsAtivos === 0) {
    return { ok: false, motivo: 'ultimo_administrador' }
  }
  return { ok: true }
}

export const MENSAGEM_RECUSA: Record<MotivoRecusa, string> = {
  sem_permissao: 'Você não tem permissão para gerenciar a equipe.',
  proprio_usuario: 'Você não pode alterar a sua própria conta por aqui.',
  nivel_igual_ou_superior: 'Você não pode alterar um usuário do mesmo nível ou acima do seu.',
  ultimo_administrador: 'A loja ficaria sem nenhum administrador ativo.',
}
