'use client'

import { useEffect, useMemo, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { EVENTO_SAIR_CAIXA, sairDoPainel } from '@/lib/sessao-cliente'
import { tempoAberto } from '@/lib/financeiro/caixa-regras'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { Dica } from '@/components/ui/flutuante'
import { Janela, botao } from './apoio'

/**
 * Aviso no topo do painel, em cor viva com texto branco (Fase 2, só com o financeiro ligado e para quem mexe no caixa):
 * "Caixa aberto · Fulano · há 3 h" ou "Caixa fechado". Clicar leva ao Financeiro › Caixa.
 * No celular vira um quadrado compacto (ícone + cor, 36 px como o resto da barra) com o texto na dica (0145).
 */
export function AvisoCaixa() {
  const [e, setE] = useState<{ aberto: boolean; abertoPorNome: string | null; abertoEm: string | null; aAcertarCentavos?: number } | null>(null)
  const [, setTick] = useState(0)
  useEffect(() => {
    let vivo = true
    const ler = () => void fetch('/api/admin/financeiro/caixa?leve=1', { cache: 'no-store' })
      .then(async (r) => { if (vivo) setE(r.ok ? await r.json() : null) }).catch(() => {})
    ler()
    const i = window.setInterval(() => { ler(); setTick((x) => x + 1) }, 60_000)
    window.addEventListener('menuzia:caixa-mudou', ler)
    return () => { vivo = false; window.clearInterval(i); window.removeEventListener('menuzia:caixa-mudou', ler) }
  }, [])
  if (!e) return null
  const texto = e.aberto
    ? `Caixa aberto por ${e.abertoPorNome ?? '—'}${e.abertoEm ? ` · há ${tempoAberto(e.abertoEm)}` : ''}`
    : e.aAcertarCentavos ? `Caixa fechado · ${formatarCentavos(e.aAcertarCentavos)} a acertar` : 'Caixa fechado — toque para abrir'
  return (
    <>
    <Dica texto={texto}>
      <a href="/admin/financeiro?secao=caixa" data-testid="aviso-caixa-celular" aria-label={texto} data-aberto={e.aberto ? '1' : '0'}
        className={`flex h-[36px] flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] px-2 text-[12px] font-semibold text-white md:hidden ${e.aberto ? 'bg-[#15803D]' : 'bg-[#B91C1C]'}`}>
        {/* Pílula (pendência 7): no celular o status do caixa precisa ser lido, não adivinhado pelo ícone. */}
        <span className="h-[7px] w-[7px] rounded-full bg-white" aria-hidden />
        Caixa
      </a>
    </Dica>
    <a href="/admin/financeiro?secao=caixa" data-testid="aviso-caixa"
      title={e.aberto ? `Caixa aberto por ${e.abertoPorNome ?? '—'}` : 'Caixa fechado — clique para abrir'}
      className={`hidden h-[44px] flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] px-3 text-[12.5px] font-semibold text-white transition-[filter] hover:brightness-110 md:flex ${e.aberto ? 'bg-[#15803D]' : 'bg-[#B91C1C]'}`}>
      <span className="h-[8px] w-[8px] rounded-full bg-white" />
      {/* Telas estreitas: só "Caixa" (a cor diz aberto/fechado; o resto fica na dica). */}
      <span className="xl:hidden">Caixa</span>
      <span className="hidden xl:inline">
        {e.aberto ? <>Caixa aberto · {(e.abertoPorNome ?? '').split(' ')[0]} · {e.abertoEm ? tempoAberto(e.abertoEm) : ''}</>
          : e.aAcertarCentavos ? <span data-testid="aviso-a-acertar">Caixa fechado · {formatarCentavos(e.aAcertarCentavos)} a acertar</span> : 'Caixa fechado'}
      </span>
    </a>
    </>
  )
}

/** Quem abriu o caixa e vai sair com ele aberto: fecha o caixa ou explica (fica na auditoria). */
export function JanelaSairComCaixa() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [aberta, setAberta] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => {
    const abrir = () => { setAberta(true); setMotivo('') }
    window.addEventListener(EVENTO_SAIR_CAIXA, abrir)
    return () => window.removeEventListener(EVENTO_SAIR_CAIXA, abrir)
  }, [])
  if (!aberta) return null
  return (
    <div className="relative z-[210]">
      <Janela titulo="O caixa está aberto" onFechar={() => setAberta(false)} testid="janela-sair-caixa">
        <p className="mb-[10px] text-[13px] text-text-subtle">Você abriu o caixa e ele continua aberto. O certo é fechar antes de sair. Se precisar sair assim mesmo, explique — o dono recebe o aviso.</p>
        <textarea className="min-h-[70px] w-full rounded-[3px] border border-border p-[10px] text-[13px] outline-none focus:border-primary" placeholder="Por que vai sair com o caixa aberto?"
          value={motivo} onChange={(ev) => setMotivo(ev.target.value.slice(0, 300))} data-testid="sair-caixa-motivo" />
        <div className="mt-[14px] flex flex-wrap justify-end gap-2">
          <a href="/admin/financeiro?secao=caixa" className={`${botao.primario} inline-flex items-center`} onClick={() => setAberta(false)}>Fechar o caixa</a>
          <button type="button" className={botao.perigo} disabled={ocupado || motivo.trim().length < 5} data-testid="sair-caixa-confirmar"
            onClick={async () => { setOcupado(true); if (await sairDoPainel(supabase, motivo.trim())) window.location.href = '/login'; setOcupado(false) }}>
            Sair mesmo assim
          </button>
        </div>
      </Janela>
    </div>
  )
}
