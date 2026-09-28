'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye } from 'lucide-react'
import TicketMenuzia from '@/printer-agent/src/ticket-canvas.js'
import { montarCozinhaBeta } from '@/printer-agent/src/cozinha-beta.js'
import { montarPreContaBeta } from '@/printer-agent/src/pre-conta-beta.js'
import { contaDemonstracao, pedidoDemonstracao } from '@/lib/impressao/previa-beta'
import type { DispositivoVisao } from '@/lib/impressao/servico'
import { Cartao, SECUNDARIO, TAMANHOS_LETRA, nomeDisp, type PainelDados, type TamanhoLetra } from '@/components/impressao/beta-cards'

/**
 * Pré-visualização REAL do Assistente Beta: a comanda e a pré-conta montadas pelos
 * mesmos montadores do Beta (cozinha-beta.js / pre-conta-beta.js) e desenhadas pelo
 * mesmo ticket-canvas.js, com as mesmas fontes e a mesma logo — na largura em pontos e
 * no tamanho de letra da impressora. O que aparece aqui é o que sai no papel.
 */

type Modelo = 'cozinha' | 'pre_conta'
const ROTULO: Record<Modelo, string> = { cozinha: 'Comanda da cozinha', pre_conta: 'Pré-conta (Recibo/Extrato)' }

let recursos: Promise<{ logo: HTMLImageElement }> | null = null
const carregar = () => (recursos ??= TicketMenuzia.carregarRecursos('/impressao/fonts', '/impressao/logo-menuzia.png').catch((e: unknown) => {
  recursos = null
  throw e
}))

export function PreviaBeta({ p, ocupado, onSalvarLetra }: {
  p: PainelDados
  ocupado: boolean
  onSalvarLetra: (d: DispositivoVisao, tamanho: TamanhoLetra) => Promise<void>
}) {
  const [modelo, setModelo] = useState<Modelo>('cozinha')
  const [dadosLoja, setDadosLoja] = useState<{ loja: string; qr: unknown } | null>(null)
  const ativos = useMemo(() => p.dispositivos.filter((d) => !p.agentes.find((a) => a.id === d.agenteId)?.revogado), [p.dispositivos, p.agentes])
  // Impressora da função do documento (Cozinha → comanda; Recibo/Extrato → pré-conta).
  const daFuncao = (m: Modelo) => ativos.find((d) => d.id === (m === 'cozinha' ? p.funcoes.cozinha : p.funcoes.caixa)) ?? null
  const [impId, setImpId] = useState<string>('')
  const imp = ativos.find((d) => d.id === impId) ?? daFuncao(modelo) ?? ativos[0] ?? null
  const [letra, setLetra] = useState<TamanhoLetra | null>(null)
  const letraVista: TamanhoLetra = letra ?? (imp?.tamanhoFonte as TamanhoLetra) ?? 'grande'
  const [mmSem, setMmSem] = useState<58 | 80>(80)
  const larguraMm = imp ? (imp.larguraMm <= 58 ? 58 : 80) : mmSem
  const larguraPontos = imp?.larguraPontos ?? null

  const canvas = useRef<HTMLCanvasElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [medida, setMedida] = useState<{ largura: number; altura: number } | null>(null)

  useEffect(() => {
    let vivo = true
    fetch('/api/admin/impressao/previa', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setDadosLoja(j ? { loja: String(j.loja ?? ''), qr: j.qr ?? null } : { loja: '', qr: null }) })
      .catch(() => { if (vivo) setDadosLoja({ loja: '', qr: null }) })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    if (!dadosLoja || !canvas.current) return
    let vivo = true
    const agora = new Date()
    const doc = modelo === 'cozinha'
      ? (() => { const d = pedidoDemonstracao(agora); return montarCozinhaBeta(d.pedido, { config: {}, lojaNome: dadosLoja.loja, extras: d.extras, qr: dadosLoja.qr }) })()
      : montarPreContaBeta({ ...contaDemonstracao(dadosLoja.loja, agora), qr: dadosLoja.qr })
    carregar()
      .then(({ logo }) => {
        if (!vivo || !canvas.current) return
        setMedida(TicketMenuzia.desenhar(canvas.current, doc, { larguraMm, larguraPontos, tamanhoFonte: letraVista, logo }))
        setErro(null)
      })
      .catch(() => { if (vivo) setErro('Não foi possível carregar as fontes da pré-visualização. Recarregue a página.') })
    return () => { vivo = false }
  }, [dadosLoja, modelo, larguraMm, larguraPontos, letraVista])

  function trocarModelo(m: Modelo) {
    setModelo(m)
    setImpId('')
    setLetra(null)
  }

  const salvo = imp?.tamanhoFonte ?? 'grande'
  const chip = (ativo: boolean) =>
    ['h-[32px] rounded-[6px] border px-3 text-[12.5px] font-semibold transition-colors', ativo ? 'border-[#0688D4] bg-[#F0F9FF] text-[#0688D4]' : 'border-[var(--adm-borda)] bg-white text-[var(--adm-texto-medio)] hover:border-[#0688D4]'].join(' ')

  return (
    <Cartao icone={Eye} tom="azul" titulo="Pré-visualização da impressão" testid="cartao-previa">
      <div className="flex flex-wrap gap-2" role="tablist">
        {(['cozinha', 'pre_conta'] as Modelo[]).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={modelo === m} onClick={() => trocarModelo(m)} data-testid={`previa-${m}`} className={chip(modelo === m)}>{ROTULO[m]}</button>
        ))}
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3 text-[12.5px] text-[var(--adm-texto-medio)]">
          {ativos.length > 0 ? (
            <label className="block text-[12px] text-[var(--adm-texto-suave)]">
              Impressora
              <select value={imp?.id ?? ''} onChange={(e) => { setImpId(e.target.value); setLetra(null) }} data-testid="previa-impressora" className="mt-1 block h-[36px] w-full rounded-[6px] border border-[var(--adm-borda)] bg-white px-2 text-[13px] text-[var(--adm-texto)]">
                {ativos.map((d) => <option key={d.id} value={d.id}>{nomeDisp(d)}{daFuncao(modelo)?.id === d.id ? (modelo === 'cozinha' ? ' — Cozinha' : ' — Recibo/Extrato') : ''}</option>)}
              </select>
            </label>
          ) : (
            <div className="flex gap-2">
              {([80, 58] as const).map((mm) => <button key={mm} type="button" onClick={() => setMmSem(mm)} className={chip(mmSem === mm)}>Papel {mm} mm</button>)}
            </div>
          )}
          <div>
            <p className="text-[12px] text-[var(--adm-texto-suave)]">Tamanho da letra</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {TAMANHOS_LETRA.map((t) => (
                <button key={t.valor} type="button" onClick={() => setLetra(t.valor)} data-testid={`previa-letra-${t.valor}`} className={chip(letraVista === t.valor)}>{t.rotulo}</button>
              ))}
            </div>
            {imp && letraVista !== salvo && (
              <button type="button" disabled={ocupado} onClick={() => void onSalvarLetra(imp, letraVista).then(() => setLetra(null))} data-testid="previa-salvar-letra" className={`${SECUNDARIO} mt-2`}>
                Salvar esta letra em {nomeDisp(imp)}
              </button>
            )}
          </div>
          <p className="text-[12px] leading-[17px] text-[var(--adm-texto-suave)]" data-testid="previa-medida">
            {imp ? `${nomeDisp(imp)} · papel ${larguraMm} mm` : `Papel ${larguraMm} mm`}
            {medida ? ` · ${medida.largura} pontos de largura${larguraPontos ? ' (calibrada)' : ''}` : ''}. Dados de demonstração; o desenho, as letras e os espaços são os mesmos do papel.
          </p>
          {erro && <p className="text-[12.5px] text-[#B91C1C]">{erro}</p>}
        </div>
        <div className="flex justify-center rounded-[6px] bg-[#EDEEF1] p-3 md:p-4">
          {/* Mesma proporção do papel (576 pontos → 360 px na tela; 58 mm e calibrada na mesma escala). */}
          <canvas ref={canvas} data-testid="previa-canvas" className="h-auto bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)]" style={{ width: Math.round((medida?.largura ?? (larguraMm === 58 ? 384 : 576)) * 0.625), maxWidth: '100%' }} />
        </div>
      </div>
    </Cartao>
  )
}
