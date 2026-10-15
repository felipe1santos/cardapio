'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { ModalCentral } from '@/components/ui/flutuante'
import { normalizarHex } from '@/lib/aviso-vitrine'
import { PALETAS, temaCores } from '@/lib/paletas'

/**
 * Cor da loja em Ajustes › Perfil (15/10): no card fica só a bolinha da cor em uso; o clique abre a
 * janela com as cores prontas, a cor livre (seletor ou hexadecimal) e a prévia. A escolha vale na hora
 * no formulário — grava junto com o "Salvar alterações", como antes.
 */
export function SeletorCorLoja({ corSelecionada, corCustom, onEscolher }: {
  /** Chave de PALETAS ou 'custom'. */
  corSelecionada: string
  corCustom: string
  onEscolher: (cor: { chave: string; custom?: string }) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [hex, setHex] = useState('')
  const custom = corSelecionada === 'custom'
  const atual = custom ? temaCores(corCustom) : (PALETAS[corSelecionada] ?? PALETAS.azul)
  const nome = custom ? 'Cor personalizada' : (PALETAS[corSelecionada]?.nome ?? 'Azul')
  const escolherLivre = (valor: string) => onEscolher({ chave: 'custom', custom: valor.toLowerCase() })

  return (
    <>
      <button type="button" onClick={() => { setHex(custom ? corCustom.toUpperCase() : ''); setAberto(true) }} data-testid="abrir-cor-loja"
        className="group flex items-center gap-3 rounded-[8px] border border-border bg-white py-2 pl-2 pr-4 text-left transition-colors hover:border-primary">
        <span className="h-[34px] w-[34px] flex-shrink-0 rounded-full border border-black/10 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.6)]"
          style={{ background: custom ? corCustom : `linear-gradient(135deg, ${atual.from}, ${atual.primaria})` }} aria-hidden />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-text-main">{nome}</span>
          <span className="block text-[11.5px] uppercase tabular-nums text-text-subtle">{atual.primaria}</span>
        </span>
        <span className="ml-2 text-[12px] font-semibold text-primary group-hover:underline">Trocar</span>
      </button>

      <ModalCentral aberto={aberto} onFechar={() => setAberto(false)} titulo="Cor da loja" subtitulo="Botões, categorias, destaques e ícones do cardápio." largura={460} testid="modal-cor-loja"
        rodape={<div className="flex justify-end"><button type="button" onClick={() => setAberto(false)} className="h-[36px] rounded-[6px] bg-[#0688D4] px-5 text-[12px] font-semibold uppercase tracking-wide text-white hover:bg-[#0570AE]">Pronto</button></div>}>
        <div className="space-y-5 p-4 sm:p-5">
          <div>
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Cores prontas</p>
            <div className="grid grid-cols-5 gap-3" data-testid="paleta-loja">
              {Object.entries(PALETAS).map(([chave, p]) => {
                const ativa = corSelecionada === chave
                return (
                  <button key={chave} type="button" onClick={() => onEscolher({ chave })} aria-pressed={ativa} aria-label={p.nome} title={p.nome} data-testid={`paleta-${chave}`}
                    className="flex flex-col items-center gap-1.5">
                    <span className="relative flex h-[38px] w-[38px] items-center justify-center rounded-full border border-black/10 transition-transform hover:scale-110"
                      style={{ background: `linear-gradient(135deg, ${p.from}, ${p.primaria})`, boxShadow: ativa ? `0 0 0 2px #fff, 0 0 0 4px ${p.primaria}` : undefined }}>
                      {ativa && <Check className="h-4 w-4 text-white" strokeWidth={3} aria-hidden />}
                    </span>
                    <span className={`text-[11px] ${ativa ? 'font-semibold text-text-main' : 'text-text-subtle'}`}>{p.nome}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Outra cor</p>
            <div className="flex items-center gap-2">
              <label className="relative h-[38px] w-[38px] flex-shrink-0 cursor-pointer rounded-full border border-border shadow-[inset_0_0_0_2px_#fff]" style={{ backgroundColor: corCustom, boxShadow: custom ? `0 0 0 2px #fff, 0 0 0 4px ${corCustom}` : undefined }} title="Escolher qualquer cor">
                <span className="sr-only">Cor personalizada</span>
                <input type="color" value={corCustom} onChange={(e) => { setHex(e.target.value.toUpperCase()); escolherLivre(e.target.value) }} className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0" data-testid="cor-personalizada" />
              </label>
              <input type="text" value={hex} placeholder="#HEX" maxLength={7} autoComplete="off" spellCheck={false} aria-label="Cor personalizada em hexadecimal" data-testid="cor-personalizada-hex"
                onChange={(e) => { setHex(e.target.value); const n = normalizarHex(e.target.value); if (n) escolherLivre(n) }}
                className="h-[38px] w-[120px] rounded-[6px] border border-border bg-white px-2.5 text-[13px] uppercase tabular-nums text-text-main outline-none focus:border-primary" />
              <span className="text-[12px] text-text-subtle">Toque na bolinha ou digite o código.</span>
            </div>
          </div>

          <div>
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Prévia</p>
            <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-border bg-page p-3" aria-label="Prévia das cores" data-testid="previa-cores">
              <span className="rounded-[6px] px-3.5 py-1.5 text-[12.5px] font-semibold text-white" style={{ backgroundColor: atual.primaria }}>Adicionar</span>
              <span className="rounded-[6px] border px-3.5 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: atual.primaria, color: atual.dark, backgroundColor: atual.light }}>Ver cardápio</span>
              <span className="rounded-full px-3 py-1 text-[12px] font-semibold" style={{ backgroundColor: atual.light, color: atual.dark }}>Lanches</span>
              <span className="rounded-full px-3 py-1 text-[12px] font-semibold text-white" style={{ backgroundColor: atual.primaria }}>Combos</span>
            </div>
          </div>
        </div>
      </ModalCentral>
    </>
  )
}
