'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarStatusAgente } from '@/lib/queries/impressao'
import { ICONES } from '@/lib/icones-painel'
import { ROTULO_IMPRESSORA, estadoDaImpressora, linkDoSuporte, type EstadoImpressora } from '@/lib/suporte'

/**
 * Ações fixas do canto superior direito do painel: estado da impressão, botão
 * de suporte e conta.
 *
 * Ficam na barra de topo, e não dentro de cada tela, porque valem para o painel
 * inteiro — e porque é lá que a referência de layout as coloca. O estado da
 * impressora é o que mais justifica o lugar: a loja precisa perceber que o
 * assistente caiu ANTES de perder um pedido, esteja ela em qualquer tela.
 */
export function AcoesTopo() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const router = useRouter()
  const [impressora, setImpressora] = useState<EstadoImpressora>('sem-agente')
  const [email, setEmail] = useState<string | null>(null)
  const [nomeLoja, setNomeLoja] = useState<string | null>(null)
  const [menuAberto, setMenuAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let ativo = true
    ;(async () => {
      try {
        const { data } = await supabase.auth.getUser()
        if (ativo) setEmail(data.user?.email ?? null)
      } catch {
        /* sessão indisponível: o menu de conta mostra só o Sair */
      }
      try {
        const id = await buscarRestauranteIdDoUsuario(supabase)
        if (!id || !ativo) return
        const status = await buscarStatusAgente(supabase, id)
        if (ativo) setImpressora(estadoDaImpressora(status, Date.now()))
      } catch {
        /* silencioso: é um indicador, não pode derrubar a barra de topo */
      }
    })()
    return () => {
      ativo = false
    }
  }, [supabase])

  useEffect(() => {
    try {
      const guardado = localStorage.getItem('menuzia:nome-loja')
      if (guardado) setNomeLoja(guardado)
    } catch {
      /* armazenamento bloqueado: a mensagem do suporte vai sem o nome */
    }
  }, [])

  useEffect(() => {
    if (!menuAberto) return
    const aoClicar = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setMenuAberto(false)
    }
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuAberto(false)
    }
    window.addEventListener('mousedown', aoClicar)
    window.addEventListener('keydown', aoTeclar)
    return () => {
      window.removeEventListener('mousedown', aoClicar)
      window.removeEventListener('keydown', aoTeclar)
    }
  }, [menuAberto])

  const tomImpressora =
    impressora === 'conectada' ? 'text-[var(--adm-alta)]' : impressora === 'desconectada' ? 'text-[var(--adm-vermelho-texto)]' : 'text-[var(--adm-texto-suave)]'

  return (
    <div className="flex flex-shrink-0 items-center gap-1.5">
      {/* Impressão: atalho para a configuração, com o estado na própria cor. */}
      <button
        type="button"
        onClick={() => router.push('/admin/ajustes?aba=impressao')}
        title={ROTULO_IMPRESSORA[impressora]}
        aria-label={ROTULO_IMPRESSORA[impressora]}
        className={`flex h-[36px] w-[36px] items-center justify-center rounded-[4.8px] transition-colors hover:bg-[var(--adm-hover)] ${tomImpressora}`}
      >
        <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current" aria-hidden="true">
          {(impressora === 'conectada' ? ICONES.impressoraOk : ICONES.impressoraOff).map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </button>

      {/* Suporte: laranja, o mesmo destaque que a referência dá ao "Dúvidas?". */}
      <a
        href={linkDoSuporte(nomeLoja)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-[36px] items-center gap-1.5 rounded-[4.8px] border-[0.8px] border-[#f3c38a] bg-[var(--adm-laranja-claro)] px-3 text-[12.8px] font-bold text-[var(--adm-laranja)] transition-colors hover:bg-[#ffedd5]"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current" aria-hidden="true">
          {ICONES.suporte.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
        <span className="hidden sm:inline">Dúvidas?</span>
      </a>

      {/* Conta. */}
      <div ref={caixa} className="relative">
        <button
          type="button"
          onClick={() => setMenuAberto((v) => !v)}
          aria-expanded={menuAberto}
          aria-label="Minha conta"
          className="flex h-[36px] w-[36px] items-center justify-center rounded-[4.8px] text-[var(--adm-texto-medio)] transition-colors hover:bg-[var(--adm-hover)]"
        >
          <svg viewBox="0 0 24 24" className="h-[24px] w-[24px] fill-current" aria-hidden="true">
            {ICONES.perfil.map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
        </button>

        {menuAberto && (
          <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-[230px] overflow-hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white shadow-[0_8px_24px_rgba(16,24,40,0.12)]">
            <p className="truncate border-b border-[var(--adm-borda)] px-3.5 py-2.5 text-[12px] text-[var(--adm-texto-suave)]">
              {email ?? 'Sessão ativa'}
            </p>
            <button
              type="button"
              onClick={() => {
                setMenuAberto(false)
                router.push('/admin/ajustes')
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12.8px] text-[var(--adm-texto)] transition-colors hover:bg-[var(--adm-hover)]"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-[var(--adm-texto-suave)]" aria-hidden="true">
                {ICONES.ajustes.map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
              Ajustes da loja
            </button>
            <button
              type="button"
              onClick={async () => {
                setMenuAberto(false)
                await supabase.auth.signOut()
                router.push('/login')
              }}
              className="flex w-full items-center gap-2.5 border-t border-[var(--adm-borda)] px-3.5 py-2.5 text-left text-[12.8px] text-[var(--adm-texto)] transition-colors hover:bg-[var(--adm-hover)]"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-[var(--adm-texto-suave)]" aria-hidden="true">
                {ICONES.sair.map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
              Sair
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
