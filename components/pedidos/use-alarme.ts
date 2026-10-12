'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DURACAO_TOQUE_SEG, pedidosParaTocar, reivindicarToque, type MotivoFalhaSom } from '@/lib/alarme-pedidos'

/**
 * Alarme de pedido novo do painel (2026-10-03; desde 2026-10-04 vive no layout, em toda tela —
 * components/admin/alarme-global.tsx).
 *
 *
 * - mp3 decodificado no Web Audio. 12/10 (pedido do dono): cada pedido novo toca UMA vez, ~8 s (o mp3 de 2 s em
 *   repetição até o prazo), e para sozinho; vários pedidos juntos = um toque só; toque novo com som tocando recomeça o
 *   mesmo som (nunca dois por cima). Sem repetição e sem precisar aceitar para parar.
 * - Navegador bloqueou o som (painel aberto sem clique): `bloqueado = true` → a tela mostra o
 *   aviso clicável; qualquer clique/tecla destrava e toca o que estava esperando.
 * - Toca TODO pedido "recebido" que ainda não tocou nesta aba (tempo real, poll, reconexão ou
 *   o que já esperava quando a página abriu).
 * - Aba escondida: a notificação do navegador sai do layout do painel (notificacoes-pedidos).
 *   Wake Lock: a tela não dorme.
 * - Várias abas: só uma toca cada pedido (lib/alarme-pedidos.ts › reivindicarToque).
 * - Falha de reprodução vai para o log do servidor com o motivo.
 *
 * `window.__mzAlarme` expõe contadores para os testes automáticos (sem efeito na tela).
 */
const SOM_SRC = '/sounds/som-telefone-alarme.mp3'
const CHAVE_SOM = 'menuzia:kanban-som'

type Estado = { tocou: number; falhas: Partial<Record<MotivoFalhaSom, number>>; bloqueado: boolean; ultimoMotivo: string | null }
declare global { interface Window { __mzAlarme?: Estado } }

const idDaAba = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()))
const armazenamento = () => { try { return window.localStorage } catch { return null } }

/**
 * `mudo` (12/10): o Assistente da loja está ONLINE e tocando o alarme — o painel fica só visual (um alarme só). Os
 * pedidos continuam sendo marcados como "já tocou"; voltou a false com pedido esperando → o painel toca na hora.
 */
export function useAlarmePedidos({ ativo = true, mudo = false }: { ativo?: boolean; mudo?: boolean } = {}) {
  const [somAtivo, setSomAtivoEstado] = useState(true)
  const [bloqueado, setBloqueado] = useState(false)
  /** Som saindo agora (o toque de ~8 s); o botão "silenciar" corta. */
  const [tocando, setTocando] = useState(false)
  const [permissaoNotif, setPermissaoNotif] = useState<NotificationPermission | 'sem_suporte'>('default')
  const somRef = useRef(true)
  const ctxRef = useRef<AudioContext | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  /** O toque em andamento (no máximo um). */
  const fonteRef = useRef<AudioBufferSourceNode | null>(null)
  const tocadosRef = useRef<Set<string>>(new Set())
  const pendentesRef = useRef<{ id: string; numero: number }[]>([])
  const abaRef = useRef<string>('')
  const logadoRef = useRef<Map<string, number>>(new Map())
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null)
  /** Liberou o áudio (clique ou o próprio navegador): toca na hora o que esperava. */
  const aoLiberarRef = useRef<() => void>(() => {})
  const mudoRef = useRef(mudo)

  const estado = (): Estado => {
    if (!window.__mzAlarme) window.__mzAlarme = { tocou: 0, falhas: {}, bloqueado: false, ultimoMotivo: null }
    return window.__mzAlarme
  }

  /** Falha vai para o log do servidor (no máximo 1 por motivo a cada 5 min por aba). */
  const registrarFalha = useCallback((motivo: MotivoFalhaSom, detalhe?: string) => {
    const e = estado()
    e.falhas[motivo] = (e.falhas[motivo] ?? 0) + 1
    e.ultimoMotivo = motivo
    const agora = Date.now()
    if (agora - (logadoRef.current.get(motivo) ?? 0) < 5 * 60_000) return
    logadoRef.current.set(motivo, agora)
    void fetch('/api/admin/pedidos/som-falha', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ motivo, detalhe: (detalhe ?? '').slice(0, 200), visivel: document.visibilityState, navegador: navigator.userAgent.slice(0, 160) }),
    }).catch(() => {})
  }, [])

  // Preferências e contexto de áudio (criado já na abertura: decodificar não precisa de clique).
  useEffect(() => {
    abaRef.current = idDaAba()
    const s = armazenamento()
    const som = s?.getItem(CHAVE_SOM) !== '0'
    somRef.current = som; setSomAtivoEstado(som)
    setPermissaoNotif(typeof Notification === 'undefined' ? 'sem_suporte' : Notification.permission)
    // Sem acesso ao Painel de Pedidos (ex.: garçom): nada de áudio nem aviso de bloqueio.
    if (!ativo) return
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) { registrarFalha('sem_web_audio'); return }
    const ctx = new Ctx()
    ctxRef.current = ctx
    let antes = ctx.state
    const atualizar = () => {
      const b = ctx.state !== 'running'
      estado().bloqueado = b; setBloqueado(b)
      if (antes !== 'running' && ctx.state === 'running') aoLiberarRef.current()
      antes = ctx.state
    }
    ctx.onstatechange = atualizar
    // Quem já clicou neste site nesta aba (ex.: no login) tem o áudio liberado sem novo clique:
    // tenta já e só decide depois (o contexto nasce "suspended" por um instante — o aviso piscava).
    const espera = window.setTimeout(atualizar, 400)
    void ctx.resume().then(() => { window.clearTimeout(espera); atualizar() }).catch(() => {})
    fetch(SOM_SRC).then((r) => r.arrayBuffer()).then((ab) => ctx.decodeAudioData(ab)).then((buf) => { bufferRef.current = buf })
      .catch((err) => registrarFalha('arquivo_indisponivel', String(err)))
    return () => { ctx.onstatechange = null; void ctx.close().catch(() => {}); ctxRef.current = null; estado().bloqueado = false; setBloqueado(false) }
  }, [registrarFalha, ativo])

  /** Corta o toque em andamento. */
  const pararSom = useCallback(() => {
    const f = fonteRef.current
    fonteRef.current = null
    if (f) try { f.stop() } catch { /* já parou */ }
    setTocando(false)
  }, [])

  /** Um toque de ~8 s (o mp3 em repetição até o prazo). Com som tocando, recomeça o mesmo (não empilha). Devolve se saiu som. */
  const tocarUmaVez = useCallback((): boolean => {
    const ctx = ctxRef.current
    if (!ctx) return false
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {})
      registrarFalha('autoplay_bloqueado', `estado ${ctx.state}`)
      return false
    }
    try {
      if (bufferRef.current) {
        pararSom()
        const src = ctx.createBufferSource()
        src.buffer = bufferRef.current
        src.loop = true
        const ganho = ctx.createGain(); ganho.gain.value = 1
        src.connect(ganho); ganho.connect(ctx.destination)
        src.start()
        src.stop(ctx.currentTime + DURACAO_TOQUE_SEG)
        fonteRef.current = src
        setTocando(true)
        src.onended = () => { src.disconnect(); ganho.disconnect(); if (fonteRef.current === src) { fonteRef.current = null; setTocando(false) } }
      } else {
        // mp3 ainda não decodificado (ou indisponível): 3 bipes sintetizados.
        for (const [f, t] of [[880, 0], [1175, 0.2], [880, 0.4]] as const) {
          const t0 = ctx.currentTime + t
          const osc = ctx.createOscillator(); const g = ctx.createGain()
          osc.type = 'square'; osc.frequency.setValueAtTime(f, t0)
          g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.85, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16)
          osc.connect(g); g.connect(ctx.destination); osc.start(t0); osc.stop(t0 + 0.18)
        }
      }
      estado().tocou++
      return true
    } catch (err) {
      registrarFalha('erro_reproducao', String(err))
      return false
    }
  }, [registrarFalha, pararSom])

  /**
   * Chamado a cada leitura dos pedidos (tempo real, poll, reconexão). Toca UMA vez para o lote de
   * pedidos recebidos que ainda não tocaram nesta aba (dois juntos = um toque só).
   */
  const aoAtualizarPedidos = useCallback((recebidos: { id: string; numero: number }[]) => {
    pendentesRef.current = recebidos
    const ids = new Set(recebidos.map((p) => p.id))
    for (const id of [...tocadosRef.current]) if (!ids.has(id)) tocadosRef.current.delete(id)
    const novos = pedidosParaTocar(ids, tocadosRef.current)
    if (!novos.length) return
    for (const id of novos) tocadosRef.current.add(id)
    if (!somRef.current || mudoRef.current) return
    const s = armazenamento()
    const meus = novos.filter((id) => reivindicarToque(`menuzia:alarme:${id}`, abaRef.current, Date.now(), s))
    if (meus.length) tocarUmaVez()
    // A notificação do navegador (aba escondida) já sai do layout do painel para todo pedido
    // novo (components/admin/notificacoes-pedidos.tsx) — aqui não repete.
  }, [tocarUmaVez])

  // Assistente saiu do ar (ou voltou): a troca é imediata — saiu com pedido esperando, o painel toca já (uma vez).
  useEffect(() => {
    const era = mudoRef.current
    mudoRef.current = mudo
    if (era && !mudo && somRef.current && pendentesRef.current.length) tocarUmaVez()
  }, [mudo, tocarUmaVez])

  aoLiberarRef.current = () => {
    if (!mudoRef.current && somRef.current && pendentesRef.current.length) tocarUmaVez()
  }

  // Destrave: qualquer interação libera o áudio; a mudança de estado toca o que esperava.
  useEffect(() => {
    const destravar = () => {
      const ctx = ctxRef.current
      if (!ctx || ctx.state === 'running') return
      void ctx.resume().catch(() => {})
    }
    window.addEventListener('pointerdown', destravar)
    window.addEventListener('keydown', destravar)
    return () => { window.removeEventListener('pointerdown', destravar); window.removeEventListener('keydown', destravar) }
  }, [tocarUmaVez])

  // Wake Lock: com o painel visível, a tela não apaga.
  useEffect(() => {
    if (!ativo) return
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    if (!nav.wakeLock) return
    const pedir = () => {
      if (document.visibilityState !== 'visible' || wakeRef.current) return
      nav.wakeLock!.request('screen').then((w) => { wakeRef.current = w; (w as unknown as EventTarget).addEventListener?.('release', () => { wakeRef.current = null }) }).catch(() => {})
    }
    pedir()
    const vis = () => { if (document.visibilityState === 'visible') pedir() }
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('pointerdown', pedir)
    return () => {
      document.removeEventListener('visibilitychange', vis); window.removeEventListener('pointerdown', pedir)
      void wakeRef.current?.release().catch(() => {}); wakeRef.current = null
    }
  }, [ativo])

  const setSomAtivo = useCallback((v: boolean) => {
    somRef.current = v; setSomAtivoEstado(v)
    try { localStorage.setItem(CHAVE_SOM, v ? '1' : '0') } catch { /* sem storage */ }
    if (v) void ctxRef.current?.resume().catch(() => {})
    else pararSom()
  }, [pararSom])

  /** "Testar som" e o aviso clicável: o próprio clique libera o áudio. */
  const testar = useCallback(async () => {
    const ctx = ctxRef.current
    if (ctx && ctx.state !== 'running') {
      await ctx.resume().catch(() => {})
      // A liberação já tocou o pedido que esperava (aoLiberar): não toca de novo em cima.
      if (somRef.current && pendentesRef.current.length && !mudoRef.current) return true
    }
    return tocarUmaVez()
  }, [tocarUmaVez])

  /** Corta o toque que está saindo agora (o próximo pedido novo toca normalmente). */
  const silenciar = pararSom

  const pedirNotificacao = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    const p = await Notification.requestPermission().catch(() => Notification.permission)
    setPermissaoNotif(p)
  }, [])

  return { somAtivo, setSomAtivo, bloqueado, tocando, testar, silenciar, aoAtualizarPedidos, permissaoNotif, pedirNotificacao }
}
