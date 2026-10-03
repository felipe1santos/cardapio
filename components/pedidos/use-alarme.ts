'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { deveRepetir, pedidosParaTocar, reivindicarToque, REPETICAO_PADRAO, type MotivoFalhaSom } from '@/lib/alarme-pedidos'

/**
 * Alarme de pedido novo do Painel de Pedidos (2026-10-03).
 *
 * - mp3 decodificado no Web Audio; cada toque é uma fonte nova (dois pedidos = dois sons).
 * - Navegador bloqueou o som (painel aberto sem clique): `bloqueado = true` → a tela mostra o
 *   aviso clicável; qualquer clique/tecla destrava e toca o que estava esperando.
 * - Toca TODO pedido "recebido" que ainda não tocou nesta aba (tempo real, poll, reconexão ou
 *   o que já esperava quando a página abriu) e repete a cada N s enquanto houver pendente.
 * - Aba escondida: a notificação do navegador sai do layout do painel (notificacoes-pedidos).
 *   Wake Lock: a tela não dorme.
 * - Várias abas: só uma toca cada pedido (lib/alarme-pedidos.ts › reivindicarToque).
 * - Falha de reprodução vai para o log do servidor com o motivo.
 *
 * `window.__mzAlarme` expõe contadores para os testes automáticos (sem efeito na tela).
 */
const SOM_SRC = '/sounds/som-telefone-alarme.mp3'
const CHAVE_SOM = 'menuzia:kanban-som'
const CHAVE_REPETIR = 'menuzia:kanban-som-repetir'
/** Silenciados valem para todas as abas do painel. */
const CHAVE_SILENCIADOS = 'menuzia:alarme:silenciados'
const lerSilenciados = (): string[] => { try { const v = JSON.parse(localStorage.getItem(CHAVE_SILENCIADOS) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] } }

type Estado = { tocou: number; falhas: Partial<Record<MotivoFalhaSom, number>>; bloqueado: boolean; ultimoMotivo: string | null }
declare global { interface Window { __mzAlarme?: Estado } }

const idDaAba = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()))
const armazenamento = () => { try { return window.localStorage } catch { return null } }

export function useAlarmePedidos() {
  const [somAtivo, setSomAtivoEstado] = useState(true)
  const [repetirSeg, setRepetirSegEstado] = useState(REPETICAO_PADRAO)
  const [bloqueado, setBloqueado] = useState(false)
  const [tocando, setTocando] = useState(false)
  const [permissaoNotif, setPermissaoNotif] = useState<NotificationPermission | 'sem_suporte'>('default')
  const somRef = useRef(true)
  const repetirRef = useRef(REPETICAO_PADRAO)
  const ctxRef = useRef<AudioContext | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const tocadosRef = useRef<Set<string>>(new Set())
  /** Pedidos silenciados pelo botão: não repetem; pedido NOVO toca normalmente. */
  const silenciadosRef = useRef<Set<string>>(new Set())
  const pendentesRef = useRef<{ id: string; numero: number }[]>([])
  const ultimoToqueRef = useRef(0)
  const abaRef = useRef<string>('')
  const logadoRef = useRef<Map<string, number>>(new Map())
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null)
  /** Liberou o áudio (clique ou o próprio navegador): toca na hora o que esperava. */
  const aoLiberarRef = useRef<() => void>(() => {})

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
    const rep = Number(s?.getItem(CHAVE_REPETIR) ?? REPETICAO_PADRAO)
    somRef.current = som; setSomAtivoEstado(som)
    repetirRef.current = Number.isFinite(rep) ? rep : REPETICAO_PADRAO; setRepetirSegEstado(repetirRef.current)
    setPermissaoNotif(typeof Notification === 'undefined' ? 'sem_suporte' : Notification.permission)
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
    atualizar()
    // Quem já clicou neste site nesta aba (ex.: no login) tem o áudio liberado sem novo clique:
    // tenta já, para não mostrar o aviso de bloqueio à toa.
    void ctx.resume().then(atualizar).catch(() => {})
    fetch(SOM_SRC).then((r) => r.arrayBuffer()).then((ab) => ctx.decodeAudioData(ab)).then((buf) => { bufferRef.current = buf })
      .catch((err) => registrarFalha('arquivo_indisponivel', String(err)))
    return () => { ctx.onstatechange = null; void ctx.close().catch(() => {}); ctxRef.current = null }
  }, [registrarFalha])

  /** Um toque (fonte nova a cada vez). Devolve se saiu som. */
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
        const src = ctx.createBufferSource()
        src.buffer = bufferRef.current
        const ganho = ctx.createGain(); ganho.gain.value = 1
        src.connect(ganho); ganho.connect(ctx.destination)
        src.start()
        src.onended = () => { src.disconnect(); ganho.disconnect() }
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
      ultimoToqueRef.current = Date.now()
      return true
    } catch (err) {
      registrarFalha('erro_reproducao', String(err))
      return false
    }
  }, [registrarFalha])

  /**
   * Chamado a cada leitura dos pedidos (tempo real, poll, reconexão). Toca uma vez para CADA
   * pedido recebido que ainda não tocou nesta aba (dois juntos = dois toques).
   */
  const aoAtualizarPedidos = useCallback((recebidos: { id: string; numero: number }[]) => {
    pendentesRef.current = recebidos
    const ids = new Set(recebidos.map((p) => p.id))
    for (const id of [...tocadosRef.current]) if (!ids.has(id)) tocadosRef.current.delete(id)
    for (const id of lerSilenciados()) if (ids.has(id)) { silenciadosRef.current.add(id); tocadosRef.current.add(id) }
    for (const id of [...silenciadosRef.current]) if (!ids.has(id)) silenciadosRef.current.delete(id)
    const novos = pedidosParaTocar(ids, tocadosRef.current)
    setTocando(somRef.current && recebidos.some((p) => !silenciadosRef.current.has(p.id)))
    if (!novos.length) return
    for (const id of novos) tocadosRef.current.add(id)
    // Chegou pedido novo: a repetição recomeça a contar em TODAS as abas (a que não tocou não
    // pode repetir na hora só porque nunca tocou).
    ultimoToqueRef.current = Date.now()
    if (!somRef.current) return
    const s = armazenamento()
    const meus = novos.filter((id) => reivindicarToque(`menuzia:alarme:${id}`, abaRef.current, Date.now(), s))
    if (!meus.length) return
    meus.forEach((_, i) => setTimeout(() => tocarUmaVez(), i * 1400))
    // A notificação do navegador (aba escondida) já sai do layout do painel para todo pedido
    // novo (components/admin/notificacoes-pedidos.tsx) — aqui não repete.
  }, [tocarUmaVez])

  // Repetição enquanto houver pedido não aceito (sem o antigo corte de 2 min).
  useEffect(() => {
    const t = setInterval(() => {
      const pend = pendentesRef.current.filter((p) => !silenciadosRef.current.has(p.id)).length
      if (!deveRepetir({ repetirSeg: repetirRef.current, pendentes: pend, somLigado: somRef.current, ultimoToque: ultimoToqueRef.current, agora: Date.now() })) return
      if (!reivindicarToque('menuzia:alarme:repeticao', abaRef.current, Date.now(), armazenamento(), repetirRef.current * 800)) return
      tocarUmaVez()
    }, 1000)
    return () => clearInterval(t)
  }, [tocarUmaVez])

  aoLiberarRef.current = () => {
    if (somRef.current && pendentesRef.current.some((p) => !silenciadosRef.current.has(p.id))) tocarUmaVez()
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
  }, [])

  const setSomAtivo = useCallback((v: boolean) => {
    somRef.current = v; setSomAtivoEstado(v)
    try { localStorage.setItem(CHAVE_SOM, v ? '1' : '0') } catch { /* sem storage */ }
    if (v) { void ctxRef.current?.resume().catch(() => {}); setTocando(pendentesRef.current.length > 0) } else setTocando(false)
  }, [])

  const setRepetirSeg = useCallback((s: number) => {
    repetirRef.current = s; setRepetirSegEstado(s)
    try { localStorage.setItem(CHAVE_REPETIR, String(s)) } catch { /* sem storage */ }
  }, [])

  /** "Testar som" e o aviso clicável: o próprio clique libera o áudio. */
  const testar = useCallback(async () => {
    const ctx = ctxRef.current
    if (ctx && ctx.state !== 'running') {
      await ctx.resume().catch(() => {})
      // A liberação já tocou o pedido que esperava (aoLiberar): não toca de novo em cima.
      if (somRef.current && pendentesRef.current.some((p) => !silenciadosRef.current.has(p.id))) return true
    }
    return tocarUmaVez()
  }, [tocarUmaVez])

  /** Para a repetição dos pedidos que já tocaram (o próximo pedido novo toca normalmente). */
  const silenciar = useCallback(() => {
    for (const p of pendentesRef.current) silenciadosRef.current.add(p.id)
    try { localStorage.setItem(CHAVE_SILENCIADOS, JSON.stringify([...new Set([...lerSilenciados(), ...silenciadosRef.current])].slice(-200))) } catch { /* sem storage */ }
    setTocando(false)
  }, [])

  const pedirNotificacao = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    const p = await Notification.requestPermission().catch(() => Notification.permission)
    setPermissaoNotif(p)
  }, [])

  return { somAtivo, setSomAtivo, repetirSeg, setRepetirSeg, bloqueado, tocando, testar, silenciar, aoAtualizarPedidos, permissaoNotif, pedirNotificacao }
}
