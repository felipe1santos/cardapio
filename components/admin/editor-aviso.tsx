'use client'

import { useState } from 'react'
import { AvisoVitrine } from '@/components/vitrine/aviso-vitrine'
import { AVISO_PADRAO, CORES_AVISO_FUNDO, CORES_AVISO_TEXTO, contrasteBaixo, normalizarHex, type EstiloAviso } from '@/lib/aviso-vitrine'

/** Uma linha de cor: amostras prontas + campo hex (personalizada). */
function EscolhaCor({ rotulo, valor, cores, onChange, testid }: { rotulo: string; valor: string | null; cores: readonly string[]; onChange: (v: string | null) => void; testid: string }) {
  const [hex, setHex] = useState(valor ?? '')
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-text-subtle">{rotulo}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {cores.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => { onChange(c); setHex(c) }}
            aria-label={`${rotulo} ${c}`}
            title={c}
            data-testid={`${testid}-${c.slice(1)}`}
            className={['h-7 w-7 rounded-full border', valor === c ? 'ring-2 ring-primary ring-offset-1' : 'border-border'].join(' ')}
            style={{ backgroundColor: c }}
          />
        ))}
        <input
          type="text"
          value={hex}
          onChange={(e) => { setHex(e.target.value); const n = normalizarHex(e.target.value); if (n) onChange(n) }}
          placeholder="#HEX"
          maxLength={7}
          autoComplete="off"
          name={`${testid}-hex`}
          data-testid={`${testid}-hex`}
          className="w-[84px] rounded-menuzia border border-border px-2 py-1 text-[12px] uppercase outline-none focus:border-primary"
        />
      </div>
    </div>
  )
}

/**
 * Cor do texto, cor do fundo e efeito "pulsar" do aviso da vitrine (0123), com prévia AO
 * VIVO (o mesmo componente da vitrine) e alerta de contraste. "Padrão" volta ao visual de
 * sempre (nulo no banco).
 */
export function EditorAviso({ texto, estilo, onChange }: { texto: string; estilo: EstiloAviso; onChange: (e: EstiloAviso) => void }) {
  const [chave, setChave] = useState(0)
  const baixo = (estilo.corTexto || estilo.corFundo) ? contrasteBaixo(estilo) : false
  return (
    <div className="mt-3 space-y-3 rounded-menuzia border border-border bg-page p-3" data-testid="editor-aviso">
      <div className="grid gap-3 sm:grid-cols-2" key={chave}>
        <EscolhaCor rotulo="Cor do texto" valor={estilo.corTexto} cores={CORES_AVISO_TEXTO} onChange={(v) => onChange({ ...estilo, corTexto: v })} testid="aviso-cor-texto" />
        <EscolhaCor rotulo="Cor do fundo" valor={estilo.corFundo} cores={CORES_AVISO_FUNDO} onChange={(v) => onChange({ ...estilo, corFundo: v })} testid="aviso-cor-fundo" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium text-text-main">
          <input type="checkbox" checked={estilo.pulsar} onChange={(e) => onChange({ ...estilo, pulsar: e.target.checked })} className="h-3.5 w-3.5 accent-primary" data-testid="aviso-pulsar" />
          Efeito pulsar
        </label>
        <button
          type="button"
          onClick={() => { onChange(AVISO_PADRAO); setChave((k) => k + 1) }}
          className="rounded-menuzia border border-border bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:text-text-main"
          data-testid="aviso-padrao"
        >
          Padrão
        </button>
      </div>
      {baixo && (
        <p className="rounded-menuzia bg-warn-bg px-2.5 py-1.5 text-[12px] text-text-main" data-testid="aviso-contraste">
          Texto pode ficar difícil de ler com essas cores.
        </p>
      )}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Prévia na vitrine</div>
        <div className="font-loja" data-testid="aviso-previa">
          <AvisoVitrine texto={texto.trim() || 'Seu aviso aparece assim no cardápio'} estilo={estilo} />
        </div>
      </div>
    </div>
  )
}
