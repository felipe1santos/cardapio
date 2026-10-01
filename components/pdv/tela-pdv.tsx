'use client'

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'

/**
 * Navegação em PILHA do PDV/Mesas/Balcão (2026-10-01, refinada no mesmo dia).
 *
 * Telas de FUNDO (grade de mesas, Lançar itens) ocupam a página; cada `TelaPdv` é uma JANELA
 * por cima, com o fundo visível e escurecido atrás:
 * - janela GRANDE (~90% × 94%, máx. 1200 px; tela cheia no celular): só uma visível por vez —
 *   abrir outra grande esconde a de baixo NA HORA (ela continua montada, invisível), e o Voltar
 *   a mostra exatamente como estava (rolagem, digitação e seleções);
 * - janela PEQUENA (`pequena`, ~480–560 px: Desconto, Taxas, confirmações): abre SOBRE a janela
 *   atual sem escondê-la. Cabeçalho com "← Voltar", o caminho ("Mesa 04 · Comanda 26 › Receber") e o
 * "X", que fecha a pilha inteira (confirma só se alguma tela tiver dado não salvo).
 *
 * Voltar funciona pelo botão, pela tecla Esc e pelo voltar do navegador/Android/gesto: cada
 * tela empilha uma entrada no histórico (`pushState`) e o `popstate` fecha só a do topo.
 * Fechar por código (ação concluída) remove a entrada sem disparar o voltar de outra tela.
 */

// ── gerenciador único (módulo) ───────────────────────────────────────────────
interface Entrada { id: string; voltar: () => void; sujo: () => boolean; porPop: boolean; pequena: boolean }
const pilha: Entrada[] = []
let ignorarPops = 0
let instalado = false

function instalar() {
  if (instalado || typeof window === 'undefined') return
  instalado = true
  window.addEventListener('popstate', () => {
    if (ignorarPops > 0) { ignorarPops--; return }
    const topo = pilha[pilha.length - 1]
    if (!topo) return
    topo.porPop = true
    topo.voltar()
  })
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !pilha.length) return
    // Esc dentro de lista de sugestões/select aberto: deixa o campo tratar primeiro.
    if ((e.target as HTMLElement | null)?.closest?.('[role="combobox"][aria-expanded="true"]')) return
    e.preventDefault()
    window.history.back()
  })
}

// Quem está coberto por uma janela grande muda quando a pilha muda: as telas assinam.
const ouvintes = new Set<() => void>()
function avisar() { ouvintes.forEach((f) => f()) }
function assinar(f: () => void) { ouvintes.add(f); return () => { ouvintes.delete(f) } }
/** Há uma janela GRANDE acima desta na pilha? (a de baixo some enquanto isso) */
function cobertaPorGrande(id: string): boolean {
  const i = pilha.findIndex((x) => x.id === id)
  return i >= 0 && pilha.slice(i + 1).some((x) => !x.pequena)
}

function registrar(e: Entrada) {
  instalar()
  pilha.push(e)
  avisar()
  window.history.pushState({ ...(window.history.state ?? {}), pdvTela: e.id }, '')
}

function desregistrar(id: string) {
  const i = pilha.findIndex((x) => x.id === id)
  if (i < 0) return
  const [e] = pilha.splice(i, 1)
  avisar()
  // Fechada por código (não pelo voltar): tira a entrada do histórico sem fechar outra tela.
  // Várias de uma vez ("fechar tudo") viram UM history.go(-n) — um popstate só, ignorado.
  if (!e.porPop) {
    pendentesVoltar.add(e.id)
    if (pendentesVoltar.size === 1) {
      setTimeout(() => {
        const ids = pendentesVoltar
        pendentesVoltar = new Set()
        // Fechou porque a página mudou (ex.: "Voltar às mesas" navega): a entrada do
        // histórico já não é a da tela — voltar agora desfaria a navegação.
        if (saindoDaPagina || !ids.has(window.history.state?.pdvTela)) return
        ignorarPops++
        window.history.go(-ids.size)
      }, 0)
    }
  }
}
let pendentesVoltar = new Set<string>()
let saindoDaPagina = false

/**
 * Chame ANTES de trocar de página com telas abertas (router.push): a navegação do Next é
 * assíncrona, e o voltar do histórico que limpa as telas fechadas a desfaria.
 */
export function saindoDaPilha() {
  saindoDaPagina = true
  setTimeout(() => { saindoDaPagina = false }, 3000)
}

/** Alguma tela da pilha tem dado digitado e não salvo? */
export function pilhaTemSujo(): boolean {
  return pilha.some((x) => x.sujo())
}

// ── contexto: caminho e "fechar tudo" ───────────────────────────────────────
interface CtxPilha { caminho: string[]; fecharTudo: (() => void) | null }
const PilhaContext = createContext<CtxPilha>({ caminho: [], fecharTudo: null })

/** Raiz de uma pilha (ex.: a conta aberta a partir do PDV). `fecharTudo` volta à tela base. */
export function RaizPilha({ caminho = [], fecharTudo, children }: { caminho?: string[]; fecharTudo: () => void; children: React.ReactNode }) {
  return <PilhaContext.Provider value={{ caminho, fecharTudo }}>{children}</PilhaContext.Provider>
}

/** Continua o caminho para as telas abertas a partir desta (ex.: a conta → Receber). */
export function CaminhoPilha({ trecho, children }: { trecho: string; children: React.ReactNode }) {
  const pai = useContext(PilhaContext)
  return <PilhaContext.Provider value={{ ...pai, caminho: [...pai.caminho, trecho] }}>{children}</PilhaContext.Provider>
}

const ICONE_VOLTAR = 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z'
const ICONE_X = 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'

export function TelaPdv({
  titulo,
  onVoltar,
  rodape,
  children,
  sujo = false,
  testid,
  semVoltar = false,
  larguraMax = 1200,
  comoFormulario,
  livre = false,
  coluna = false,
  papel = 'dialog',
  pequena = false,
}: {
  titulo: string
  /** Fecha esta tela e mostra a de trás. */
  onVoltar: () => void
  /** Barra de ações fixa embaixo (nunca precisa rolar para achar o botão principal). */
  rodape?: React.ReactNode
  children: React.ReactNode
  /** Há dado digitado e não salvo (o "X" pede confirmação). */
  sujo?: boolean
  testid?: string
  /** Tela base de uma pilha (sem tela atrás): o botão vira só "X". */
  semVoltar?: boolean
  larguraMax?: number
  /** Envolve conteúdo + rodapé num <form> (Enter envia). */
  comoFormulario?: (e: React.FormEvent) => void
  /**
   * Conteúdo já dividido em "corpo + linha de botões" (molduras antigas): o primeiro filho
   * rola e ocupa o espaço; o último fica preso embaixo, com botões de toque (56 px).
   */
  livre?: boolean
  /** Conteúdo já em coluna (cabeçalho + corpo com rolagem + rodapé): só aumenta os botões do rodapé. */
  coluna?: boolean
  /** "alertdialog" para telas que só pedem confirmação. */
  papel?: 'dialog' | 'alertdialog'
  /** Janela pequena (~480–560 px) que abre SOBRE a atual sem escondê-la (Desconto, Taxas, confirmações). */
  pequena?: boolean
}) {
  const id = useId()
  const ctx = useContext(PilhaContext)
  const voltarRef = useRef(onVoltar)
  voltarRef.current = onVoltar
  const sujoRef = useRef(sujo)
  sujoRef.current = sujo
  const [confirmarFechar, setConfirmarFechar] = useState(false)

  useEffect(() => {
    const e: Entrada = { id, voltar: () => voltarRef.current(), sujo: () => sujoRef.current, porPop: false, pequena }
    registrar(e)
    return () => desregistrar(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  // Coberta por outra janela grande: some na hora (continua montada, estado preservado).
  const coberta = useSyncExternalStore(assinar, () => cobertaPorGrande(id), () => false)

  const voltar = useCallback(() => {
    // Pelo histórico: o popstate fecha esta tela (mantém o voltar do navegador em dia).
    if (typeof window !== 'undefined' && window.history.state?.pdvTela === id) window.history.back()
    else voltarRef.current()
  }, [id])

  const fecharTudo = useCallback(() => {
    if (pilhaTemSujo()) { setConfirmarFechar(true); return }
    ;(ctx.fecharTudo ?? voltarRef.current)()
  }, [ctx.fecharTudo])

  const caminho = [...ctx.caminho, titulo]
  const corpo = coluna ? (
    <div className="tela-pdv-coluna flex min-h-0 flex-1 flex-col" data-tela-conteudo>{children}</div>
  ) : livre ? (
    <div className="tela-pdv-livre flex min-h-0 flex-1 flex-col" data-tela-conteudo>{children}</div>
  ) : (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto" data-tela-conteudo>{children}</div>
      {rodape && <div className="flex-shrink-0 border-t border-border bg-white px-4 py-3" data-tela-rodape>{rodape}</div>}
    </>
  )

  return (
    <div
      className={['tela-pdv fixed inset-0 z-[60] flex justify-center sm:items-center sm:p-[3vh]',
        // Fundo visível e escurecido; a pequena escurece menos (a janela de trás continua à vista).
        pequena ? 'items-end bg-black/30 sm:items-center' : 'items-stretch bg-black/50',
        coberta ? 'invisible' : ''].join(' ')}
      aria-hidden={coberta || undefined}
      data-coberta={coberta ? '' : undefined}
      data-tamanho={pequena ? 'pequena' : 'grande'}
      role={papel}
      aria-modal="true"
      aria-label={caminho.join(' › ')}
      data-testid={testid}
      data-tela-pdv
    >
      <div
        className={['tela-pdv-painel relative flex w-full flex-col overflow-hidden bg-white shadow-xl sm:rounded-menuzia sm:border sm:border-border',
          pequena ? 'max-h-[92vh] rounded-t-[12px] sm:max-h-[90vh]' : 'h-full sm:h-[94vh] sm:max-h-[94vh]'].join(' ')}
        style={{ maxWidth: pequena ? Math.min(larguraMax, 560) : larguraMax }}
      >
        <header className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
          {!semVoltar && (
            <button type="button" onClick={voltar} aria-label="Voltar" data-testid="tela-voltar"
              className="flex h-[48px] flex-shrink-0 items-center gap-1.5 rounded-menuzia border border-border bg-white px-3 text-[14px] font-semibold text-text-main hover:border-primary hover:text-primary active:scale-[0.97]">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden><path d={ICONE_VOLTAR} /></svg>
              Voltar
            </button>
          )}
          <nav className="min-w-0 flex-1 px-1" aria-label="Caminho">
            {caminho.length > 1 && (
              <p className="truncate text-[12px] font-medium text-text-subtle" data-testid="tela-caminho">{caminho.slice(0, -1).join(' › ')} ›</p>
            )}
            <h2 className="truncate text-[17px] font-bold leading-tight text-text-main" data-testid="tela-titulo">{titulo}</h2>
          </nav>
          <button type="button" onClick={fecharTudo} aria-label="Fechar" data-testid="tela-fechar-tudo"
            className="flex h-[48px] w-[48px] flex-shrink-0 items-center justify-center rounded-menuzia border border-border bg-white text-text-subtle hover:text-text-main active:scale-[0.97]">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden><path d={ICONE_X} /></svg>
          </button>
        </header>
        {comoFormulario ? (
          <form onSubmit={comoFormulario} noValidate className="flex min-h-0 flex-1 flex-col">{corpo}</form>
        ) : corpo}

        {/* Confirmação DENTRO da própria tela (nada de modal por cima). */}
        {confirmarFechar && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/95 p-6" role="alertdialog" aria-label="Descartar" data-testid="tela-confirmar-fechar">
            <div className="w-full max-w-md text-center">
              <p className="text-[17px] font-bold text-text-main">Descartar o que não foi salvo?</p>
              <p className="mt-1 text-[13px] text-text-subtle">O que foi digitado nesta tela será perdido.</p>
              <div className="mt-5 flex gap-2">
                <button type="button" onClick={() => setConfirmarFechar(false)} className="flex h-[56px] flex-1 items-center justify-center gap-2 rounded-menuzia border border-border text-[15px] font-semibold text-text-main">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden><path d={ICONE_VOLTAR} /></svg>
                  Continuar aqui
                </button>
                <button type="button" onClick={() => { setConfirmarFechar(false); (ctx.fecharTudo ?? voltarRef.current)() }} className="flex h-[56px] flex-1 items-center justify-center gap-2 rounded-menuzia bg-danger text-[15px] font-bold text-white" data-testid="tela-descartar">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden><path d={ICONE_X} /></svg>
                  Descartar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Botão padrão das telas do PDV: ícone + texto, alvo de toque grande. */
export function BotaoPdv({
  icone, children, onClick, tipo = 'secundario', disabled, testid, type = 'button', className = '', title,
}: {
  icone?: string
  children: React.ReactNode
  onClick?: () => void
  tipo?: 'principal' | 'secundario' | 'perigo' | 'sucesso'
  disabled?: boolean
  testid?: string
  type?: 'button' | 'submit'
  className?: string
  title?: string
}) {
  const estilo = {
    principal: 'bg-primary text-white hover:bg-primary-dark border-primary',
    sucesso: 'bg-status-ready text-white hover:brightness-95 border-status-ready',
    secundario: 'bg-white text-text-main border-border hover:border-primary hover:text-primary',
    perigo: 'bg-white text-danger border-danger/50 hover:bg-danger-bg',
  }[tipo]
  return (
    <button type={type} onClick={onClick} disabled={disabled} data-testid={testid} title={title}
      className={['flex min-h-[56px] items-center justify-center gap-2 rounded-menuzia border px-4 text-[15px] font-bold transition-all active:scale-[0.98] disabled:opacity-50', estilo, className].join(' ')}>
      {icone && <svg viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0 fill-current" aria-hidden><path d={icone} /></svg>}
      <span>{children}</span>
    </button>
  )
}

/** Ícones de linha do PDV (mesmo estilo e tamanho em todas as telas). */
export const ICONES_PDV = {
  voltar: ICONE_VOLTAR,
  fechar: ICONE_X,
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  checkDuplo: 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41 6 19l1.41-1.41L1.83 12 .41 13.41z',
  receber: 'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z',
  mais: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  pessoa: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  alerta: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  cozinha: 'M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67z',
  salvar: 'M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z',
  porcento: 'M7.5 4C5.57 4 4 5.57 4 7.5S5.57 11 7.5 11 11 9.43 11 7.5 9.43 4 7.5 4zm9 9c-1.93 0-3.5 1.57-3.5 3.5s1.57 3.5 3.5 3.5 3.5-1.57 3.5-3.5-1.57-3.5-3.5-3.5zM5.41 20 4 18.59 18.59 4 20 5.41 5.41 20z',
} as const

/**
 * Aviso rápido depois de uma ação que FECHA a pilha (ex.: conta fechada → volta às mesas).
 * Vai direto no <body>: sobrevive à troca de rota e não depende de a tela de destino
 * montar um componente de aviso. Mesmo visual dos avisos do painel.
 */
export function toastPdv(texto: string) {
  if (typeof document === 'undefined') return
  const el = document.createElement('p')
  el.setAttribute('role', 'status')
  el.dataset.testid = 'toast-pdv'
  el.className = 'pointer-events-none fixed inset-x-0 bottom-6 z-[70] mx-auto w-fit max-w-[min(520px,calc(100vw-32px))] rounded-[10px] bg-sidebar-bg px-4 py-3 text-center text-[14px] font-semibold text-white shadow-[0_8px_24px_rgba(15,23,42,0.18)]'
  el.textContent = texto
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4200)
}

/** Texto do aviso ao concluir o encerramento da conta. */
export function textoEncerramento(acao: 'fechada' | 'cancelada', titulo: string, pago: number) {
  const valor = pago.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return acao === 'fechada' ? `Conta fechada · ${titulo} · ${valor}` : `Conta cancelada · ${titulo}`
}
