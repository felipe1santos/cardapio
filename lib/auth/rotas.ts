import { pode, type Permissao } from './permissoes'

/**
 * Qual permissão cada rota administrativa exige — lido pelo `middleware.ts`.
 *
 * O menu esconde; isto BARRA. O garçom que digita `/admin/dashboard` na barra de
 * endereço é redirecionado para a tela dele, e a API devolve 403.
 *
 * Regra de ouro, a mesma da matriz: rota administrativa que ninguém mapeou exige
 * `equipe.gerenciar` (dono e gerente). Tela nova não nasce aberta para o garçom por
 * esquecimento.
 */

/** Páginas do painel, por prefixo. */
const PAGINAS: [prefixo: string, permissao: Permissao][] = [
  ['/admin/dashboard', 'dashboard.faturamento'],
  ['/admin/pedidos', 'pedidos.delivery.ver'],
  ['/admin/pdv', 'pedidos.balcao.criar'],
  // Ver o salão e a conta: garçom e caixa. Cada ação confere a sua permissão por dentro.
  ['/admin/mesas', 'comanda.ver'],
  ['/admin/equipe', 'equipe.gerenciar'],
  ['/admin/auditoria', 'auditoria.ver'],
  ['/admin/logistica', 'logistica.operar'],
  ['/admin/cardapio', 'cardapio.editar'],
  ['/admin/clientes', 'clientes.ver'],
  ['/admin/campanhas', 'campanhas.gerenciar'],
  ['/admin/fidelidade', 'fidelidade.gerenciar'],
  ['/admin/integracoes', 'integracoes.gerenciar'],
  ['/admin/ajustes', 'ajustes.editar'],
]

/**
 * APIs, por prefixo. O mais específico precisa vir antes do genérico do mesmo ramo: a
 * busca pega o PRIMEIRO que casar.
 */
const APIS: [prefixo: string, permissao: Permissao][] = [
  // Cada rota do salão confere a sua permissão por dentro, mais fina (lançar, chamado,
  // pagamento, QR). Aqui só a porta: ver o salão.
  ['/api/admin/mesas', 'comanda.ver'],
  ['/api/admin/equipe', 'equipe.gerenciar'],
  // Ligar e desligar módulo é decisão comercial do dono.
  ['/api/admin/modulos', 'ajustes.editar'],
  ['/api/admin/pdv', 'pedidos.balcao.criar'],
  ['/api/admin/pedidos', 'pedidos.delivery.cancelar'],
  ['/api/admin/campanhas', 'campanhas.gerenciar'],
  ['/api/admin/fidelidade', 'fidelidade.gerenciar'],
  // Nexta: configurar é integração; despachar e cotar é operação de logística.
  ['/api/admin/nexta/config', 'integracoes.gerenciar'],
  ['/api/admin/nexta/testar', 'integracoes.gerenciar'],
  ['/api/admin/nexta', 'logistica.operar'],
  ['/api/admin/whatsapp', 'integracoes.gerenciar'],
]

/** Permissão exigida por rota não mapeada: só a gestão entra. */
export const PERMISSAO_PADRAO: Permissao = 'equipe.gerenciar'

export type Superficie = 'pagina' | 'api' | 'fora'

export function superficie(pathname: string): Superficie {
  if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) return 'api'
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'pagina'
  return 'fora'
}

function casaPrefixo(pathname: string, prefixo: string): boolean {
  return pathname === prefixo || pathname.startsWith(`${prefixo}/`)
}

/**
 * Permissão que a rota exige. `null` = rota fora do painel (o middleware não se mete).
 * `/admin` puro também devolve `null`: ele só redireciona para a tela inicial do papel.
 */
export function permissaoDaRota(pathname: string): Permissao | null {
  const onde = superficie(pathname)
  if (onde === 'fora' || pathname === '/admin' || pathname === '/admin/') return null
  const tabela = onde === 'api' ? APIS : PAGINAS
  const achada = tabela.find(([prefixo]) => casaPrefixo(pathname, prefixo))
  return achada ? achada[1] : PERMISSAO_PADRAO
}

/** As superfícies do módulo Mesas e Comandas — governadas pela feature flag da loja. */
export function ehRotaDoModuloMesas(pathname: string): boolean {
  return casaPrefixo(pathname, '/admin/mesas') || casaPrefixo(pathname, '/api/admin/mesas')
}

/**
 * Primeira tela do papel — para onde vai quem tentou entrar onde não pode.
 *
 * Com o módulo desligado o salão não é destino: sem isto o garçom seria mandado para
 * `/admin/mesas`, barrado lá pela flag, e mandado de volta — laço infinito.
 */
export function telaInicialDoPapel(papel: string | null | undefined, moduloMesas = true): string {
  if (pode(papel, 'dashboard.faturamento')) return '/admin/dashboard'
  if (moduloMesas && pode(papel, 'mesas.operar')) return '/admin/mesas'
  if (pode(papel, 'pedidos.delivery.ver')) return '/admin/pedidos'
  if (pode(papel, 'logistica.operar')) return '/admin/logistica'
  return '/login'
}

export type Decisao =
  | { tipo: 'seguir' }
  | { tipo: 'redirecionar'; para: string }
  | { tipo: 'negar'; status: 401 | 403 | 404 }

/**
 * A decisão inteira, sem rede nem cookie: dado o caminho, o papel que o banco devolveu
 * (null = sem sessão, usuário desativado ou loja inválida) e a flag do módulo de mesas da
 * loja, segue, redireciona ou nega.
 *
 * Flag desligada: a página do salão manda para a tela inicial e a API responde 404 —
 * para quem está de fora, o módulo simplesmente não existe naquela loja.
 */
export function decidirAcesso(pathname: string, papel: string | null, moduloMesas = true): Decisao {
  const onde = superficie(pathname)
  if (onde === 'fora') return { tipo: 'seguir' }

  if (!papel) {
    return onde === 'api' ? { tipo: 'negar', status: 401 } : { tipo: 'redirecionar', para: '/login' }
  }

  const inicial = telaInicialDoPapel(papel, moduloMesas)

  if (onde === 'pagina' && (pathname === '/admin' || pathname === '/admin/')) {
    return { tipo: 'redirecionar', para: inicial }
  }

  if (!moduloMesas && ehRotaDoModuloMesas(pathname)) {
    return onde === 'api' ? { tipo: 'negar', status: 404 } : { tipo: 'redirecionar', para: inicial }
  }

  const exigida = permissaoDaRota(pathname)
  if (!exigida || pode(papel, exigida)) return { tipo: 'seguir' }

  return onde === 'api' ? { tipo: 'negar', status: 403 } : { tipo: 'redirecionar', para: inicial }
}
