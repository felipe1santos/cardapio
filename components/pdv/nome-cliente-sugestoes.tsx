'use client'

import { useEffect, useRef, useState } from 'react'
import { mascararTelefone } from './util'

interface Sugestao { nome: string; telefone: string; ultimaCompraEm: string }

/**
 * Campo "Nome do cliente" com sugestões da base da loja (2026-10-01): a partir de 2
 * caracteres (nome ou telefone), espera 200 ms, mostra nome + telefone + última compra.
 * Tocar (ou Enter) preenche nome e telefone — o servidor vincula o cadastro pelo telefone.
 * Digitar um nome novo sem escolher continua valendo. Setas ↑/↓ navegam, Esc fecha.
 */
export function NomeClienteComSugestoes({
  nome, setNome, setTelefone, testid, className, autoFocus = true,
}: {
  nome: string
  setNome: (v: string) => void
  setTelefone: (v: string) => void
  testid: string
  className: string
  autoFocus?: boolean
}) {
  const [lista, setLista] = useState<Sugestao[]>([])
  const [aberta, setAberta] = useState(false)
  const [ativa, setAtiva] = useState(-1)
  const escolhido = useRef<string | null>(null)

  useEffect(() => {
    const q = nome.trim()
    if (q.length < 2 || escolhido.current === q) { setLista([]); return }
    let vivo = true
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/sugestoes-clientes?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        const d = (await r.json()) as { sugestoes?: Sugestao[] }
        if (vivo) { setLista(d.sugestoes ?? []); setAtiva(-1); setAberta(true) }
      } catch { if (vivo) setLista([]) }
    }, 200)
    return () => { vivo = false; clearTimeout(t) }
  }, [nome])

  function escolher(s: Sugestao) {
    escolhido.current = s.nome
    setNome(s.nome)
    setTelefone(mascararTelefone(s.telefone.replace(/^55/, '')))
    setLista([])
    setAberta(false)
  }

  return (
    <div className="relative">
      <input
        autoFocus={autoFocus}
        value={nome}
        maxLength={60}
        autoComplete="off"
        name={`${testid}-cliente`}
        role="combobox"
        aria-controls={`${testid}-sugestoes`}
        aria-expanded={aberta && lista.length > 0}
        aria-autocomplete="list"
        onChange={(e) => { escolhido.current = null; setNome(e.target.value) }}
        onFocus={() => setAberta(true)}
        onBlur={() => setTimeout(() => setAberta(false), 150)}
        onKeyDown={(e) => {
          if (!aberta || lista.length === 0) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setAtiva((a) => Math.min(lista.length - 1, a + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAtiva((a) => Math.max(0, a - 1)) }
          else if (e.key === 'Enter' && ativa >= 0) { e.preventDefault(); escolher(lista[ativa]) }
          else if (e.key === 'Escape') setAberta(false)
        }}
        data-testid={testid}
        className={className}
      />
      {aberta && lista.length > 0 && (
        <ul role="listbox" id={`${testid}-sugestoes`} className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[264px] overflow-y-auto rounded-menuzia border border-border bg-white shadow-lg" data-testid={`${testid}-sugestoes`}>
          {lista.map((s, i) => (
            <li key={s.telefone} role="option" aria-selected={i === ativa}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => escolher(s)}
                className={['flex min-h-[52px] w-full items-center justify-between gap-3 px-3 py-2 text-left', i === ativa ? 'bg-primary/10' : 'hover:bg-page'].join(' ')}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-text-main">{s.nome}</span>
                  <span className="block text-[12px] text-text-subtle">{mascararTelefone(s.telefone.replace(/^55/, ''))}</span>
                </span>
                <span className="flex-shrink-0 text-[11px] text-text-subtle">
                  última compra {new Date(s.ultimaCompraEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
