'use client'

import { useMemo, useState } from 'react'
import { ICONES } from '@/lib/icones-painel'

/**
 * Tabela analítica do Dashboard — o formato das tabelas da referência: faixa
 * cinza no cabeçalho, coluna clicável para ordenar com a seta ao lado do nome,
 * primeira coluna com uma pílula de destaque e uma busca opcional no canto.
 *
 * Ordena no cliente porque a tabela já tem todos os dados na mão: são dezenas
 * de linhas, não milhares, e ir ao servidor a cada clique piscaria a tela sem
 * ganho nenhum.
 */
export interface ColunaTabela<T> {
  id: string
  titulo: string
  /** Valor usado na ordenação — número ordena por grandeza, texto por alfabeto. */
  valor: (linha: T) => string | number
  /** O que aparece na célula; sem isto, mostra o próprio valor. */
  render?: (linha: T) => React.ReactNode
  alinhar?: 'esquerda' | 'direita'
  /** Primeira coluna: ganha a pílula e nunca é truncada. */
  destaque?: boolean
}

export function TabelaAnalitica<T extends { id: string }>({
  titulo,
  colunas,
  linhas,
  ordemInicial,
  busca,
  vazio = 'Nada encontrado',
}: {
  titulo: string
  colunas: ColunaTabela<T>[]
  linhas: T[]
  /** Coluna pela qual a tabela já chega ordenada (decrescente). */
  ordemInicial?: string
  /** Liga o campo de busca e diz em que texto procurar. */
  busca?: { placeholder: string; texto: (linha: T) => string }
  vazio?: string
}) {
  const [ordem, setOrdem] = useState<{ id: string; desc: boolean }>({ id: ordemInicial ?? colunas[0].id, desc: true })
  const [termo, setTermo] = useState('')

  const visiveis = useMemo(() => {
    const coluna = colunas.find((c) => c.id === ordem.id) ?? colunas[0]
    const filtradas = busca && termo.trim()
      ? linhas.filter((l) => busca.texto(l).toLowerCase().includes(termo.trim().toLowerCase()))
      : linhas
    return [...filtradas].sort((a, b) => {
      const va = coluna.valor(a)
      const vb = coluna.valor(b)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')
      return ordem.desc ? -cmp : cmp
    })
  }, [linhas, colunas, ordem, busca, termo])

  return (
    <section className="flex-shrink-0 overflow-hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">{titulo}</h3>
        {busca && (
          <label className="flex h-[36px] min-w-[220px] items-center gap-2 rounded-[4.8px] border-[0.8px] border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] px-2.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 fill-[var(--adm-texto-suave)]" aria-hidden="true">
              {ICONES.busca.map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
            <input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder={busca.placeholder}
              aria-label={busca.placeholder}
              className="w-full !min-h-0 !border-0 !bg-transparent p-0 text-[12.8px] focus:!shadow-none"
            />
          </label>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {colunas.map((c) => {
                const ativa = ordem.id === c.id
                return (
                  <th
                    key={c.id}
                    scope="col"
                    className={c.alinhar === 'direita' ? 'text-right' : 'text-left'}
                  >
                    <button
                      type="button"
                      onClick={() => setOrdem((o) => ({ id: c.id, desc: o.id === c.id ? !o.desc : true }))}
                      aria-label={`Ordenar por ${c.titulo}`}
                      className={[
                        'inline-flex items-center gap-1 text-[12.8px] font-bold text-[var(--adm-texto-forte)]',
                        c.alinhar === 'direita' ? 'flex-row-reverse' : '',
                      ].join(' ')}
                    >
                      {c.titulo}
                      {ativa && (
                        <svg
                          viewBox="0 0 24 24"
                          className={['h-3.5 w-3.5 fill-current transition-transform', ordem.desc ? '' : 'rotate-180'].join(' ')}
                          aria-hidden="true"
                        >
                          {ICONES.ordenar.map((d) => (
                            <path key={d} d={d} />
                          ))}
                        </svg>
                      )}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={colunas.length} className="px-4 py-10 text-center text-[13px] text-[var(--adm-texto-suave)]">
                  {vazio}
                </td>
              </tr>
            )}
            {visiveis.map((linha) => (
              <tr key={linha.id} className="border-b border-[rgba(0,0,0,0.08)] last:border-none hover:bg-[var(--adm-superficie-2)]">
                {colunas.map((c) => (
                  <td
                    key={c.id}
                    className={[
                      'px-4 py-3 align-middle',
                      c.alinhar === 'direita' ? 'text-right tabular-nums' : 'text-left',
                    ].join(' ')}
                  >
                    {c.destaque ? (
                      <span className="inline-flex max-w-full items-center truncate rounded-[4px] bg-[#f1f2f4] px-2 py-1 text-[12.8px] font-semibold text-[var(--adm-texto-forte)]">
                        {c.render ? c.render(linha) : c.valor(linha)}
                      </span>
                    ) : c.render ? (
                      c.render(linha)
                    ) : (
                      c.valor(linha)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
