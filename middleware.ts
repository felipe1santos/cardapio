import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { decidirAcesso, ehRotaDoModuloMesas } from '@/lib/auth/rotas'

/**
 * Porteiro do painel. Esconder item do menu não protege nada: quem digita a URL entra.
 * Aqui a rota é barrada no servidor, antes de a página ou a API rodar.
 *
 * O papel é relido do BANCO a cada requisição — nunca de cookie ou do JWT. A leitura usa
 * a própria sessão do usuário, então passa pela RLS: funcionário desativado, não
 * autorizado ou de loja sem dono válido não enxerga a própria linha em `usuarios`
 * (auth_restaurante_id() devolve null, 0060) e é tratado como sem acesso — mesmo com o
 * JWT ainda válido no navegador.
 *
 * Isto é camada de CONFORTO e defesa em profundidade. A barreira real do dado continua
 * sendo a RLS, que já foi verificada por papel.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        // A sessão pode ser renovada no meio do caminho: o cookie novo precisa ir tanto
        // para o request (quem vier depois nesta requisição) quanto para a resposta.
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({ request })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({ request })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    },
  )

  const pathname = request.nextUrl.pathname
  let papel: string | null = null

  const { data: auth } = await supabase.auth.getUser()
  if (auth.user) {
    const { data, error } = await supabase.from('usuarios').select('papel').eq('id', auth.user.id).maybeSingle()
    if (error) {
      // Falha de rede/banco, não de permissão. Deixar passar é o menor mal: a RLS continua
      // negando o dado, e derrubar o dono do painel por um soluço de conexão seria pior.
      console.error('[middleware] não consegui ler o papel', error.message)
      return response
    }
    papel = (data?.papel as string | undefined) ?? null
  }

  let decisao = decidirAcesso(pathname, papel)

  // Feature flag do módulo de mesas. Só custa uma consulta quando a decisão envolve o
  // salão: a rota é do módulo, ou o destino do redirecionamento seria ele.
  const envolveSalao =
    ehRotaDoModuloMesas(pathname) || (decisao.tipo === 'redirecionar' && ehRotaDoModuloMesas(decisao.para))
  if (papel && envolveSalao) {
    const { data: ligado, error } = await supabase.rpc('auth_modulo_mesas')
    // Aqui falha FECHADO: na dúvida, o módulo não existe. O dono perde o salão por um
    // soluço de conexão; o contrário abriria o módulo numa loja que não o contratou.
    if (error) console.error('[middleware] não consegui ler a flag de mesas', error.message)
    decisao = decidirAcesso(pathname, papel, !error && ligado === true)
  }

  if (decisao.tipo === 'seguir') return response

  if (decisao.tipo === 'negar') {
    return NextResponse.json(
      {
        error:
          decisao.status === 401
            ? 'Não autenticado'
            : decisao.status === 404
              ? 'Não encontrado'
              : 'Sem permissão para esta operação',
      },
      { status: decisao.status },
    )
  }

  const destino = request.nextUrl.clone()
  destino.pathname = decisao.para
  destino.search = ''
  // Logado mas sem linha visível em `usuarios` = desativado ou loja inválida. Vai para o
  // login com o motivo, em vez de ficar num loop de redirecionamento.
  if (decisao.para === '/login' && auth.user) destino.search = '?error=acesso'
  return NextResponse.redirect(destino)
}

export const config = {
  // Só o painel e as APIs administrativas. Vitrine, mesa pública, portais de token,
  // webhooks e o agente de impressão ficam de fora — eles têm autenticação própria.
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
