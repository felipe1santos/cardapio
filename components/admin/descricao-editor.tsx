'use client'

import { useRef, useState } from 'react'
import { Bold, Eraser } from 'lucide-react'
import {
  CORES_DESCRICAO,
  aplicarMarcacao,
  pedacosDaDescricao,
  type CorDescricao,
} from '@/lib/descricao-rica'

/**
 * Campo de descrição do item com negrito e cor.
 *
 * É um `<textarea>` comum, não um editor rico: o que fica gravado continua
 * sendo texto, com a marcação de `lib/descricao-rica.ts`. Isso mantém o valor
 * legível no banco, no recibo e no WhatsApp, e tira do caminho a sanitização
 * que um campo de HTML exigiria em toda exibição.
 *
 * Os botões agem sobre a SELEÇÃO — quem escreve marca o pedaço que quer
 * destacar, como faria no WhatsApp. Sem nada selecionado eles não fazem nada, e
 * a dica ao lado explica o porquê em vez de deixar o clique morrer calado.
 *
 * A prévia embaixo mostra o resultado com a mesma cor e peso da vitrine: sem
 * ela, a marcação seria um código que só se entende depois de salvar e abrir o
 * cardápio no celular.
 */
export function DescricaoEditor({
  valor,
  onChange,
  placeholder,
}: {
  valor: string
  onChange: (texto: string) => void
  placeholder?: string
}) {
  const campo = useRef<HTMLTextAreaElement>(null)
  const [paletaAberta, setPaletaAberta] = useState(false)
  const [semSelecao, setSemSelecao] = useState(false)

  function marcar(marca: Parameters<typeof aplicarMarcacao>[3]) {
    const el = campo.current
    if (!el) return
    const { selectionStart, selectionEnd } = el
    if (selectionStart === selectionEnd) {
      setSemSelecao(true)
      el.focus()
      return
    }
    setSemSelecao(false)
    const r = aplicarMarcacao(valor, selectionStart, selectionEnd, marca)
    onChange(r.texto)
    setPaletaAberta(false)
    // A seleção precisa voltar depois que o React repinta o valor, senão o
    // cursor cai no fim do campo e o lojista perde o lugar onde estava.
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(r.selecao[0], r.selecao[1])
    })
  }

  function limparMarcacao() {
    onChange(
      pedacosDaDescricao(valor)
        .map((p) => p.texto)
        .join(''),
    )
    setPaletaAberta(false)
  }

  const pedacos = pedacosDaDescricao(valor)
  const temMarcacao = pedacos.some((p) => p.negrito || p.cor !== null)

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => marcar({ tipo: 'negrito' })}
          className="flex h-[30px] items-center gap-1 rounded-menuzia border border-border px-2 text-[12px] font-bold text-text-main transition-colors hover:border-primary hover:text-primary"
          title="Deixar o trecho selecionado em negrito"
        >
          <Bold className="h-3.5 w-3.5" strokeWidth={2.6} />
          Negrito
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setPaletaAberta((a) => !a)}
            aria-expanded={paletaAberta}
            className="flex h-[30px] items-center gap-1.5 rounded-menuzia border border-border px-2 text-[12px] font-semibold text-text-main transition-colors hover:border-primary hover:text-primary"
            title="Pintar o trecho selecionado"
          >
            <span className="h-3.5 w-3.5 rounded-full bg-gradient-to-br from-[#DC2626] via-[#7C3AED] to-[#15803D]" />
            Cor
          </button>
          {paletaAberta && (
            <div className="absolute left-0 top-[34px] z-20 w-[186px] rounded-menuzia border border-border bg-white p-2 shadow-lg">
              <div className="grid grid-cols-4 gap-1.5">
                {CORES_DESCRICAO.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => marcar({ tipo: 'cor', cor: c.id as CorDescricao })}
                    title={c.label}
                    aria-label={c.label}
                    className="h-[30px] w-[30px] rounded-menuzia border border-border transition-transform hover:scale-110"
                    style={{ backgroundColor: c.valor }}
                  />
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-text-subtle">
                Segure para ver o nome. A cor vale só para o trecho selecionado.
              </p>
            </div>
          )}
        </div>

        {temMarcacao && (
          <button
            type="button"
            onClick={limparMarcacao}
            className="flex h-[30px] items-center gap-1 rounded-menuzia border border-border px-2 text-[12px] font-semibold text-text-subtle transition-colors hover:border-danger hover:text-danger"
            title="Tirar todo o negrito e as cores desta descrição"
          >
            <Eraser className="h-3.5 w-3.5" />
            Limpar
          </button>
        )}
      </div>

      <textarea
        ref={campo}
        value={valor}
        onChange={(e) => {
          onChange(e.target.value)
          if (semSelecao) setSemSelecao(false)
        }}
        onSelect={() => semSelecao && setSemSelecao(false)}
        rows={3}
        placeholder={placeholder}
        className="w-full resize-y rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] leading-relaxed text-text-main outline-none focus:border-primary"
      />

      {semSelecao ? (
        <p className="mt-1 text-[11px] font-semibold text-warn">
          Selecione primeiro o trecho que você quer destacar, depois toque em Negrito ou Cor.
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-text-subtle">
          Uma boa descrição ajuda o cliente a decidir — liste os principais ingredientes. Para destacar um pedaço,
          selecione-o e use Negrito ou Cor.
        </p>
      )}

      {temMarcacao && (
        <div className="mt-2 rounded-menuzia border border-border bg-page px-2.5 py-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-text-subtle">Como o cliente vê</div>
          <p className="text-[12px] leading-[16px] text-[#5C5C5C]">
            {pedacos.map((p, i) => (
              <span key={i} style={{ fontWeight: p.negrito ? 600 : undefined, color: p.cor ?? undefined }}>
                {p.texto}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  )
}
