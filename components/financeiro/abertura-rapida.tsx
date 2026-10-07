'use client'

import { useEffect, useRef, useState } from 'react'
import { Flutuante } from '@/components/ui/flutuante'
import { CampoDinheiro, botao } from './apoio'

/**
 * Abertura rápida do caixa ao entrar (Fase 6, revisada em 2026-10-05).
 * - Aparece UMA vez por login (o login grava um cookie de 1 min; ele é apagado assim que a pergunta aparece).
 * - "Agora não" (ou clicar fora, ou Esc) vale até o próximo login.
 * - Só para quem pode abrir o caixa — o servidor nunca libera garçom, cozinha ou motoboy.
 * - É um flutuante pequeno (components/ui/flutuante.tsx, camada máxima), preso à direita LOGO ABAIXO do topo: não
 *   cobre a barra do topo nem trava a tela (clicar em qualquer outro lugar só fecha a pergunta).
 */
export function AberturaRapidaCaixa() {
  const ancora = useRef<HTMLSpanElement>(null)
  const [mostrar, setMostrar] = useState(false)
  const [txt, setTxt] = useState('')
  const [c, setC] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    const recem = document.cookie.split('; ').some((x) => x === 'menuzia_recem_entrou=1')
    if (!recem) return
    // Uma vez por login: a marca do login some já na primeira tela.
    document.cookie = 'menuzia_recem_entrou=; Max-Age=0; path=/'
    void (async () => {
      const r = await fetch('/api/admin/financeiro/caixa?leve=1', { cache: 'no-store' }).catch(() => null)
      if (!r?.ok) return
      const j = await r.json().catch(() => ({}))
      if (j.aberto === false && j.podeAbrir === true) setMostrar(true)
    })()
  }, [])

  async function abrir() {
    if (c === null || c < 0) return setErro('Informe o fundo de troco (pode ser 0).')
    setOcupado(true); setErro(null)
    const r = await fetch('/api/admin/financeiro/caixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'abrir', fundoCentavos: c }) }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    setOcupado(false)
    if (!r?.ok && j.codigo !== 'ja_aberto') return setErro(j.error ?? 'Não foi possível abrir.')
    setMostrar(false)
    window.dispatchEvent(new Event('menuzia:caixa-mudou'))
  }

  return (
    <>
      {/* Âncora invisível: canto direito, logo abaixo da barra do topo. */}
      <span ref={ancora} aria-hidden className="pointer-events-none fixed right-[12px] top-[56px] h-px w-px md:top-[60px]" />
      <Flutuante ancora={ancora} aberto={mostrar} onFechar={() => setMostrar(false)} alinhar="fim" largura={320} testid="abertura-rapida" rotulo="Abrir o caixa agora?" className="fin-meta border-l-[3px] !border-l-[#4DBBA6]">
        <div className="p-4">
          <p className="text-[16px] font-semibold text-text-main">Abrir o caixa agora?</p>
          <p className="mb-3 mt-0.5 text-[13px] text-text-subtle">O caixa está fechado. Conte o fundo de troco da gaveta — fica no seu nome.</p>
          <CampoDinheiro rotulo="Fundo de troco" valor={txt} onMudar={(t, v) => { setTxt(t); setC(v) }} testid="abertura-rapida-fundo" />
          {erro && <p className="mt-1 text-[12px] font-medium text-danger">{erro}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className={botao.secundario} onClick={() => setMostrar(false)} data-testid="abertura-rapida-depois">Agora não</button>
            <button type="button" className={botao.sucesso} disabled={ocupado} onClick={() => void abrir()} data-testid="abertura-rapida-abrir">Abrir caixa</button>
          </div>
        </div>
      </Flutuante>
    </>
  )
}
