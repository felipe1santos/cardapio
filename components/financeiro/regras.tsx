'use client'

import { useEffect, useState } from 'react'
import { formatarCentavos, paraCentavos } from '@/lib/financeiro/centavos'
import { BOTAO } from './ui/blocos'

/**
 * Financeiro › Regras e limites (Fase 6). Só o dono altera (o servidor confere); os outros veem.
 * As regras de PIN no fechamento são PROVISÓRIAS (aguardam confirmação do dono da plataforma).
 */
type Cfg = Record<string, number | null>
const DINHEIRO: [string, string, string][] = [
  ['toleranciaFechamentoCentavos', 'Tolerância no fechamento', 'Diferença até este valor: só justificativa. Acima: PIN de gerente/dono.'],
  ['limiteComandasFechamentoCentavos', 'Mesas/comandas abertas no fechamento', 'Acima deste total em aberto, passar para o próximo turno exige PIN.'],
  ['limiteSaidaCentavos', 'Saída do caixa sem aprovação', 'Sangria, despesa, retirada e conta paga com dinheiro do caixa acima disto pedem PIN.'],
  ['limiteContaCentavos', 'Conta paga pela empresa sem aprovação', 'Pagar conta ou compra pela empresa acima disto pede PIN.'],
  ['limiteDescontoCentavos', 'Desconto alto (R$)', 'Acima disto (ou do %) o dono recebe alerta.'],
  ['metaFaturamentoDiaCentavos', 'Meta de faturamento por dia', 'Opcional: desenha a linha de meta no gráfico do Dashboard.'],
]
const NUMEROS: [string, string, string][] = [
  ['limiteDescontoPct', 'Desconto alto (%)', '% do subtotal da conta.'],
  ['minutosCaixaSemAbrir', 'Avisar caixa sem abrir (min)', 'Minutos depois da abertura da loja (grade de horários) sem caixa aberto.'],
  ['horasCaixaAberto', 'Avisar caixa aberto há (h)', 'Caixa esquecido aberto.'],
  ['horasMotoboyPendente', 'Avisar motoboy com dinheiro há (h)', 'Dinheiro de entrega sem acerto.'],
  ['maxAcoesSensiveisTurno', 'Ações sensíveis por pessoa no turno', 'Cancelar, desconto, estorno, reimpressão, sangria. Acima disto, alerta.'],
]

export function SecaoRegras() {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [texto, setTexto] = useState<Record<string, string>>({})
  const [podeEditar, setPodeEditar] = useState(false)
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; t: string } | null>(null)
  const preencher = (c: Cfg) => {
    setCfg(c)
    const t: Record<string, string> = {}
    for (const [k] of DINHEIRO) t[k] = c[k] === null || c[k] === undefined ? '' : (Number(c[k]) / 100).toFixed(2).replace('.', ',')
    for (const [k] of NUMEROS) t[k] = c[k] === null || c[k] === undefined ? '' : String(c[k]).replace('.', ',')
    setTexto(t)
  }
  useEffect(() => {
    void fetch('/api/admin/financeiro/config', { cache: 'no-store' }).then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (r.ok) { preencher(j.config); setPodeEditar(!!j.podeEditar) }
    })
  }, [])
  async function salvar() {
    const corpo: Record<string, number | null> = {}
    for (const [k] of DINHEIRO) {
      const t = texto[k]?.trim() ?? ''
      if (k === 'metaFaturamentoDiaCentavos' && !t) { corpo[k] = null; continue }
      const c = paraCentavos(t)
      if (c === null) return setMsg({ tom: 'erro', t: 'Valor inválido.' })
      corpo[k] = c
    }
    for (const [k] of NUMEROS) {
      const v = Number((texto[k] ?? '').replace(',', '.'))
      if (!Number.isFinite(v)) return setMsg({ tom: 'erro', t: 'Número inválido.' })
      corpo[k] = v
    }
    const r = await fetch('/api/admin/financeiro/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return setMsg({ tom: 'erro', t: j.error ?? 'Não foi possível salvar.' })
    preencher(j.config); setMsg({ tom: 'ok', t: 'Regras salvas.' })
  }
  if (!cfg) return <p className="text-[13px] text-text-subtle">Carregando…</p>
  const campo = (k: string, rot: string, ajuda: string, dinheiro: boolean) => (
    <label key={k} className="block fin-card p-3">
      <span className="block text-[12.5px] font-bold text-text-main">{rot}</span>
      <span className="mb-2 block text-[12px] text-text-subtle">{ajuda}</span>
      <span className="flex h-[38px] items-center fin-card px-2.5 focus-within:border-primary">
        {dinheiro && <span className="mr-1.5 text-[13px] text-text-subtle">R$</span>}
        <input className="h-full w-full bg-transparent text-[14px] font-semibold outline-none disabled:text-text-subtle" inputMode="decimal" disabled={!podeEditar}
          value={texto[k] ?? ''} onChange={(e) => setTexto({ ...texto, [k]: e.target.value.replace(/[^\d.,]/g, '') })} data-testid={`regra-${k}`} placeholder={k === 'metaFaturamentoDiaCentavos' ? 'sem meta' : ''} />
      </span>
    </label>
  )
  return (
    <div className="flex flex-col gap-3" data-testid="secao-regras">
      <div className="fin-card border-l-[3px] !border-l-[#D47B04] px-4 py-2.5 text-[13px] text-[#1C2B33]">
        <b>Regras de PIN no fechamento (provisórias):</b> diferença até a tolerância → justificativa; acima → PIN · motoboy sem acerto → PIN ·
        entregue e não pago → PIN · Pix a conferir → fecha e vai para a lista do dono · mesa/comanda aberta → passa para o próximo turno com justificativa (PIN acima do limite) ·
        maquininha com diferença → justificativa (PIN acima da tolerância). O dono não precisa de PIN.
      </div>
      {!podeEditar && <p className="text-[12.5px] text-text-subtle">Só o dono muda estas regras.</p>}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {DINHEIRO.map(([k, r, a]) => campo(k, r, a, true))}
        {NUMEROS.map(([k, r, a]) => campo(k, r, a, false))}
      </div>
      {podeEditar && (
        <div className="flex items-center gap-3">
          <button type="button" className={BOTAO.primario} onClick={() => void salvar()} data-testid="regras-salvar">Salvar regras</button>
          {msg && <span className={`text-[13px] font-semibold ${msg.tom === 'ok' ? 'text-[#006B4E]' : 'text-[#D93616]'}`} data-testid="regras-msg">{msg.t}</span>}
        </div>
      )}
      <p className="text-[12px] text-text-subtle">Tolerância atual: {formatarCentavos(Number(cfg.toleranciaFechamentoCentavos ?? 200))}.</p>
    </div>
  )
}
