'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { EVENTO_TRAVAR, buscarEstadoSessao, estadoMudou, sairDoPainel, type EstadoSessao } from '@/lib/sessao-cliente'
import { deveTravar } from '@/lib/financeiro/trava'
import { TecladoPin } from './teclado-pin'

/**
 * Tela travada e troca rápida de operador (0132) — só com o módulo financeiro ligado.
 *
 * Travar NÃO derruba a sessão: o painel por baixo continua recebendo pedidos e imprimindo.
 * O servidor marca a sessão deste terminal como travada e recusa ações de dinheiro até
 * destravar com PIN (a sobreposição sozinha não é a segurança — é o aviso).
 * Também: avisa o servidor a cada 4 min que o painel segue aberto (login simultâneo).
 */
const PING_MS = 4 * 60_000

type Tela = 'eu' | 'lista' | 'outro'

export function TravaSessao() {
  const pathname = usePathname() ?? ''
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [estado, setEstado] = useState<EstadoSessao | null>(null)
  const [travada, setTravada] = useState(false)
  const [tela, setTela] = useState<Tela>('eu')
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [operadores, setOperadores] = useState<{ id: string; nome: string }[] | null>(null)
  const [escolhido, setEscolhido] = useState<{ id: string; nome: string } | null>(null)
  const ultima = useRef(Date.now())

  const carregar = useCallback(async () => {
    const e = await buscarEstadoSessao()
    if (!e) return
    setEstado(e)
    if (e.travada) setTravada(true)
  }, [])

  useEffect(() => {
    void carregar()
    const ao = () => void carregar()
    window.addEventListener('menuzia:estado-sessao', ao)
    return () => window.removeEventListener('menuzia:estado-sessao', ao)
  }, [carregar])

  const abrirLista = useCallback(async () => {
    setTela('lista'); setPin(''); setErro(null); setEscolhido(null)
    const r = await fetch('/api/sessao/pin-entrar', { cache: 'no-store' }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) { setOperadores([]); setErro(j.error ?? 'Não foi possível listar os operadores.'); return }
    setOperadores(j.usuarios ?? [])
  }, [])

  const travar = useCallback(async (modo: 'travar' | 'trocar') => {
    setTravada(true); setPin(''); setErro(null)
    await fetch('/api/sessao/sair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo: 'bloqueio' }) }).catch(() => {})
    if (modo === 'trocar') void abrirLista()
    else setTela('eu')
  }, [abrirLista])

  // Pedido do menu de conta.
  useEffect(() => {
    const ao = (e: Event) => { if (estado?.financeiroAtivo) void travar((e as CustomEvent).detail === 'trocar' ? 'trocar' : 'travar') }
    window.addEventListener(EVENTO_TRAVAR, ao)
    return () => window.removeEventListener(EVENTO_TRAVAR, ao)
  }, [estado?.financeiroAtivo, travar])

  // Atividade + inatividade + ping.
  useEffect(() => {
    if (!estado?.financeiroAtivo) return
    const mexeu = () => { ultima.current = Date.now() }
    const eventos = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    eventos.forEach((n) => window.addEventListener(n, mexeu, { passive: true }))
    const relogio = window.setInterval(() => {
      if (deveTravar({ ...estado, travada, pathname, ultimaAtividade: ultima.current, agora: Date.now() })) void travar('travar')
    }, 15_000)
    const ping = () => void fetch('/api/sessao/ping', { method: 'POST' }).catch(() => {})
    ping()
    const pinger = window.setInterval(ping, PING_MS)
    return () => {
      eventos.forEach((n) => window.removeEventListener(n, mexeu))
      window.clearInterval(relogio); window.clearInterval(pinger)
    }
  }, [estado, travada, pathname, travar])

  async function enviar(p: string) {
    setOcupado(true); setErro(null)
    try {
      const outro = tela === 'outro' && escolhido
      const r = await fetch(outro ? '/api/sessao/pin-entrar' : '/api/sessao/desbloquear', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outro ? { usuarioId: escolhido.id, pin: p } : { pin: p }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.error ?? 'PIN incorreto.'); setPin(''); return }
      if (outro) { window.location.reload(); return }
      setTravada(false); setPin(''); ultima.current = Date.now(); estadoMudou()
    } finally {
      setOcupado(false)
    }
  }

  async function entrarComSenha() {
    if (await sairDoPainel(supabase)) window.location.href = '/login'
  }

  if (!travada || !estado?.financeiroAtivo) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#111827]/95 p-4" role="dialog" aria-modal="true" aria-label="Tela bloqueada" data-testid="tela-travada">
      <div className="w-full max-w-[360px] rounded-[3px] border border-[#E5E7EB] bg-white p-[20px] shadow-xl">
        {tela === 'lista' ? (
          <>
            <h2 className="text-[16px] font-bold text-[#1F2937]">Quem vai usar?</h2>
            <p className="mb-[12px] mt-[2px] text-[13px] text-[#6B7280]">Escolha o seu nome e digite o seu PIN.</p>
            {erro && <p role="alert" className="mb-[10px] text-[13px] text-[#EF4444]">{erro}</p>}
            <div className="max-h-[300px] space-y-[6px] overflow-y-auto">
              {operadores === null && <p className="text-[13px] text-[#6B7280]">Carregando…</p>}
              {operadores?.length === 0 && !erro && <p className="text-[13px] text-[#6B7280]">Ninguém criou PIN ainda. Entre com a senha.</p>}
              {operadores?.map((o) => (
                <button key={o.id} type="button" data-testid="operador"
                  onClick={() => { setEscolhido(o); setTela('outro'); setPin(''); setErro(null) }}
                  className="flex h-[44px] w-full items-center rounded-[3px] border border-[#E5E7EB] px-[12px] text-left text-[14px] font-semibold text-[#1F2937] hover:border-[#0688D4]">
                  {o.nome}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2 className="text-center text-[16px] font-bold text-[#1F2937]">Tela bloqueada</h2>
            <p className="mb-[14px] mt-[2px] text-center text-[13px] text-[#6B7280]">
              {tela === 'outro' && escolhido ? <>PIN de <b className="text-[#1F2937]">{escolhido.nome}</b></> : <>PIN de <b className="text-[#1F2937]">{estado.nome}</b></>}
            </p>
            <TecladoPin valor={pin} onMudar={setPin} onCompleto={(p) => void enviar(p)} ocupado={ocupado} erro={erro} />
          </>
        )}
        <div className="mt-[16px] flex flex-wrap justify-center gap-x-[14px] gap-y-[6px] border-t border-[#E5E7EB] pt-[12px] text-[12px] font-semibold uppercase tracking-wide">
          {tela !== 'eu' && <button type="button" onClick={() => { setTela('eu'); setPin(''); setErro(null) }} className="text-[#0688D4]">Sou {estado.nome.split(' ')[0]}</button>}
          {tela !== 'lista' && <button type="button" onClick={() => void abrirLista()} className="text-[#0688D4]" data-testid="trocar-operador">Outro operador</button>}
          <button type="button" onClick={() => void entrarComSenha()} className="text-[#6B7280]" data-testid="entrar-com-senha">Entrar com senha</button>
        </div>
      </div>
    </div>
  )
}
