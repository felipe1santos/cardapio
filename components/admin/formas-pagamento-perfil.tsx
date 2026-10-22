'use client'

import { useState } from 'react'
import { BANDEIRAS_VALE, OPCOES_PAGAMENTO, ROTULO_OPCAO, somenteOnline, type ConfigFormas, type Conectados, type OpcaoPagamento } from '@/lib/formas-pagamento'

/**
 * Perfil › "Formas de pagamento aceitas" (0217): uma linha por forma, uma coluna por canal (Entrega / Retirada / Mesa).
 * Entrega e retirada vão em restaurantes.formas_pagamento; a Mesa é a mesma lista de Ajustes › Mesas
 * (formas_pagamento_mesa) — editar aqui ou lá dá no mesmo. Salva junto com o resto do Perfil.
 */
// Formas que existem na mesa (lib/conta.ts › FORMAS_PAGAMENTO_OFERECIDAS); online não existe no salão.
const NA_MESA: Partial<Record<OpcaoPagamento, string>> = { pix: 'pix', credito: 'credito', debito: 'debito', dinheiro: 'dinheiro', vale: 'vale' }
const DICA: Partial<Record<OpcaoPagamento, string>> = {
  pix_online: 'QR Code na hora do pedido (Mercado Pago)',
  pix: 'O cliente paga pela chave do Perfil',
  cartao_online: 'Pago no cardápio (Mercado Pago)',
  dinheiro: 'O cliente informa o troco',
}

export function FormasPagamentoPerfil({ valor, onChange, mesa, onMesa, conectados, temChavePix }: {
  valor: ConfigFormas
  onChange: (v: ConfigFormas) => void
  /** null = módulo de mesas desligado (sem coluna Mesa). */
  mesa: string[] | null
  onMesa: (v: string[]) => void
  conectados: Conectados
  temChavePix: boolean
}) {
  const [outra, setOutra] = useState('')
  const marcar = (canal: 'entrega' | 'retirada', o: OpcaoPagamento, v: boolean) =>
    onChange({ ...valor, [canal]: OPCOES_PAGAMENTO.filter((x) => (x === o ? v : valor[canal].includes(x))) })
  const marcarMesa = (f: string, v: boolean) => mesa && onMesa(v ? [...mesa, f] : mesa.filter((x) => x !== f))
  const bandeira = (b: string, v: boolean) => onChange({ ...valor, vale_bandeiras: v ? [...valor.vale_bandeiras, b] : valor.vale_bandeiras.filter((x) => x !== b) })
  const usaVale = valor.entrega.includes('vale') || valor.retirada.includes('vale') || !!mesa?.includes('vale')
  const extras = valor.vale_bandeiras.filter((b) => !(BANDEIRAS_VALE as readonly string[]).includes(b))
  const temOnline = conectados.pixOnline || conectados.cartaoOnline
  const caixa = 'h-[18px] w-[18px] cursor-pointer accent-[#0688D4] disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="space-y-4" data-testid="formas-pagamento">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11.5px] font-semibold uppercase tracking-wide text-text-subtle">
              <th className="py-2 pr-2">Forma</th>
              <th className="w-[76px] py-2 text-center">Entrega</th>
              <th className="w-[76px] py-2 text-center">Retirada</th>
              {mesa && <th className="w-[76px] py-2 text-center">Mesa</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {OPCOES_PAGAMENTO.map((o) => {
              const semConta = (o === 'pix_online' && !conectados.pixOnline) || (o === 'cartao_online' && !conectados.cartaoOnline)
              const dica = semConta ? 'Conecte o Mercado Pago em Integrações para usar' : o === 'pix' && !temChavePix ? 'Cadastre a chave Pix em Dados da loja' : DICA[o]
              const rotulo = o === 'credito' || o === 'debito' ? ROTULO_OPCAO[o].replace(' na entrega', '') + ' (maquininha)' : ROTULO_OPCAO[o]
              return (
                <tr key={o} data-testid={`forma-${o}`}>
                  <td className="py-2.5 pr-2">
                    <div className="font-medium text-text-main">{rotulo}</div>
                    {dica && <div className={`text-[12px] ${semConta ? 'mt-1 inline-block rounded-[3px] bg-[#FFEDD5] px-2 py-[3px] font-medium text-[#9A3412]' : 'text-text-subtle'}`} data-testid={semConta ? `forma-${o}-aviso` : undefined}>{dica}</div>}
                  </td>
                  {(['entrega', 'retirada'] as const).map((canal) => (
                    <td key={canal} className="py-2.5 text-center">
                      <input type="checkbox" className={caixa} aria-label={`${rotulo} na ${canal}`} disabled={semConta && !valor[canal].includes(o)}
                        checked={valor[canal].includes(o)} onChange={(e) => marcar(canal, o, e.target.checked)} data-testid={`forma-${o}-${canal}`} />
                    </td>
                  ))}
                  {mesa && (
                    <td className="py-2.5 text-center">
                      {NA_MESA[o] ? <input type="checkbox" className={caixa} aria-label={`${rotulo} na mesa`} checked={mesa.includes(NA_MESA[o]!)} onChange={(e) => marcarMesa(NA_MESA[o]!, e.target.checked)} data-testid={`forma-${o}-mesa`} /> : <span className="text-text-subtle">—</span>}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {usaVale && (
        <div className="rounded-[4px] border border-border bg-[#F9FAFB] p-3" data-testid="vale-bandeiras-perfil">
          <p className="mb-2 text-[12.5px] font-semibold text-text-main">Bandeiras de vale aceitas</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {[...BANDEIRAS_VALE, ...extras].map((b) => (
              <label key={b} className="inline-flex cursor-pointer items-center gap-1.5 text-[13px]">
                <input type="checkbox" className={caixa} checked={valor.vale_bandeiras.includes(b)} onChange={(e) => bandeira(b, e.target.checked)} /> {b}
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input value={outra} onChange={(e) => setOutra(e.target.value)} placeholder="Outra bandeira" maxLength={40}
              className="h-[32px] min-w-0 flex-1 rounded-[3px] border border-border px-2 text-[13px] outline-none focus:border-primary" />
            <button type="button" disabled={!outra.trim() || valor.vale_bandeiras.includes(outra.trim())} onClick={() => { bandeira(outra.trim(), true); setOutra('') }}
              className="h-[32px] rounded-[3px] border border-border bg-white px-3 text-[11px] font-semibold uppercase tracking-wide text-text-main hover:border-primary hover:text-primary disabled:opacity-50">Adicionar</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!temOnline} onClick={() => onChange(somenteOnline(valor, conectados))} data-testid="somente-online"
          className="h-[32px] rounded-[3px] border border-border bg-white px-3 text-[11px] font-semibold uppercase tracking-wide text-text-main hover:border-primary hover:text-primary disabled:opacity-50">
          Somente pagamento online
        </button>
        <span className={`text-[12px] ${temOnline ? 'text-text-subtle' : 'rounded-[3px] bg-[#FFEDD5] px-2 py-[3px] font-medium text-[#9A3412]'}`}>{temOnline ? 'Entrega e retirada só com Pix/cartão online. A mesa não muda.' : 'Conecte o Mercado Pago em Integrações para aceitar só online.'}</span>
      </div>
    </div>
  )
}
