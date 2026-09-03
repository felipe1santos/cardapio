import type { HorarioFuncionamento, StatusLoja } from '@/lib/timezone'

/**
 * Checklist de configuração da loja.
 *
 * O dono cadastra a loja aos poucos e esquece pedaços pelo caminho — e alguns
 * desses pedaços quebram o pedido do cliente final sem dar erro nenhum no
 * painel: cardápio sem item disponível, loja travada fechada, endereço da loja
 * em branco (o frete por raio vira chute), telefone vazio (o login por WhatsApp
 * não sai). Aqui a regra é uma função pura: recebe o retrato da loja, devolve o
 * que falta. A UI (components/admin/setup-alerta.tsx) só desenha.
 *
 * `critico` = trava ou distorce o pedido do cliente. `atencao` = a loja vende,
 * mas vende pior.
 */
export type SeveridadeSetup = 'critico' | 'atencao'

export interface PendenciaSetup {
  id: string
  titulo: string
  descricao: string
  severidade: SeveridadeSetup
  /** Item do menu lateral que resolve a pendência — é onde o marcador aparece. */
  href: string
}

/** Recorte da configuração da loja que o checklist precisa (ver ConfigLoja). */
export interface ConfigSetup {
  telefone: string
  logoUrl: string | null
  bannerUrl: string | null
  enderecoRua: string
  enderecoNumero: string
  enderecoBairro: string
  enderecoCidade: string
  enderecoEstado: string
  taxaEntregaPadrao: number
  horarioFuncionamento: HorarioFuncionamento | null
  statusLoja: StatusLoja
  usaLogistica: boolean
  aceitaEntrega: boolean
  aceitaRetirada: boolean
}

export interface DadosSetup {
  config: ConfigSetup
  /** Itens com status `disponivel` — o que o cliente consegue pedir hoje. */
  itensDisponiveis: number
  /** Itens disponíveis sem foto: vendem menos, mas não travam nada. */
  itensSemFoto: number
  /** Itens disponíveis com preço zerado e sem tabela de tamanhos — saem de graça. */
  itensSemPreco: number
  /** Itens disponíveis sem nenhum dia da semana marcado — nunca aparecem na vitrine. */
  itensSemDiaDaSemana: number
  categorias: number
  temTaxaPorBairro: boolean
  temTaxaPorRaio: boolean
  entregadoresCadastrados: number
}

const ORDEM: SeveridadeSetup[] = ['critico', 'atencao']

function enderecoIncompleto(c: ConfigSetup): boolean {
  return [c.enderecoRua, c.enderecoNumero, c.enderecoBairro, c.enderecoCidade, c.enderecoEstado].some(
    (campo) => !campo || !campo.trim()
  )
}

/** Telefone só serve se der pra mandar WhatsApp: DDD + 8 ou 9 dígitos. */
function telefoneInvalido(telefone: string): boolean {
  const digitos = (telefone ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  return digitos.length !== 10 && digitos.length !== 11
}

export function avaliarSetup(dados: DadosSetup): PendenciaSetup[] {
  const { config: c } = dados
  const pendencias: PendenciaSetup[] = []

  if (!c.aceitaEntrega && !c.aceitaRetirada) {
    pendencias.push({
      id: 'sem-canal',
      severidade: 'critico',
      titulo: 'A loja não aceita entrega nem retirada',
      descricao: 'Com os dois canais desligados o cliente monta a sacola e não consegue fechar o pedido. Ligue pelo menos um em Ajustes › Entrega.',
      href: '/admin/ajustes',
    })
  }

  if (c.statusLoja === 'fechado_manual') {
    pendencias.push({
      id: 'loja-fechada-manual',
      severidade: 'critico',
      titulo: 'A loja está fechada manualmente',
      descricao: 'Enquanto estiver assim, o cardápio aparece mas ninguém consegue pedir — nem dentro do horário de funcionamento.',
      href: '/admin/ajustes',
    })
  }

  if (dados.itensDisponiveis === 0) {
    pendencias.push({
      id: 'sem-item-disponivel',
      severidade: 'critico',
      titulo: 'Nenhum item disponível no cardápio',
      descricao: 'O cliente abre o cardápio e não encontra nada pra pedir. Cadastre itens ou tire do pausado/esgotado.',
      href: '/admin/cardapio',
    })
  } else if (dados.categorias === 0) {
    pendencias.push({
      id: 'sem-categoria',
      severidade: 'critico',
      titulo: 'Nenhuma categoria criada',
      descricao: 'Os itens precisam de uma categoria para aparecer no cardápio do cliente.',
      href: '/admin/cardapio',
    })
  }

  if (dados.itensSemPreco > 0) {
    pendencias.push({
      id: 'itens-sem-preco',
      severidade: 'critico',
      titulo: `${dados.itensSemPreco} ${dados.itensSemPreco === 1 ? 'item disponível com preço zerado' : 'itens disponíveis com preço zerado'}`,
      descricao: 'O cliente consegue pedir esses itens de graça. Coloque o preço ou pause o item até acertar.',
      href: '/admin/cardapio',
    })
  }

  if (dados.itensSemDiaDaSemana > 0) {
    pendencias.push({
      id: 'itens-sem-dia',
      severidade: 'critico',
      titulo: `${dados.itensSemDiaDaSemana} ${dados.itensSemDiaDaSemana === 1 ? 'item marcado como disponível não aparece' : 'itens marcados como disponíveis não aparecem'}`,
      descricao: 'Estão sem nenhum dia da semana marcado, então somem do cardápio todos os dias. Marque os dias no cadastro do item.',
      href: '/admin/cardapio',
    })
  }

  if (telefoneInvalido(c.telefone)) {
    pendencias.push({
      id: 'sem-telefone',
      severidade: 'critico',
      titulo: 'Telefone/WhatsApp da loja em branco',
      descricao: 'É por ele que o cliente confirma o login e recebe o aviso do pedido. Sem número válido, o cliente não entra na conta.',
      href: '/admin/ajustes',
    })
  }

  if (enderecoIncompleto(c)) {
    pendencias.push({
      id: 'endereco-incompleto',
      severidade: c.aceitaEntrega ? 'critico' : 'atencao',
      titulo: 'Endereço da loja incompleto',
      descricao: c.aceitaEntrega
        ? 'Sem rua, número, bairro, cidade e UF o cálculo de frete por distância erra o município e o cliente vê a taxa errada.'
        : 'Na retirada é esse endereço que o cliente usa pra buscar o pedido.',
      href: '/admin/ajustes',
    })
  }

  if (c.aceitaEntrega && !dados.temTaxaPorBairro && !dados.temTaxaPorRaio && c.taxaEntregaPadrao <= 0) {
    pendencias.push({
      id: 'sem-taxa-entrega',
      severidade: 'atencao',
      titulo: 'Nenhuma taxa de entrega configurada',
      descricao: 'Todo pedido de entrega está saindo sem frete. Configure a taxa padrão, por bairro ou por raio em Ajustes › Entrega.',
      href: '/admin/ajustes',
    })
  }

  if (c.statusLoja === 'automatico' && !c.horarioFuncionamento) {
    pendencias.push({
      id: 'sem-horario',
      severidade: 'atencao',
      titulo: 'Horário de funcionamento não configurado',
      descricao: 'Sem a grade de horários a loja aparece aberta 24h e recebe pedido de madrugada.',
      href: '/admin/ajustes',
    })
  }

  if (c.usaLogistica && dados.entregadoresCadastrados === 0) {
    pendencias.push({
      id: 'sem-entregador',
      severidade: 'atencao',
      titulo: 'Nenhum entregador cadastrado',
      descricao: 'O pedido pronto vai parar na Logística e não tem pra quem despachar. Cadastre um entregador ou desligue o módulo de Logística.',
      href: '/admin/logistica',
    })
  }

  if (!c.logoUrl) {
    pendencias.push({
      id: 'sem-logo',
      severidade: 'atencao',
      titulo: 'Loja sem logotipo',
      descricao: 'A logo é a primeira coisa que o cliente vê no cardápio e no acompanhamento do pedido.',
      href: '/admin/ajustes',
    })
  }

  if (!c.bannerUrl) {
    pendencias.push({
      id: 'sem-capa',
      severidade: 'atencao',
      titulo: 'Cardápio sem imagem de capa',
      descricao: 'A capa ocupa o topo do cardápio. Sem ela o cliente vê um fundo liso no lugar da vitrine.',
      href: '/admin/ajustes',
    })
  }

  if (dados.itensSemFoto > 0) {
    pendencias.push({
      id: 'itens-sem-foto',
      severidade: 'atencao',
      titulo: `${dados.itensSemFoto} ${dados.itensSemFoto === 1 ? 'item disponível sem foto' : 'itens disponíveis sem foto'}`,
      descricao: 'Item com foto vende mais. Suba as imagens no Gestor de Cardápio.',
      href: '/admin/cardapio',
    })
  }

  return pendencias.sort((a, b) => ORDEM.indexOf(a.severidade) - ORDEM.indexOf(b.severidade))
}

/** Quantas pendências caem em cada item do menu — vira o marcador da sidebar. */
export function contarPorMenu(pendencias: PendenciaSetup[]): Record<string, number> {
  const mapa: Record<string, number> = {}
  for (const p of pendencias) mapa[p.href] = (mapa[p.href] ?? 0) + 1
  return mapa
}

/**
 * Assinatura do conjunto de pendências. O "OK, entendi" guarda essa assinatura:
 * o modal só volta a aparecer quando surgir pendência nova, não a cada F5.
 */
export function assinaturaPendencias(pendencias: PendenciaSetup[]): string {
  return pendencias.map((p) => p.id).sort().join('|')
}
