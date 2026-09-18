'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { MenuLateralContext } from '@/components/layout/menu-lateral-contexto'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { contarBadgesNav, type BadgesNav } from '@/lib/queries/pedidos'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { carregarDadosSetup } from '@/lib/queries/setup'
import { assinaturaPendencias, avaliarSetup, contarPorMenu, type PendenciaSetup } from '@/lib/setup-checklist'
import { SetupAlerta } from '@/components/admin/setup-alerta'
import { pode } from '@/lib/auth/permissoes'
import { itensDoMenu } from '@/lib/menu-lateral'

/** Onde fica registrado o "OK, entendi" do dono, por loja. */
function chaveDispensa(restauranteId: string) {
  return `menuzia:setup-ok:${restauranteId}`
}

/**
 * Telas de operação: quem está no Kanban ou no PDV está atendendo cliente, e
 * um modal no meio disso atrapalha mais do que ajuda. O marcador no menu
 * continua aparecendo — o alerta abre quando o dono for para outra tela.
 */
// `/admin/mesas`: garçom anotando pedido na mesa não pode ter a tela coberta por aviso
// de taxa de entrega ou telefone da loja — que ele nem tem permissão de resolver.
const ROTAS_SEM_INTERRUPCAO = ['/admin/pedidos', '/admin/pdv', '/admin/mesas']

/**
 * O modal só interrompe o trabalho quando há pendência CRÍTICA (o que trava o
 * pedido do cliente) e essa combinação ainda não foi dispensada. Pendência de
 * atenção vive só no marcador do menu — brigar por foto de item seria ruído.
 */
function deveAbrirAlerta(restauranteId: string, lista: PendenciaSetup[], pathname: string): boolean {
  if (ROTAS_SEM_INTERRUPCAO.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))) return false
  if (!lista.some((p) => p.severidade === 'critico')) return false
  try {
    return localStorage.getItem(chaveDispensa(restauranteId)) !== assinaturaPendencias(lista)
  } catch {
    return true
  }
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [badges, setBadges] = useState<BadgesNav>({ novosPedidos: 0, logisticaPendente: 0 })
  const [storeSlug, setStoreSlug] = useState<string | null>(null)
  // Loja que não trabalha com entregador fecha a entrega no próprio Kanban — o
  // módulo de Logística sai do menu. `true` até a config chegar: esconder e
  // reaparecer o item piscaria o menu a cada carregamento.
  const [usaLogistica, setUsaLogistica] = useState(true)
  // Módulo Mesas e Comandas. Começa FALSE ao contrário da logística: a seção é nova, e
  // aparecer por um instante em loja que não a usa seria estranho.
  const [moduloMesas, setModuloMesas] = useState(false)
  // Papel de quem está logado. null = ainda carregando: aí o menu NÃO é filtrado, para
  // não sumir tudo por um instante na tela do dono (que é quem existe hoje em produção).
  const [papel, setPapel] = useState<string | null>(null)
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  // null = nenhum sinal explícito ainda; cai no default por rota.
  const [focusEvent, setFocusEvent] = useState<boolean | null>(null)
  // Checklist de configuração (lib/setup-checklist.ts).
  const [pendencias, setPendencias] = useState<PendenciaSetup[]>([])
  const [alertaAberto, setAlertaAberto] = useState(false)
  // Gaveta do menu: só existe abaixo de `lg`, onde a sidebar sai do fluxo.
  const [menuAberto, setMenuAberto] = useState(false)
  const valorDoMenu = useMemo(() => ({ abrir: () => setMenuAberto(true) }), [])

  // Navegou: a gaveta fecha. Sem isto, no celular o menu ficaria cobrindo a tela que o
  // toque acabou de abrir.
  useEffect(() => {
    setMenuAberto(false)
  }, [pathname])

  // Modo tela cheia: páginas como Pedidos/PDV escondem a sidebar.
  // O evento pode chegar tarde no load direto (o efeito do filho dispara antes do
  // listener do pai montar), então o PDV é tela cheia por ROTA — não depende do evento.
  useEffect(() => {
    const handler = (e: Event) => setFocusEvent((e as CustomEvent<boolean>).detail)
    window.addEventListener('menuzia:focus-mode', handler as EventListener)
    return () => window.removeEventListener('menuzia:focus-mode', handler as EventListener)
  }, [])

  // Ao trocar de rota, descarta o sinal da página anterior.
  useEffect(() => { setFocusEvent(null) }, [pathname])

  const focusMode = focusEvent !== null ? focusEvent : pathname === '/admin/pdv'

  useEffect(() => {
    let active = true
    ;(async () => {
      const id = await buscarRestauranteIdDoUsuario(supabase)
      if (!active || !id) return

      // Isolado num bloco próprio: se a busca do papel falhar, o menu só fica sem
      // filtro (comportamento de antes). Não pode derrubar config, badges e checklist.
      // Três tentativas: logo depois do login a sessão ainda pode estar sendo gravada, e
      // um soluço aqui deixava o garçom com o menu inteiro do dono até recarregar.
      void (async () => {
        for (let tentativa = 0; tentativa < 3 && active; tentativa++) {
          try {
            const { data } = await supabase.auth.getUser()
            if (!active) return
            if (data.user) {
              // Só colunas liberadas por grant (0062): select('*') em usuarios é recusado.
              const { data: u } = await supabase.from('usuarios').select('papel').eq('id', data.user.id).maybeSingle()
              if (active && u) {
                setPapel(u.papel as string)
                return
              }
            }
          } catch {
            /* tenta de novo; se não der, o menu fica sem filtro e a RLS continua barrando */
          }
          await new Promise((r) => setTimeout(r, 700 * (tentativa + 1)))
        }
      })()

      buscarConfigLoja(supabase, id)
        .then((c) => {
          if (!active || !c) return
          setStoreSlug(c.slug)
          setUsaLogistica(c.usaLogistica)
        })
        .catch(() => {
          /* slug e logística ficam com o padrão; a flag de mesas tem leitura própria */
        })

      try {
        const b = await contarBadgesNav(supabase, id)
        if (active) setBadges(b)
      } catch {
        /* silencioso: badge é informativo */
      }
      if (active) setRestauranteId(id)
    })()
    return () => {
      active = false
    }
  }, [supabase])

  // Flag do módulo de mesas: a MESMA pergunta que o middleware faz ao servidor
  // (`auth_modulo_mesas()`, 0071), e não um campo do select grande de configuração da loja.
  // Antes, qualquer falha naquele select (coluna nova, soluço de rede) escondia o item
  // "Mesas e Comandas" do menu mesmo com o módulo ligado. Relida a cada troca de rota,
  // para o menu aparecer assim que o dono liga o módulo em Ajustes, sem recarregar.
  useEffect(() => {
    let active = true
    ;(async () => {
      for (let tentativa = 0; tentativa < 3 && active; tentativa++) {
        const { data, error } = await supabase.rpc('auth_modulo_mesas')
        if (!active) return
        if (!error) {
          setModuloMesas(data === true)
          return
        }
        await new Promise((r) => setTimeout(r, 700 * (tentativa + 1)))
      }
    })()
    return () => {
      active = false
    }
  }, [supabase, pathname])

  // Checklist de configuração: recarregado a cada troca de rota, que é quando o
  // dono acabou de mexer em Ajustes/Cardápio. Corrigiu, o marcador some sozinho.
  useEffect(() => {
    if (!restauranteId) return
    let active = true
    ;(async () => {
      try {
        const config = await buscarConfigLoja(supabase, restauranteId)
        if (!active || !config) return
        setStoreSlug(config.slug)
        setUsaLogistica(config.usaLogistica)

        const lista = avaliarSetup(await carregarDadosSetup(supabase, restauranteId, config))
        if (!active) return
        setPendencias(lista)
        setAlertaAberto(deveAbrirAlerta(restauranteId, lista, pathname))
      } catch {
        /* silencioso: o checklist é auxiliar e não pode derrubar o painel */
      }
    })()
    return () => {
      active = false
    }
  }, [supabase, restauranteId, pathname])

  // Canal Realtime num effect próprio: o cleanup retornado por uma função
  // async nunca é chamado pelo React, então o canal ficava aberto pra sempre
  // a cada remontagem do layout, vazando conexões Realtime ao longo do turno.
  useEffect(() => {
    if (!restauranteId) return
    const carregar = async () => {
      try {
        const b = await contarBadgesNav(supabase, restauranteId)
        setBadges(b)
      } catch {
        /* silencioso: badge é informativo */
      }
    }
    const channel = supabase
      .channel(`nav-badges-${restauranteId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `restaurante_id=eq.${restauranteId}` }, carregar)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, restauranteId])

  const alertasPorMenu = contarPorMenu(pendencias)

  // Regra do menu (papel × flag de mesas × logística) em lib/menu-lateral.ts, testada.
  const items = itensDoMenu({ papel, moduloMesas, usaLogistica }).map((item) => {
    const alerta = alertasPorMenu[item.href]
    const base = alerta ? { ...item, alerta } : item
    if (item.href === '/admin/pedidos') return { ...base, badge: badges.novosPedidos }
    if (item.href === '/admin/logistica') return { ...base, badge: badges.logisticaPendente }
    return base
  })

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const dispensarAlerta = () => {
    setAlertaAberto(false)
    if (!restauranteId) return
    try {
      localStorage.setItem(chaveDispensa(restauranteId), assinaturaPendencias(pendencias))
    } catch {
      /* navegador sem storage: o modal volta no próximo carregamento, e tudo bem */
    }
  }

  return (
    <MenuLateralContext.Provider value={valorDoMenu}>
    <div className="flex h-screen overflow-hidden">
      {!focusMode && (
        <Sidebar
          items={items}
          activeHref={pathname}
          storeSlug={storeSlug}
          onSignOut={handleSignOut}
          aberta={menuAberto}
          onFechar={() => setMenuAberto(false)}
          // Pendência de configuração é assunto de quem configura a loja. Mostrar "6
          // pendências" ao garçom seria só ruído — ele não tem acesso a Ajustes.
          pendencias={papel === null || pode(papel, 'ajustes.editar') ? pendencias.length : 0}
          onAbrirPendencias={() => setAlertaAberto(true)}
        />
      )}
      {/* `min-w-0`: sem isso o conteúdo largo (tabela, grade de mesas) empurra o flex
          e reaparece a rolagem horizontal que a gaveta veio resolver. */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      {alertaAberto && (
        <SetupAlerta
          pendencias={pendencias}
          onDispensar={dispensarAlerta}
          onResolver={(href) => {
            dispensarAlerta()
            router.push(href)
          }}
        />
      )}
    </div>
    </MenuLateralContext.Provider>
  )
}
