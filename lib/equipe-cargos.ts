import { AREAS, MODELOS, SENSIVEIS, type Acessos, type Area, type Sensivel } from '@/lib/acessos'
import { pode, type Papel, type Permissao } from '@/lib/auth/permissoes'

/**
 * Cargos da Equipe (repaginação 2026-10-01).
 *
 * O cargo é o que a loja enxerga ("Caixa", "Motoboy"). Por baixo, quem decide continua
 * sendo papel (RLS) + acessos (middleware/rotas). Escolher um cargo preenche um MODELO de
 * permissões, que pode ser ajustado caixa por caixa; o papel é deduzido das áreas marcadas
 * (`papelParaAcessos`) para a pessoa conseguir de fato usar o que foi liberado.
 */

export const CARGOS = ['dono', 'gerente', 'caixa', 'garcom', 'cozinha', 'motoboy', 'atendente', 'personalizado'] as const
export type Cargo = (typeof CARGOS)[number]

export const ROTULO_CARGO: Record<Cargo, string> = {
  dono: 'Dono',
  gerente: 'Gerente',
  caixa: 'Caixa',
  garcom: 'Garçom',
  cozinha: 'Cozinha',
  motoboy: 'Motoboy',
  atendente: 'Atendente',
  personalizado: 'Personalizado',
}

/** Cores do badge do cargo (tons do painel). */
export const COR_CARGO: Record<Cargo, { fundo: string; cor: string }> = {
  dono: { fundo: '#111827', cor: '#FFFFFF' },
  gerente: { fundo: '#E0F2FE', cor: '#0570AE' },
  caixa: { fundo: '#DCFCE7', cor: '#15803D' },
  garcom: { fundo: '#FFEDD5', cor: '#C2410C' },
  cozinha: { fundo: '#FEF3C7', cor: '#B45309' },
  motoboy: { fundo: '#F3E8FF', cor: '#7E22CE' },
  atendente: { fundo: '#E0F2FE', cor: '#0369A1' },
  personalizado: { fundo: '#F1F5F9', cor: '#475569' },
}

const PAPEL_DO_CARGO: Record<Exclude<Cargo, 'dono' | 'personalizado'>, Papel> = {
  gerente: 'gerente',
  caixa: 'atendente',
  garcom: 'garcom',
  cozinha: 'atendente',
  motoboy: 'logistica',
  atendente: 'atendente',
}

const MODELO_DO_CARGO: Record<Exclude<Cargo, 'dono' | 'personalizado'>, Acessos> = {
  gerente: MODELOS.find((m) => m.chave === 'gerente')!.acessos,
  caixa: MODELOS.find((m) => m.chave === 'caixa')!.acessos,
  garcom: MODELOS.find((m) => m.chave === 'garcom')!.acessos,
  cozinha: MODELOS.find((m) => m.chave === 'cozinha')!.acessos,
  motoboy: MODELOS.find((m) => m.chave === 'entregador')!.acessos,
  atendente: { areas: ['pedidos', 'pdv', 'clientes'], sensiveis: [] },
}

/** Modelo de permissões do cargo (cópia). Personalizado/dono: null (não preenche nada). */
export function modeloDoCargo(cargo: Cargo): Acessos | null {
  if (cargo === 'dono' || cargo === 'personalizado') return null
  const m = MODELO_DO_CARGO[cargo]
  return { areas: [...m.areas], sensiveis: [...m.sensiveis] }
}

/** Cargo exibido para quem não tem cargo gravado (contas de antes da 0128). */
export function cargoDoUsuario(cargo: string | null | undefined, papel: string, acessos: Acessos | null): Cargo {
  if (papel === 'dono') return 'dono'
  if (cargo && (CARGOS as readonly string[]).includes(cargo)) return cargo as Cargo
  if (papel === 'gerente') return 'gerente'
  if (papel === 'garcom') return 'garcom'
  if (papel === 'logistica' || papel === 'entregador') return 'motoboy'
  if (papel === 'cozinha') return 'cozinha'
  if (papel === 'atendente') {
    if (!acessos) return 'atendente'
    for (const c of ['caixa', 'cozinha', 'atendente'] as const) if (mesmosAcessos(acessos, MODELO_DO_CARGO[c])) return c
    return 'personalizado'
  }
  return 'personalizado'
}

export function mesmosAcessos(a: Acessos, b: Acessos): boolean {
  const igual = <T>(x: T[], y: T[]) => x.length === y.length && x.every((v) => y.includes(v))
  return igual(a.areas, b.areas) && igual(a.sensiveis, b.sensiveis)
}

/** Permissão do papel que a área exige para ser usada de verdade (RLS). */
const PERMISSAO_DA_AREA: Record<Area, Permissao> = {
  dashboard: 'dashboard.faturamento',
  pedidos: 'pedidos.delivery.ver',
  pdv: 'balcao.abrir',
  mesas: 'comanda.ver',
  cozinha: 'cozinha.gerenciar',
  logistica: 'logistica.operar',
  cardapio: 'cardapio.editar',
  clientes: 'clientes.ver',
  campanhas: 'campanhas.gerenciar',
  fidelidade: 'fidelidade.gerenciar',
  integracoes: 'integracoes.gerenciar',
  equipe: 'equipe.gerenciar',
  impressao: 'impressao.configurar',
  ajustes: 'ajustes.editar',
  // Financeiro: as rotas são do servidor e conferem as permissões próprias (caixa_abrir,
  // sangria…). A área sozinha não pode promover um operador de caixa a gerente.
  financeiro: 'comanda.ver',
}

/** Papéis em ordem do mais restrito ao mais amplo (o primeiro que cobre vence). */
const ORDEM_PAPEIS: Papel[] = ['garcom', 'atendente', 'logistica', 'gerente']

function cobre(papel: Papel, areas: Area[]): boolean {
  // Área que nenhum papel oferecido cobre (Integrações e Ajustes são do dono) não pesa na
  // escolha — ela continua liberada no menu, como já era no modelo Gerente.
  return areas.every((a) => pode(papel, PERMISSAO_DA_AREA[a]) || !ORDEM_PAPEIS.some((p) => pode(p, PERMISSAO_DA_AREA[a])))
}

/**
 * Papel que a conta recebe. Começa pelo papel do cargo; se as áreas marcadas pedirem mais,
 * sobe para o papel mais restrito que cobre todas, dentro do que quem cadastra pode dar.
 * Null = nenhum papel permitido cobre (ex.: gerente liberando Cardápio — só o dono cria gerente).
 */
export function papelParaAcessos(cargo: Cargo, acessos: Acessos, oferecidos: Papel[]): Papel | null {
  const base = cargo === 'dono' || cargo === 'personalizado' ? null : PAPEL_DO_CARGO[cargo]
  if (base && oferecidos.includes(base) && cobre(base, acessos.areas)) return base
  for (const p of ORDEM_PAPEIS) if (oferecidos.includes(p) && cobre(p, acessos.areas)) return p
  return null
}

/** Áreas marcadas que nenhum papel ao alcance de quem cadastra consegue usar (para a mensagem de erro). */
export function areasForaDoAlcance(acessos: Acessos, oferecidos: Papel[]): Area[] {
  return acessos.areas.filter((a) => {
    const perm = PERMISSAO_DA_AREA[a]
    const alguem = ORDEM_PAPEIS.some((p) => pode(p, perm))
    return alguem && !oferecidos.some((p) => pode(p, perm))
  })
}

/** Total de permissões concedidas (áreas + ações sensíveis). */
export function contarPermissoes(acessos: Acessos | null): number {
  if (!acessos) return 0
  return acessos.areas.length + acessos.sensiveis.length
}

export type Situacao = 'ativo' | 'pausado' | 'bloqueado' | 'excluido'

/** Situação exibida. Conta desativada antes da 0128 (sem motivo) aparece como pausada. */
export function situacaoDoUsuario(ativo: boolean, situacao: string | null | undefined): Situacao {
  if (ativo) return 'ativo'
  if (situacao === 'bloqueado' || situacao === 'excluido') return situacao
  return 'pausado'
}

export const ROTULO_SITUACAO: Record<Situacao, string> = { ativo: 'Ativo', pausado: 'Pausado', bloqueado: 'Bloqueado', excluido: 'Excluído' }

/** Grupos de cartões do modal de permissões. Financeiro mora em Gestão (é a sensível "ver valores"). */
export type ItemPermissao = { tipo: 'area'; chave: Area; rotulo: string; descricao: string } | { tipo: 'sensivel'; chave: Sensivel; rotulo: string; descricao: string }

const rotArea = (c: Area) => AREAS.find((a) => a.chave === c)!.rotulo
const rotSens = (c: Sensivel) => SENSIVEIS.find((s) => s.chave === c)!.rotulo

export const GRUPOS_PERMISSOES: { titulo: string; itens: ItemPermissao[]; soComFinanceiro?: boolean }[] = [
  {
    titulo: 'Operação',
    itens: [
      { tipo: 'area', chave: 'pedidos', rotulo: rotArea('pedidos'), descricao: 'Ver e mover os pedidos do delivery no Kanban.' },
      { tipo: 'area', chave: 'pdv', rotulo: rotArea('pdv'), descricao: 'Abrir o balcão e lançar vendas.' },
      { tipo: 'area', chave: 'mesas', rotulo: rotArea('mesas'), descricao: 'Abrir mesas, lançar itens e ver a conta.' },
      { tipo: 'area', chave: 'cozinha', rotulo: rotArea('cozinha'), descricao: 'Configurar as estações e telas de preparo.' },
      { tipo: 'area', chave: 'logistica', rotulo: rotArea('logistica'), descricao: 'Despachar entregas e o caixa do entregador.' },
    ],
  },
  {
    titulo: 'Cardápio e clientes',
    itens: [
      { tipo: 'area', chave: 'cardapio', rotulo: rotArea('cardapio'), descricao: 'Cadastrar e editar produtos e categorias.' },
      { tipo: 'area', chave: 'clientes', rotulo: rotArea('clientes'), descricao: 'Ver a base de clientes, telefones e endereços.' },
      { tipo: 'area', chave: 'fidelidade', rotulo: rotArea('fidelidade'), descricao: 'Programa de pontos, prêmios e cupons.' },
      { tipo: 'area', chave: 'campanhas', rotulo: rotArea('campanhas'), descricao: 'Montar campanhas e mensagens automáticas.' },
    ],
  },
  {
    titulo: 'Gestão',
    itens: [
      { tipo: 'area', chave: 'dashboard', rotulo: rotArea('dashboard'), descricao: 'Painel de métricas (exige também o Financeiro).' },
      { tipo: 'sensivel', chave: 'financeiro', rotulo: 'Financeiro', descricao: 'Ver faturamento, valores e relatórios.' },
      { tipo: 'area', chave: 'integracoes', rotulo: rotArea('integracoes'), descricao: 'WhatsApp, iFood e outras conexões.' },
      { tipo: 'area', chave: 'equipe', rotulo: rotArea('equipe'), descricao: 'Cadastrar usuários e permissões. Só o dono libera.' },
      { tipo: 'area', chave: 'impressao', rotulo: rotArea('impressao'), descricao: 'Impressoras, computadores e testes.' },
      { tipo: 'area', chave: 'ajustes', rotulo: rotArea('ajustes'), descricao: 'Dados da loja, horários, entrega e pagamento.' },
    ],
  },
  {
    // Só aparece na Equipe das lojas com o módulo financeiro ligado (0132).
    titulo: 'Financeiro',
    soComFinanceiro: true,
    itens: [
      { tipo: 'area', chave: 'financeiro', rotulo: rotArea('financeiro'), descricao: 'Abre o módulo financeiro (só nas lojas com ele ligado).' },
      { tipo: 'sensivel', chave: 'caixa_abrir', rotulo: rotSens('caixa_abrir'), descricao: 'Abrir o turno com o fundo de troco.' },
      { tipo: 'sensivel', chave: 'caixa_reabrir', rotulo: rotSens('caixa_reabrir'), descricao: 'Mesmo marcado, só o dono reabre.' },
      { tipo: 'sensivel', chave: 'receber_pagamento', rotulo: rotSens('receber_pagamento'), descricao: 'Registrar pagamentos no caixa.' },
      { tipo: 'sensivel', chave: 'sangria', rotulo: rotSens('sangria'), descricao: 'Tirar ou pôr dinheiro na gaveta.' },
      { tipo: 'sensivel', chave: 'despesa', rotulo: rotSens('despesa'), descricao: 'Pagar despesa com dinheiro do caixa.' },
      { tipo: 'sensivel', chave: 'acerto_motoboy', rotulo: rotSens('acerto_motoboy'), descricao: 'Receber o dinheiro do motoboy na volta.' },
      { tipo: 'sensivel', chave: 'pix_conferir', rotulo: rotSens('pix_conferir'), descricao: 'Confirmar que o Pix caiu na conta.' },
      { tipo: 'sensivel', chave: 'estornar', rotulo: rotSens('estornar'), descricao: 'Devolver um pagamento já recebido.' },
      { tipo: 'sensivel', chave: 'aprovar', rotulo: rotSens('aprovar'), descricao: 'Liberar ações de outros com o próprio PIN.' },
      { tipo: 'sensivel', chave: 'reimprimir', rotulo: rotSens('reimprimir'), descricao: 'Imprimir de novo pré-conta e recibo.' },
      { tipo: 'sensivel', chave: 'custos_editar', rotulo: rotSens('custos_editar'), descricao: 'Insumos, fichas de custo e CMV.' },
      { tipo: 'sensivel', chave: 'contas_pagar', rotulo: rotSens('contas_pagar'), descricao: 'Lançar e pagar contas da empresa.' },
      { tipo: 'sensivel', chave: 'dre_ver', rotulo: rotSens('dre_ver'), descricao: 'Ver lucro, CMV e DRE.' },
      { tipo: 'sensivel', chave: 'auditoria_ver', rotulo: rotSens('auditoria_ver'), descricao: 'Ver auditoria, alertas e risco por funcionário.' },
    ],
  },
  {
    titulo: 'Ações sensíveis',
    itens: [
      { tipo: 'sensivel', chave: 'cancelar_pedido', rotulo: rotSens('cancelar_pedido'), descricao: 'Cancelar pedidos, itens e contas.' },
      { tipo: 'sensivel', chave: 'desconto', rotulo: rotSens('desconto'), descricao: 'Desconto e cupom na conta.' },
      { tipo: 'sensivel', chave: 'taxa', rotulo: rotSens('taxa'), descricao: 'Taxa de serviço, couvert e outras taxas.' },
      { tipo: 'sensivel', chave: 'fechar_caixa', rotulo: rotSens('fechar_caixa'), descricao: 'Fechar e acertar o caixa.' },
      { tipo: 'sensivel', chave: 'disparar_campanhas', rotulo: rotSens('disparar_campanhas'), descricao: 'Enviar campanhas e notificações.' },
      { tipo: 'sensivel', chave: 'editar_precos', rotulo: rotSens('editar_precos'), descricao: 'Mudar preço e promoção no cardápio.' },
      { tipo: 'sensivel', chave: 'clientes_csv', rotulo: rotSens('clientes_csv'), descricao: 'Baixar a base de clientes e importar planilhas.' },
    ],
  },
]

export function temPermissao(acessos: Acessos, item: ItemPermissao): boolean {
  return item.tipo === 'area' ? acessos.areas.includes(item.chave) : acessos.sensiveis.includes(item.chave)
}

export function alternarPermissao(acessos: Acessos, item: ItemPermissao, ligar: boolean): Acessos {
  if (item.tipo === 'area') {
    const areas = acessos.areas.filter((a) => a !== item.chave)
    return { ...acessos, areas: ligar ? [...areas, item.chave] : areas }
  }
  const sensiveis = acessos.sensiveis.filter((s) => s !== item.chave)
  return { ...acessos, sensiveis: ligar ? [...sensiveis, item.chave] : sensiveis }
}
