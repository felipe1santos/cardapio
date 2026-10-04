'use client'

import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { EtiquetasUtilitarias, NomeComEtiquetas, PrecoVitrine, SeloMaisPedidos } from '@/components/vitrine/etiquetas'
import { etiquetasTopoLigadas, MAX_TOPO, ROTULO_MAIS_PEDIDOS, TAG_PERSONALIZADA_MAX, textoServe } from '@/lib/etiquetas-vitrine'

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
  comboEspecial: boolean
  edicaoLimitada: boolean
  itemPromocional: boolean
  servePessoas: string
  tagPersonalizadaLigada: boolean
  tagPersonalizada: string
  tagPersonalizadaCor: 'preta' | 'azul'
  /** Foto do item, só para a prévia do cartão. */
  imagemUrl?: string | null
  imagemThumbUrl?: string | null
}

export const SERVE_MIN = 1
export const SERVE_MAX = 20
export const SERVE_PADRAO = 2

function numero(v: string): number {
  const n = Number(v.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function Interruptor({ checked, onChange, children, dica, testid }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; dica?: ReactNode; testid?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-menuzia border border-border px-2.5 py-2 text-[13px] text-text-main hover:bg-page">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-[3px] h-3.5 w-3.5 accent-primary" data-testid={testid} />
      <span className="min-w-0">
        <span className="font-medium">{children}</span>
        {dica && <span className="block text-[11px] text-text-subtle">{dica}</span>}
      </span>
    </label>
  )
}

/**
 * "Etiquetas do produto" no cadastro (2026-10-01), com prévia AO VIVO feita com os mesmos
 * componentes da vitrine. "Mostrar como Mais Pedidos" é a mesma estrela ★ da lista do Cardápio: o item
 * ganha o selo sobre a foto e entra na seção "Mais Pedidos" (P8, 2026-10-04).
 */
export function EtiquetasProdutoForm<T extends FormEtiquetas>({ form, setForm }: { form: T; setForm: Dispatch<SetStateAction<T>>; freteGratisAcima?: number | null }) {
  const set = (patch: Partial<FormEtiquetas>) => setForm((prev) => ({ ...prev, ...patch }))
  const novidadeValida = !!form.novidadeAteAtual && Date.parse(form.novidadeAteAtual) > Date.now()
  const novidadeAte = form.novidade
    ? (novidadeValida ? form.novidadeAteAtual : new Date(Date.now() + (Number(form.novidadeDias) || 30) * 86_400_000).toISOString())
    : null
  const serve = form.servePessoas.trim() ? Math.max(SERVE_MIN, Math.min(SERVE_MAX, Math.round(numero(form.servePessoas)))) : null
  const previa = {
    maisVendido: form.maisVendido,
    novidadeAte,
    comboEspecial: form.comboEspecial,
    edicaoLimitada: form.edicaoLimitada,
    itemPromocional: form.itemPromocional,
    servePessoas: serve,
    tagPersonalizada: form.tagPersonalizadaLigada ? form.tagPersonalizada : null,
    tagPersonalizadaCor: form.tagPersonalizadaCor,
  }
  const topoLigadas = etiquetasTopoLigadas(previa).length
  const preco = numero(form.preco)
  const promo = form.promocaoPreco.trim() ? numero(form.promocaoPreco) : null
  const foto = form.imagemThumbUrl ?? form.imagemUrl ?? null
  const mudarServe = (delta: number) => set({ servePessoas: String(Math.max(SERVE_MIN, Math.min(SERVE_MAX, (serve ?? SERVE_PADRAO) + delta))) })

  return (
    <div className="mt-4" data-testid="etiquetas-produto">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Etiquetas do produto</div>

      <div className="mb-2">
        <Interruptor checked={form.maisVendido} onChange={(v) => set({ maisVendido: v })} testid="etiqueta-mais-pedidos"
          dica={<>Selo &quot;{ROTULO_MAIS_PEDIDOS}&quot; sobre a foto e o produto entra na seção &quot;{ROTULO_MAIS_PEDIDOS}&quot; da vitrine. É a mesma estrela ★ da lista do Cardápio.</>}>
          Mostrar como {ROTULO_MAIS_PEDIDOS}
        </Interruptor>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Interruptor checked={form.comboEspecial} onChange={(v) => set({ comboEspecial: v })} testid="etiqueta-combo">Combo especial</Interruptor>
        <Interruptor checked={form.edicaoLimitada} onChange={(v) => set({ edicaoLimitada: v })} testid="etiqueta-oferta-limitada">Oferta limitada</Interruptor>
        <div className="rounded-menuzia border border-border px-2.5 py-2">
          <label className="flex cursor-pointer items-start gap-2 text-[13px] text-text-main">
            <input type="checkbox" checked={form.novidade} onChange={(e) => set({ novidade: e.target.checked })} className="mt-[3px] h-3.5 w-3.5 accent-primary" data-testid="etiqueta-novidade" />
            <span className="font-medium">Novidade</span>
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
        <Interruptor checked={form.itemPromocional} onChange={(v) => set({ itemPromocional: v })} testid="etiqueta-promocional">Item promocional</Interruptor>

        {/* Serve até X pessoas: liga/desliga + − / + (1 a 20, começa em 2). */}
        <div className="rounded-menuzia border border-border px-2.5 py-2">
          <label className="flex cursor-pointer items-start gap-2 text-[13px] text-text-main">
            <input type="checkbox" checked={serve !== null} onChange={(e) => set({ servePessoas: e.target.checked ? String(SERVE_PADRAO) : '' })} className="mt-[3px] h-3.5 w-3.5 accent-primary" data-testid="etiqueta-serve-ligar" />
            <span className="font-medium">Serve até X pessoas</span>
          </label>
          {serve !== null && (
            <div className="mt-1.5 flex items-center gap-2">
              <button type="button" onClick={() => mudarServe(-1)} disabled={serve <= SERVE_MIN} aria-label="Menos uma pessoa" className="flex h-7 w-7 items-center justify-center rounded-menuzia border border-border text-[15px] font-semibold disabled:opacity-40" data-testid="serve-menos">−</button>
              <span className="w-6 text-center text-[13px] font-semibold" data-testid="serve-valor">{serve}</span>
              <button type="button" onClick={() => mudarServe(1)} disabled={serve >= SERVE_MAX} aria-label="Mais uma pessoa" className="flex h-7 w-7 items-center justify-center rounded-menuzia border border-border text-[15px] font-semibold disabled:opacity-40" data-testid="serve-mais">+</button>
              <span className="text-[12px] text-text-subtle" data-testid="serve-texto">{textoServe(serve)}</span>
            </div>
          )}
        </div>

        {/* Tag personalizada: texto livre (24) + cor. */}
        <div className="rounded-menuzia border border-border px-2.5 py-2">
          <label className="flex cursor-pointer items-start gap-2 text-[13px] text-text-main">
            <input type="checkbox" checked={form.tagPersonalizadaLigada} onChange={(e) => set({ tagPersonalizadaLigada: e.target.checked })} className="mt-[3px] h-3.5 w-3.5 accent-primary" data-testid="etiqueta-personalizada-ligar" />
            <span className="font-medium">Tag personalizada</span>
          </label>
          {form.tagPersonalizadaLigada && (
            <div className="mt-1.5 space-y-1.5">
              <div className="relative">
                <input
                  value={form.tagPersonalizada}
                  onChange={(e) => set({ tagPersonalizada: e.target.value.replace(/[\r\n]/g, '').slice(0, TAG_PERSONALIZADA_MAX) })}
                  maxLength={TAG_PERSONALIZADA_MAX}
                  placeholder="Ex.: Receita da casa"
                  className="w-full rounded-menuzia border border-border px-2 py-1 pr-12 text-[12.5px] outline-none focus:border-primary"
                  data-testid="etiqueta-personalizada-texto"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] text-text-subtle" data-testid="etiqueta-personalizada-contador">{form.tagPersonalizada.length}/{TAG_PERSONALIZADA_MAX}</span>
              </div>
              <div className="flex gap-1.5">
                {(['preta', 'azul'] as const).map((c) => (
                  <button key={c} type="button" onClick={() => set({ tagPersonalizadaCor: c })} data-testid={`etiqueta-personalizada-${c}`}
                    className={['rounded-menuzia border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide', form.tagPersonalizadaCor === c ? 'border-primary text-primary' : 'border-border text-text-subtle'].join(' ')}>
                    {c === 'preta' ? 'Preta' : 'Azul'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {topoLigadas > MAX_TOPO && (
        <p className="mt-2 rounded-menuzia bg-warn-bg px-2.5 py-1.5 text-[12px] text-text-main" data-testid="aviso-topo">
          Só as 2 mais importantes aparecem na vitrine (ordem: Combo especial, Oferta limitada, Novidade).
        </p>
      )}

      {/* Prévia ao vivo, com os componentes, a fonte e as medidas da vitrine. */}
      <div className="mt-3 rounded-menuzia border border-dashed border-border bg-page p-3" data-testid="etiquetas-previa">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Prévia na vitrine</div>
        {/* Mesmo cartão da lista da vitrine: texto à esquerda, foto de 120 px à direita com o selo. */}
        <div className="font-loja flex max-w-[380px] gap-[12px] rounded-[8px] bg-white py-[12px] pl-[12px] pr-[8px]" data-testid="previa-cartao">
          <div className="min-w-0 flex-1">
            <NomeComEtiquetas item={previa} className="line-clamp-2 text-[14px] font-semibold leading-[16px] text-[var(--v-texto)]">
              {form.nome || 'Nome do produto'}
            </NomeComEtiquetas>
            {form.descricao && <div className="mt-[8px] line-clamp-2 text-[12px] leading-[16px] text-[var(--v-secundario)]">{form.descricao}</div>}
            <EtiquetasUtilitarias item={previa} className="mt-[8px]" />
            <div className="mt-[8px]">
              <PrecoVitrine price={promo ?? preco} originalPrice={promo !== null && promo < preco ? preco : null} />
            </div>
          </div>
          <div className="relative h-[120px] w-[120px] flex-shrink-0">
            {foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foto} alt="" className="h-[120px] w-[120px] rounded-[8px] object-cover" />
            ) : (
              <div className="flex h-[120px] w-[120px] items-center justify-center rounded-[8px] bg-[var(--v-placeholder)] text-center text-[11px] text-[var(--v-secundario)]">Sem foto</div>
            )}
            {form.maisVendido && <SeloMaisPedidos raio={8} />}
          </div>
        </div>
      </div>
    </div>
  )
}
