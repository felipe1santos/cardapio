'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from 'lucide-react'
import { FIN_BTN, FIN_COR } from '@/components/graficos/kit-meta'

/**
 * "Guia de 1 página para os funcionários" (seção #funcionarios do guia). O botão Imprimir monta uma cópia da
 * folha num portal no <body> (o painel tem overflow hidden e cortaria a impressão) e, enquanto a classe
 * `guia-imprimindo` estiver no <body>, a impressão mostra SÓ essa folha. Mesmo padrão do Fluxo de Caixa e do QR.
 */
const TOPICOS: { titulo: string; itens: string[] }[] = [
  { titulo: '1. Abrir o caixa', itens: [
    'Conte o dinheiro da gaveta (o troco).',
    'Financeiro › Caixa › Abrir caixa. Digite o valor contado.',
  ] },
  { titulo: '2. Vender', itens: [
    'Venda pelo PDV, mesa ou delivery como sempre. A venda entra no caixa sozinha.',
    'Pix no balcão: confira no banco antes de liberar o cliente.',
  ] },
  { titulo: '3. Sangria (tirar dinheiro para o cofre)', itens: [
    'Financeiro › Movimentações › Sangria. Digite o valor e o motivo.',
    'Nunca tire dinheiro da gaveta sem lançar. Troco que entra: Reforço.',
  ] },
  { titulo: '4. Fechar o caixa', itens: [
    'Conte o dinheiro da gaveta e some a maquininha ANTES de olhar o sistema.',
    'Financeiro › Caixa › Fechar caixa. Digite o que contou.',
    'Acerte os motoboys antes de fechar.',
  ] },
  { titulo: '5. Quando aparece o PIN', itens: [
    'Saída de dinheiro acima do limite da loja, diferença grande no fechamento, estorno.',
    'Chame o gerente ou o dono — quem pede nunca aprova. Se ele não estiver: "Pedir pelo celular do gerente/dono".',
  ] },
  { titulo: '6. Se der diferença', itens: [
    'Conte de novo com calma.',
    'Digite o valor que contou de verdade e explique o que aconteceu.',
    'Não complete nem tire dinheiro para "fazer bater".',
  ] },
]

function Folha({ impressao = false }: { impressao?: boolean }) {
  return (
    <div className={impressao ? 'guia-folha-impressa' : ''}>
      {impressao && (
        <>
          <p style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Caixa da loja — guia rápido</p>
          <p style={{ fontSize: 11, margin: '2px 0 10px' }}>Siga sempre esta ordem. Dúvida? Chame o gerente ou o dono.</p>
        </>
      )}
      <div className={impressao ? 'guia-folha-grade' : 'grid gap-3 sm:grid-cols-2'}>
        {TOPICOS.map((t) => (
          <div key={t.titulo} className={impressao ? 'guia-folha-bloco' : 'rounded-[8px] border bg-white p-3'} style={impressao ? undefined : { borderColor: FIN_COR.borda }}>
            <p className={impressao ? '' : 'text-[14px] font-semibold'} style={impressao ? { fontWeight: 600, fontSize: 13, margin: '0 0 4px' } : { color: FIN_COR.texto }}>{t.titulo}</p>
            <ul className={impressao ? '' : 'mt-1 space-y-1 text-[13px]'} style={impressao ? { margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.45 } : { color: FIN_COR.texto2 }}>
              {t.itens.map((i) => <li key={i} className={impressao ? '' : 'flex gap-1.5'}>{impressao ? i : <><span aria-hidden="true">•</span><span className="min-w-0 flex-1">{i}</span></>}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

export function FolhaFuncionarios() {
  const [montado, setMontado] = useState(false)
  useEffect(() => { setMontado(true) }, [])

  function imprimir() {
    document.body.classList.add('guia-imprimindo')
    const limpar = () => { document.body.classList.remove('guia-imprimindo'); window.removeEventListener('afterprint', limpar) }
    window.addEventListener('afterprint', limpar)
    setTimeout(() => window.print(), 50)
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-[14px]" style={{ color: FIN_COR.texto2 }}>Imprima e cole perto do caixa. Sai numa folha A4.</p>
        <button type="button" onClick={imprimir} className={FIN_BTN.primario} data-testid="guia-imprimir">
          <Printer className="h-4 w-4" aria-hidden="true" /> Imprimir
        </button>
      </div>
      <Folha />
      {montado && createPortal(
        <div id="guia-print-root" aria-hidden="true">
          <style>{`
            #guia-print-root { display: none; }
            @media print {
              body.guia-imprimindo > *:not(#guia-print-root) { display: none !important; }
              body.guia-imprimindo #guia-print-root { display: block !important; padding: 14mm 14mm; color: #000; background: #fff; font-family: var(--font-meta), system-ui, sans-serif; }
              #guia-print-root .guia-folha-grade { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
              #guia-print-root .guia-folha-bloco { border: 1px solid #999; border-radius: 8px; padding: 8px 10px; break-inside: avoid; }
            }
          `}</style>
          <Folha impressao />
        </div>,
        document.body,
      )}
    </>
  )
}
