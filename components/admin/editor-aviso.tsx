'use client'

import { useState } from 'react'
import { AvisoVitrine } from '@/components/vitrine/aviso-vitrine'
import { AVISO_PADRAO, contrasteBaixo, normalizarHex, type EstiloAviso } from '@/lib/aviso-vitrine'

/**
 * Uma cor, compacta (2026-10-06): amostra que abre o seletor do navegador + campo #HEX. Nulo = a cor
 * da loja (o visual de sempre) — a amostra mostra essa cor e o campo fica vazio.
 */
function EscolhaCor({ rotulo, valor, padrao, onChange, testid }: { rotulo: string; valor: string | null; padrao: string; onChange: (v: string | null) => void; testid: string }) {
  const [hex, setHex] = useState(valor ?? '')
  const mostrada = valor ?? padrao
  return (
    <div data-testid={testid}>
      <div className="mb-1.5 text-[12px] font-medium text-text-subtle">{rotulo}</div>
      <div className="flex items-center gap-2">
        <label className="relative h-[36px] w-[36px] flex-shrink-0 cursor-pointer rounded-[6px] border border-border shadow-[inset_0_0_0_2px_#fff]" style={{ backgroundColor: mostrada }} title="Escolher cor">
          <span className="sr-only">{rotulo}: escolher no seletor de cores</span>
          <input
            type="color"
            value={mostrada.length === 7 ? mostrada.toLowerCase() : '#000000'}
            onChange={(e) => { const n = normalizarHex(e.target.value); if (n) { onChange(n); setHex(n) } }}
            data-testid={`${testid}-seletor`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <input
          type="text"
          value={hex}
          onChange={(e) => { setHex(e.target.value); const n = normalizarHex(e.target.value); if (n) onChange(n) }}
          placeholder={valor === null ? 'Cor da loja' : '#HEX'}
          maxLength={7}
          autoComplete="off"
          spellCheck={false}
          name={`${testid}-hex`}
          aria-label={`${rotulo} em hexadecimal`}
          data-testid={`${testid}-hex`}
          className="h-[36px] w-[112px] rounded-[6px] border border-border bg-white px-2.5 text-[13px] uppercase tabular-nums text-text-main outline-none placeholder:normal-case placeholder:text-text-subtle focus:border-primary"
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
export function EditorAviso({ texto, estilo, onChange, corLoja = '#0688D4', corLojaClara = '#E0F2FE' }: {
  texto: string; estilo: EstiloAviso; onChange: (e: EstiloAviso) => void
  /** Cor do tema da loja e o tom claro dela: é o que a vitrine usa quando a cor fica nula. */
  corLoja?: string; corLojaClara?: string
}) {
  const [chave, setChave] = useState(0)
  const baixo = (estilo.corTexto || estilo.corFundo) ? contrasteBaixo(estilo) : false
  return (
    <div className="mt-3 space-y-3 rounded-[8px] border border-border bg-page p-3.5" data-testid="editor-aviso">
      <div className="grid gap-3 sm:grid-cols-2" key={chave}>
        <EscolhaCor rotulo="Cor do texto" valor={estilo.corTexto} padrao="#1F2937" onChange={(v) => onChange({ ...estilo, corTexto: v })} testid="aviso-cor-texto" />
        <EscolhaCor rotulo="Cor do fundo" valor={estilo.corFundo} padrao={corLojaClara} onChange={(v) => onChange({ ...estilo, corFundo: v })} testid="aviso-cor-fundo" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium text-text-main">
          <input type="checkbox" checked={estilo.pulsar} onChange={(e) => onChange({ ...estilo, pulsar: e.target.checked })} className="h-3.5 w-3.5 accent-primary" data-testid="aviso-pulsar" />
          Efeito pulsar
        </label>
        {/* Único atalho: volta às cores da loja (nulo no banco = o visual de sempre). */}
        <button
          type="button"
          onClick={() => { onChange({ ...AVISO_PADRAO, pulsar: estilo.pulsar }); setChave((k) => k + 1) }}
          className="inline-flex items-center gap-2 rounded-[6px] border border-border bg-white px-3 py-1.5 text-[12.5px] font-semibold text-text-main hover:bg-page"
          data-testid="aviso-padrao"
        >
          <span aria-hidden className="h-[14px] w-[14px] rounded-full border border-black/10" style={{ backgroundColor: corLoja }} />
          Usar a cor da loja
        </button>
      </div>
      {baixo && (
        <p className="rounded-menuzia bg-warn-bg px-2.5 py-1.5 text-[12px] text-text-main" data-testid="aviso-contraste">
          Texto pode ficar difícil de ler com essas cores.
        </p>
      )}
      <div>
        <div className="mb-1.5 text-[12px] font-medium text-text-subtle">Prévia na vitrine</div>
        <div className="font-loja" data-testid="aviso-previa" style={{ ['--tema-primaria' as string]: corLoja, ['--tema-light' as string]: corLojaClara }}>
          <AvisoVitrine texto={texto.trim() || 'Seu aviso aparece assim no cardápio'} estilo={estilo} />
        </div>
      </div>
    </div>
  )
}
