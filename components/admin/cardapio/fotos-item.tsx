'use client'

/**
 * Fotos do item no painel — até 4, a 1ª é a principal (lista, destaques, "Mais pedidos"). Adicionar, remover,
 * reordenar (setas) e escolher a principal. Só com "Novidades em teste" (0178); sem a chave, o formulário de sempre.
 * Upload pelo mesmo caminho de sempre (otimiza para 1200 px / WebP + miniatura de 400 px).
 */
import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Star, X } from 'lucide-react'
import { adicionarFoto, LIMITE_FOTOS, moverFoto, removerFoto, tornarPrincipal, validarArquivoFoto, type Foto } from '@/lib/fotos-item'

const BOTAO = 'flex h-[28px] w-[28px] items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/75 disabled:opacity-40'

export function FotosDoItem({ fotos, onChange, enviar, nome }: {
  fotos: Foto[]
  onChange: (fotos: Foto[]) => void
  /** Sobe o arquivo e devolve a foto (url + miniatura). */
  enviar: (arquivo: File) => Promise<Foto>
  nome: string
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    const problema = validarArquivoFoto(arquivo)
    if (problema) { setErro(problema); return }
    if (fotos.length >= LIMITE_FOTOS) { setErro(`No máximo ${LIMITE_FOTOS} fotos por item.`); return }
    setErro(null)
    setEnviando(true)
    try {
      const nova = await enviar(arquivo)
      const r = adicionarFoto(fotos, nova)
      if (!r.ok) setErro(`No máximo ${LIMITE_FOTOS} fotos por item.`)
      else onChange(r.fotos)
    } catch {
      setErro('Não foi possível enviar a foto. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div data-testid="fotos-item">
      <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp,image/*" className="hidden" onChange={escolher} data-testid="fotos-item-arquivo" />
      <div className="mx-auto grid max-w-[232px] grid-cols-2 gap-2 md:max-w-none">
        {fotos.map((f, i) => (
          <div key={f.url} className="relative aspect-square overflow-hidden rounded-[6px] border border-[#e5e7eb] bg-[#f3f4f6]" data-testid="foto-item">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.thumb ?? f.url} alt={`${nome || 'Produto'} — foto ${i + 1}`} className="h-full w-full object-cover" />
            {i === 0 && <span className="absolute left-1 top-1 rounded-[4px] bg-[#0688D4] px-1.5 py-[1px] text-[10.5px] font-semibold text-white" data-testid="foto-principal">Principal</span>}
            <button type="button" aria-label={`Remover foto ${i + 1}`} className={`absolute right-1 top-1 ${BOTAO}`} onClick={() => onChange(removerFoto(fotos, i))} data-toque-livre data-testid="foto-remover-item"><X className="h-3.5 w-3.5" /></button>
            <div className="absolute inset-x-1 bottom-1 flex items-center justify-between gap-1">
              <button type="button" aria-label={`Mover foto ${i + 1} para a esquerda`} className={BOTAO} disabled={i === 0} onClick={() => onChange(moverFoto(fotos, i, -1))} data-toque-livre><ChevronLeft className="h-4 w-4" /></button>
              {i > 0 && (
                <button type="button" aria-label={`Usar a foto ${i + 1} como principal`} className={`${BOTAO} w-auto gap-1 px-2 text-[10.5px] font-semibold`} onClick={() => onChange(tornarPrincipal(fotos, i))} data-toque-livre data-testid="foto-tornar-principal">
                  <Star className="h-3 w-3" /> Principal
                </button>
              )}
              <button type="button" aria-label={`Mover foto ${i + 1} para a direita`} className={BOTAO} disabled={i === fotos.length - 1} onClick={() => onChange(moverFoto(fotos, i, 1))} data-toque-livre><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
        {fotos.length < LIMITE_FOTOS && (
          <button type="button" onClick={() => entrada.current?.click()} disabled={enviando}
            className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-[#c9d2dc] text-[#6b7280] hover:border-[#0688d4] hover:text-[#0688d4]"
            data-testid="foto-item-adicionar">
            {enviando ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-7 w-7" />}
            <span className="text-[12px] font-semibold">{enviando ? 'Enviando…' : fotos.length === 0 ? 'Adicionar foto' : 'Mais uma foto'}</span>
          </button>
        )}
      </div>
      {erro && <p className="mt-1.5 text-[12px] font-medium text-[#b91c1c]" role="alert" data-testid="fotos-item-erro">{erro}</p>}
      <p className="mt-1.5 text-[11.5px] text-[#6b7280]">Até {LIMITE_FOTOS} fotos. A 1ª é a principal (aparece na lista). No cardápio, o cliente passa as fotos ao abrir o item.</p>
    </div>
  )
}
