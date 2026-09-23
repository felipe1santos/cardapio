'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ICONES } from '@/lib/icones-painel'
import {
  AJUDA_ESTADO,
  ROTULO_ESTADO,
  chaveMemoria,
  estadoDaPermissao,
  jaAvisado,
  textoDaNotificacao,
  type EstadoNotificacao,
  type PedidoParaAvisar,
} from '@/lib/notificacoes-pedido'

/**
 * Aviso de pedido novo pela notificação do navegador.
 *
 * Nada é pedido ao carregar a página: navegador nenhum gosta disso, e o Chrome
 * bloqueia quem pede permissão sem interação. A permissão só é solicitada no
 * clique do item do menu.
 *
 * O aviso reaproveita o Realtime que o layout JÁ assina para os badges do menu —
 * não há consulta, canal nem gatilho novo. E vale só enquanto o painel estiver
 * aberto em alguma aba: isto NÃO é push de servidor, e a tela diz isso.
 */

/** Guarda o estado da permissão e expõe o pedido, sempre a partir de um clique. */
export function useNotificacoesPedidos() {
  const [estado, setEstado] = useState<EstadoNotificacao>('indisponivel')

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setEstado('indisponivel')
      return
    }
    setEstado(estadoDaPermissao(Notification.permission))
  }, [])

  const pedirPermissao = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    try {
      const r = await Notification.requestPermission()
      setEstado(estadoDaPermissao(r))
    } catch {
      // Alguns navegadores recusam o pedido fora de um gesto reconhecido; o
      // estado fica como está e o item continua clicável.
    }
  }, [])

  return { estado, pedirPermissao }
}

/**
 * Dispara o aviso de um pedido novo, se a permissão existir.
 *
 * Devolve uma função estável para o layout chamar de dentro do callback do
 * Realtime que ele já tem.
 */
export function useAvisarPedido(aoAbrirPedidos: () => void) {
  const abrir = useRef(aoAbrirPedidos)
  abrir.current = aoAbrirPedidos

  return useCallback((pedido: PedidoParaAvisar & { id: string }) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    // Duas abas recebem o mesmo evento: a memória compartilhada decide quem avisa.
    const repetido = jaAvisado(
      pedido.id,
      () => localStorage.getItem(chaveMemoria()),
      (v) => localStorage.setItem(chaveMemoria(), v),
    )
    if (repetido) return

    const { titulo, corpo } = textoDaNotificacao(pedido)
    try {
      const n = new Notification(titulo, {
        body: corpo,
        icon: '/icon-192.png',
        // Mesma tag = o sistema empilha em vez de encher a tela num pico.
        tag: 'menuzia-pedido',
        renotify: true,
      } as NotificationOptions)
      n.onclick = () => {
        window.focus()
        abrir.current()
        n.close()
      }
    } catch {
      /* navegador recusou a notificação: o alarme do Kanban continua valendo */
    }
  }, [])
}

/** Item do menu lateral, com o estado real do navegador. */
export function ItemNotificacoes({ estado, onAtivar }: { estado: EstadoNotificacao; onAtivar: () => void }) {
  const [explicando, setExplicando] = useState(false)
  const caminhos = estado === 'ativas' ? ICONES.sinoAtivo : estado === 'negadas' ? ICONES.sinoMudo : ICONES.sino

  const tom =
    estado === 'ativas'
      ? 'text-[var(--adm-azul-escuro)]'
      : estado === 'negadas'
        ? 'text-[var(--adm-vermelho-texto)]'
        : 'text-[var(--adm-menu-texto)]'

  return (
    <div className="mx-2">
      <button
        type="button"
        onClick={() => {
          if (estado === 'disponivel') {
            onAtivar()
            return
          }
          // Ativado, bloqueado ou indisponível: o clique explica o que está havendo.
          setExplicando((v) => !v)
        }}
        aria-expanded={estado === 'disponivel' ? undefined : explicando}
        className={[
          'flex min-h-[36px] w-full items-center gap-3 border-l-[3px] border-transparent pl-[13px] pr-3 text-left text-[13.5px] font-normal leading-none transition-colors',
          'hover:bg-[var(--adm-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--adm-azul)]',
          tom,
        ].join(' ')}
      >
        <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] flex-shrink-0 fill-current" aria-hidden="true">
          {caminhos.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
        <span className="min-w-0 flex-1 truncate">{ROTULO_ESTADO[estado]}</span>
        {estado === 'ativas' && (
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-status-ready" aria-hidden="true" />
        )}
      </button>

      {explicando && estado !== 'disponivel' && (
        <p className="mb-1 mt-1 rounded-[var(--adm-raio-sm)] bg-[var(--adm-superficie-2)] px-3 py-2 text-[11px] leading-relaxed text-[var(--adm-texto-suave)]">
          {AJUDA_ESTADO[estado]}
          {estado === 'ativas' && (
            <>
              {' '}
              <strong className="font-semibold">Só com o painel aberto:</strong> com o navegador fechado o aviso não
              chega.
            </>
          )}
        </p>
      )}
    </div>
  )
}
