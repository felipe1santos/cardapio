'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarStatusAgente } from '@/lib/queries/impressao'
import { ICONES } from '@/lib/icones-painel'
import { ROTULO_IMPRESSORA, estadoDaImpressora, type EstadoImpressora } from '@/lib/suporte'
import { ModalSuporte } from '@/components/admin/modal-suporte'
import { ModalMeuPin } from '@/components/admin/modal-meu-pin'
import { AvisoCaixa } from '@/components/financeiro/aviso-caixa'
import { pedirTrava, sairDoPainel, useEstadoSessao } from '@/lib/sessao-cliente'
import { Dica, Flutuante } from '@/components/ui/flutuante'

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
  // Assistente novo (tela v2): nome da impressora da Cozinha (apelido) no rótulo do botão.
  const [rotuloBeta, setRotuloBeta] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  // Quem pede ajuda (modal de suporte): loja, nome exibido e perfil.
  const [suporteAberto, setSuporteAberto] = useState(false)
  const [quem, setQuem] = useState<{ loja: string | null; usuario: string | null; papel: string | null }>({ loja: null, usuario: null, papel: null })
  const [menuAberto, setMenuAberto] = useState(false)
  const [pinAberto, setPinAberto] = useState(false)
  // Financeiro ligado (0132): PIN pessoal, travar a tela e trocar de operador.
  const sessao = useEstadoSessao()
  const botaoConta = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let ativo = true
    ;(async () => {
      try {
        const { data } = await supabase.auth.getUser()
        if (ativo) setEmail(data.user?.email ?? null)
        // Quem pede ajuda (modal de suporte): carregado já na montagem, para a mensagem
        // não sair com "—" se a pessoa abrir e enviar antes da consulta voltar.
        // Só colunas liberadas por grant (0062). Falhou: a mensagem vai com "—".
        if (data.user) {
          const { data: u } = await supabase.from('usuarios').select('nome, papel, restaurante_id').eq('id', data.user.id).maybeSingle()
          let loja: string | null = null
          if (u?.restaurante_id) {
            const { data: r } = await supabase.from('restaurantes').select('nome').eq('id', u.restaurante_id).maybeSingle()
            loja = (r?.nome as string | undefined) ?? null
          }
          if (ativo) setQuem({ loja, usuario: (u?.nome as string | undefined) ?? null, papel: (u?.papel as string | undefined) ?? null })
        }
      } catch {
        /* sessão indisponível: o menu de conta mostra só o Sair; o suporte vai com "—" */
      }
      try {
        const id = await buscarRestauranteIdDoUsuario(supabase)
        if (!id || !ativo) return
        const status = await buscarStatusAgente(supabase, id)
        if (ativo) setImpressora(estadoDaImpressora(status, Date.now()))
        const r = await fetch('/api/admin/impressao/resumo', { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null) as { beta: boolean; cozinha: string | null; online: boolean } | null
        if (ativo && r?.beta) {
          setImpressora(r.online && r.cozinha ? 'conectada' : 'desconectada')
          setRotuloBeta(r.online && r.cozinha ? `Impressão automática ligada — Cozinha: ${r.cozinha}` : r.cozinha ? `Impressora da Cozinha (${r.cozinha}) sem sinal` : 'Escolha a impressora da Cozinha')
        }
      } catch {
        /* silencioso: é um indicador, não pode derrubar a barra de topo */
      }
    })()
    return () => {
      ativo = false
    }
  }, [supabase])


  const fecharMenu = useCallback(() => setMenuAberto(false), [])

  const tomImpressora =
    impressora === 'conectada' ? 'text-[var(--adm-alta)]' : impressora === 'desconectada' ? 'text-[var(--adm-vermelho-texto)]' : 'text-[var(--adm-texto-suave)]'

  // Mesma altura de toda a barra (36 px no celular, 44 px no resto).
  const QUADRADO = 'flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-[4px] transition-colors sm:h-[44px] sm:w-[44px]'

  return (
    <div className="flex flex-shrink-0 items-center gap-[4px] sm:gap-2" data-testid="acoes-topo">
      {sessao?.financeiroAtivo && <AvisoCaixa />}
      {/* Impressão: atalho para a configuração, com o estado na própria cor. */}
      <Dica texto={rotuloBeta ?? ROTULO_IMPRESSORA[impressora]}>
        <button
          type="button"
          onClick={() => router.push('/admin/impressao')}
          aria-label={rotuloBeta ?? ROTULO_IMPRESSORA[impressora]}
          data-testid="topo-impressora"
          className={`${QUADRADO} hover:bg-[var(--adm-hover)] ${tomImpressora}`}
        >
          <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current" aria-hidden="true">
            {(impressora === 'conectada' ? ICONES.impressoraOk : ICONES.impressoraOff).map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
        </button>
      </Dica>

      {/* Suporte: laranja vivo com texto branco (regra das cores vivas, contraste ≥ 4,5:1). */}
      <Dica texto="Dúvidas? Falar com o suporte">
        <button
          type="button"
          onClick={() => setSuporteAberto(true)}
          aria-haspopup="dialog"
          aria-label="Dúvidas? Falar com o suporte"
          data-testid="topo-duvidas"
          className="flex h-[36px] min-w-[36px] flex-shrink-0 items-center justify-center gap-1.5 rounded-[4px] bg-[#C2410C] px-2 text-[12.8px] font-semibold text-white transition-[filter] hover:brightness-110 sm:h-[44px] sm:px-3"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current" aria-hidden="true">
            {ICONES.suporte.map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
          <span className="hidden whitespace-nowrap xl:inline">Dúvidas?</span>
        </button>
      </Dica>
      {pinAberto && <ModalMeuPin temPin={!!sessao?.temPin} onFechar={() => setPinAberto(false)} />}
      <ModalSuporte aberto={suporteAberto} onFechar={() => setSuporteAberto(false)} loja={quem.loja} usuario={quem.usuario} papel={quem.papel} />

      {/* Conta: o menu abre por cima de tudo (portal), nunca cortado. */}
      <Dica texto="Minha conta">
        <button
          ref={botaoConta}
          type="button"
          onClick={() => setMenuAberto((v) => !v)}
          aria-expanded={menuAberto}
          aria-haspopup="menu"
          aria-label="Minha conta"
          data-testid="topo-conta"
          className={`${QUADRADO} text-[var(--adm-texto-medio)] hover:bg-[var(--adm-hover)]`}
        >
          <svg viewBox="0 0 24 24" className="h-[24px] w-[24px] fill-current" aria-hidden="true">
            {ICONES.perfil.map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
        </button>
      </Dica>
      <Flutuante ancora={botaoConta} aberto={menuAberto} onFechar={fecharMenu} largura={230} testid="topo-conta-menu" rotulo="Minha conta">
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
        {sessao?.financeiroAtivo && (
          <>
            <button type="button" data-testid="menu-meu-pin"
              onClick={() => { setMenuAberto(false); setPinAberto(true) }}
              className="flex w-full items-center gap-2.5 border-t border-[var(--adm-borda)] px-3.5 py-2.5 text-left text-[12.8px] text-[var(--adm-texto)] transition-colors hover:bg-[var(--adm-hover)]">
              {sessao.temPin ? 'Trocar meu PIN' : 'Criar meu PIN'}
            </button>
            {sessao.temPin && (
              <button type="button" data-testid="menu-bloquear"
                onClick={() => { setMenuAberto(false); pedirTrava('travar') }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12.8px] text-[var(--adm-texto)] transition-colors hover:bg-[var(--adm-hover)]">
                Bloquear tela
              </button>
            )}
            <button type="button" data-testid="menu-trocar-operador"
              onClick={() => { setMenuAberto(false); pedirTrava('trocar') }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[12.8px] text-[var(--adm-texto)] transition-colors hover:bg-[var(--adm-hover)]">
              Trocar operador
            </button>
          </>
        )}
        <button
          type="button"
          onClick={async () => {
            setMenuAberto(false)
            if (await sairDoPainel(supabase)) router.push('/login')
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
      </Flutuante>
    </div>
  )
}
