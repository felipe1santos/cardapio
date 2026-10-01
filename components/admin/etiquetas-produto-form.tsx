'use client'

import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { EtiquetasPrincipais, EtiquetasUtilitarias, LojaEtiquetasContext, PrecoVitrine } from '@/components/vitrine/etiquetas'

/** Campos do formulário do item que esta seção usa (ver app/admin/cardapio/page.tsx). */
export interface FormEtiquetas {
  nome: string
  descricao: string
  preco: string
  promocaoPreco: string
  maisVendido: boolean
  novidade: boolean
  novidadeAteAtual: string | null
  novidadeDias: string
  edicaoLimitada: boolean
  itemPromocional: boolean
  entregaGratis: boolean
  servePessoas: string
}

function numero(v: string): number {
  const n = Number(v.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function Caixa({ checked, onChange, children, dica, testid }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; dica?: string; testid?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-menuzia border border-border px-2.5 py-2 text-[13px] text-text-main hover:bg-page">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-[3px] h-3.5 w-3.5 accent-primary" data-testid={testid} />
      <span>
        <span className="font-medium">{children}</span>
        {dica && <span className="block text-[11px] text-text-subtle">{dica}</span>}
      </span>
    </label>
  )
}

/**
 * "Etiquetas do produto" no cadastro (2026-09-30), com prévia ao vivo de como o item
 * aparece na vitrine. "Mais pedido" é a estrela do item (a regra de sempre).
 */
export function EtiquetasProdutoForm<T extends FormEtiquetas>({ form, setForm, freteGratisAcima }: { form: T; setForm: Dispatch<SetStateAction<T>>; freteGratisAcima: number | null }) {
  const set = (patch: Partial<FormEtiquetas>) => setForm((prev) => ({ ...prev, ...patch }))
  const novidadeValida = !!form.novidadeAteAtual && Date.parse(form.novidadeAteAtual) > Date.now()
  const novidadeAte = form.novidade
    ? (novidadeValida ? form.novidadeAteAtual : new Date(Date.now() + (Number(form.novidadeDias) || 30) * 86_400_000).toISOString())
    : null
  const previa = {
    maisVendido: form.maisVendido,
    novidadeAte,
    edicaoLimitada: form.edicaoLimitada,
    itemPromocional: form.itemPromocional,
    entregaGratis: form.entregaGratis,
    servePessoas: form.servePessoas.trim() ? Math.round(numero(form.servePessoas)) : null,
  }
  const preco = numero(form.preco)
  const promo = form.promocaoPreco.trim() ? numero(form.promocaoPreco) : null
  const regraFrete = freteGratisAcima
    ? `Mostra "a partir de R$ ${freteGratisAcima.toFixed(2).replace('.', ',')}" (regra de frete grátis da loja).`
    : 'Sem regra de frete grátis na loja: mostra só "Entrega grátis".'
  return (
    <div className="mt-4" data-testid="etiquetas-produto">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Etiquetas do produto</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Caixa checked={form.maisVendido} onChange={(v) => set({ maisVendido: v })} dica="A estrela do item. Aparece como Mais pedido 🔥." testid="etiqueta-mais-pedido">Mais pedido</Caixa>
        <div className="rounded-menuzia border border-border px-2.5 py-2">
          <label className="flex cursor-pointer items-start gap-2 text-[13px] text-text-main">
            <input type="checkbox" checked={form.novidade} onChange={(e) => set({ novidade: e.target.checked })} className="mt-[3px] h-3.5 w-3.5 accent-primary" data-testid="etiqueta-novidade" />
            <span className="font-medium">Marcar como novidade</span>
          </label>
          {form.novidade && (
            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-text-subtle">
              {novidadeValida && form.novidadeAteAtual ? (
                <>Sai sozinha em {new Date(form.novidadeAteAtual).toLocaleDateString('pt-BR')}</>
              ) : (
                <>
                  Sai sozinha depois de
                  <input value={form.novidadeDias} onChange={(e) => set({ novidadeDias: e.target.value.replace(/\D/g, '').slice(0, 3) })} className="w-10 rounded-menuzia border border-border px-1 py-0.5 text-center text-[12px]" inputMode="numeric" />
                  dias
                </>
              )}
            </span>
          )}
        </div>
        <Caixa checked={form.edicaoLimitada} onChange={(v) => set({ edicaoLimitada: v })} testid="etiqueta-edicao-limitada">Edição limitada</Caixa>
        <Caixa checked={form.itemPromocional} onChange={(v) => set({ itemPromocional: v })} testid="etiqueta-promocional">Item promocional</Caixa>
        <Caixa checked={form.entregaGratis} onChange={(v) => set({ entregaGratis: v })} dica={regraFrete} testid="etiqueta-entrega-gratis">Entrega grátis</Caixa>
        <label className="flex items-center gap-2 rounded-menuzia border border-border px-2.5 py-2 text-[13px] font-medium text-text-main">
          Serve
          <input value={form.servePessoas} onChange={(e) => set({ servePessoas: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="—" inputMode="numeric" className="w-12 rounded-menuzia border border-border px-1.5 py-1 text-center text-[13px]" data-testid="etiqueta-serve" />
          pessoas <span className="text-[11px] font-normal text-text-subtle">(opcional)</span>
        </label>
      </div>
      <p className="mt-1.5 text-[11px] text-text-subtle">No máximo 2 etiquetas coloridas aparecem acima do nome (ordem: Mais pedido, Novidade, Edição limitada).</p>

      {/* Prévia ao vivo, com a fonte e as medidas da vitrine. */}
      <div className="mt-3 rounded-menuzia border border-dashed border-border bg-page p-3" data-testid="etiquetas-previa">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Prévia na vitrine</div>
        <LojaEtiquetasContext.Provider value={{ freteGratisAcima }}>
          <div className="font-loja max-w-[360px] rounded-[8px] bg-white p-[12px]">
            <EtiquetasPrincipais item={previa} className="mb-[6px]" />
            <div className="line-clamp-2 text-[14px] font-semibold leading-[16px] text-[var(--v-texto)]">{form.nome || 'Nome do produto'}</div>
            {form.descricao && <div className="mt-[8px] line-clamp-2 text-[12px] leading-[16px] text-[var(--v-secundario)]">{form.descricao}</div>}
            <EtiquetasUtilitarias item={previa} className="mt-[8px]" />
            <div className="mt-[8px]">
              <PrecoVitrine price={promo ?? preco} originalPrice={promo !== null && promo < preco ? preco : null} />
            </div>
          </div>
        </LojaEtiquetasContext.Provider>
      </div>
    </div>
  )
}
