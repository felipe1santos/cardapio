'use client'

import { useCallback, useEffect, useState } from 'react'
import { AUTH_FONTE, authButton, authLink } from './auth-shell'
import { CamposAssinatura } from './campos-assinatura'
import { BENEFICIOS, PLANOS, type Plano } from '@/lib/assinatura/planos'

/**
 * "Adquirir acesso" no login (pedido do dono, 02/11/2026): ao clicar, um realce amarelo acende atrás do link e
 * abre um modal no centro da tela. Passo 1: chave no topo alterna Básico/Completo e mostra o cartão do plano,
 * no desenho da seção de preços do site (www.menuzia.com.br) com as cores do login. Passo 2: dados do lojista.
 * O envio vai para a fatura do Asaas (docs/ASSINATURA-ASAAS.md).
 *
 * `passoInicial`/`planoInicial`/`erro` vêm da URL quando o servidor devolve um erro: o modal reabre onde estava.
 */
export function ModalAdquirir({ passoInicial = 0, planoInicial = 'completo', erro = null }: { passoInicial?: 0 | 1 | 2; planoInicial?: Plano; erro?: string | null }) {
  const [passo, setPasso] = useState<0 | 1 | 2>(passoInicial)
  const [plano, setPlano] = useState<Plano>(planoInicial)
  const [realce, setRealce] = useState(false)

  const fechar = useCallback(() => setPasso(0), [])

  useEffect(() => {
    if (passo === 0) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar() }
    document.addEventListener('keydown', esc)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = overflow }
  }, [passo, fechar])

  function abrir() {
    setRealce(true)
    window.setTimeout(() => { setPasso(1); setRealce(false) }, 180)
  }

  const b = BENEFICIOS[plano]
  const completo = plano === 'completo'

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        data-testid="login-adquirir-acesso"
        className={`${authLink} relative inline-block rounded-[4px] px-[6px] py-[2px] transition-colors duration-150 ${realce ? 'bg-[#FFD21F] text-[#0E1D3F]' : 'bg-transparent'}`}
      >
        Adquirir acesso
      </button>

      {passo > 0 && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(1,30,91,0.55)] p-[16px]" style={{ fontFamily: AUTH_FONTE }} onClick={(e) => { if (e.target === e.currentTarget) fechar() }}>
          <div role="dialog" aria-modal="true" aria-labelledby="adquirir-titulo" className="relative max-h-[calc(100dvh-32px)] w-full max-w-[460px] overflow-y-auto rounded-[8px] bg-white p-[24px] shadow-[0_24px_64px_rgba(15,23,42,0.25)] sm:p-[28px]" data-testid="adquirir-modal">
            <button type="button" onClick={fechar} aria-label="Fechar" className="absolute right-[12px] top-[12px] flex h-[36px] w-[36px] items-center justify-center rounded-full text-[#6B7280] hover:bg-[#F3F4F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165AD]">
              <svg viewBox="0 0 24 24" className="h-[20px] w-[20px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>

            <p className="text-center text-[24px] font-extrabold leading-none tracking-[-0.03em] text-[#0165AD]">menuzia</p>
            <h2 id="adquirir-titulo" className="mt-[14px] text-center text-[20px] font-bold uppercase leading-[26px] tracking-[0.01em] text-[#1F2937]">
              {passo === 1 ? 'Escolha o plano' : 'Seus dados'}
            </h2>

            {passo === 1 && (
              <>
                {/* Chave Básico | Completo */}
                <div role="tablist" aria-label="Plano" className="mx-auto mt-[18px] flex w-fit rounded-full bg-[#E6F1FA] p-[4px]">
                  {(Object.keys(PLANOS) as Plano[]).map((p) => {
                    const ativo = plano === p
                    return (
                      <button
                        key={p}
                        type="button"
                        role="tab"
                        aria-selected={ativo}
                        onClick={() => setPlano(p)}
                        data-testid={`adquirir-chave-${p}`}
                        className={`h-[36px] rounded-full px-[18px] text-[14px] font-bold transition-colors ${ativo ? 'bg-[#0165AD] text-white shadow-[0_2px_4px_rgba(1,101,173,0.25)]' : 'text-[#0165AD] hover:bg-white'}`}
                      >
                        {p === 'basico' ? 'Básico' : 'Completo'}
                      </button>
                    )
                  })}
                </div>

                {/* Cartão do plano, no desenho do site: valor grande, descrição, lista com check, condição, botão cheio. */}
                <article className={`relative mt-[18px] rounded-[8px] border p-[20px] ${completo ? 'border-[#0165AD] bg-[#0165AD] text-white' : 'border-[#C4C9D0] bg-white text-[#1F2937]'}`} data-testid={`adquirir-cartao-${plano}`}>
                  {completo && <p className="mb-[10px] w-fit rounded-[3px] bg-[#FFD21F] px-[10px] py-[3px] text-[12px] font-extrabold text-[#0E1D3F]">Mais completo</p>}
                  <h3 className="text-[18px] font-bold leading-[24px]">{PLANOS[plano].nome}</h3>
                  <p className="mt-[6px] flex items-start leading-none">
                    <span className={`mr-[4px] mt-[8px] text-[16px] font-bold ${completo ? 'text-[#FFD21F]' : 'text-[#0165AD]'}`}>R$</span>
                    <span className="text-[52px] font-extrabold tracking-[-0.03em]">{PLANOS[plano].valor}</span>
                    <span className={`ml-[4px] self-end pb-[8px] text-[14px] font-bold ${completo ? 'text-[#DCE5F7]' : 'text-[#6B7280]'}`}>/mês</span>
                  </p>
                  {completo ? (
                    <p className="mt-[10px] text-[14px] leading-[20px] text-[#DCE5F7]">
                      <span className="mb-[6px] block w-fit rounded-[3px] bg-[#FFD21F] px-[9px] py-[1px] font-extrabold text-[#0E1D3F]">Tudo do Básico</span>
                      + automação no WhatsApp e gestão financeira.
                    </p>
                  ) : (
                    <p className="mt-[10px] text-[14px] leading-[20px] text-[#4B5563]">{b.descricao}</p>
                  )}
                  {completo && <p className="mt-[14px] text-[14px] font-bold">Tudo o que está no plano Básico, mais:</p>}
                  <ul className="mt-[10px] space-y-[6px]">
                    {b.itens.map((item) => (
                      <li key={item} className="flex items-start gap-[8px] text-[14px] leading-[20px]">
                        <svg viewBox="0 0 24 24" className={`mt-[2px] h-[16px] w-[16px] flex-none ${completo ? 'text-[#FFD21F]' : 'text-[#0165AD]'}`} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L19 7" /></svg>
                        {item}
                      </li>
                    ))}
                  </ul>
                  <p className={`mt-[14px] text-[13px] font-semibold ${completo ? 'text-[#DCE5F7]' : 'text-[#6B7280]'}`}>{b.condicao}</p>
                  <button
                    type="button"
                    onClick={() => setPasso(2)}
                    data-testid="adquirir-escolher"
                    className={completo ? `${authButton} mt-[16px] bg-[#FFD21F] text-[#0E1D3F] shadow-none hover:bg-[#FFC800]` : `${authButton} mt-[16px]`}
                  >
                    {completo ? 'Quero o Completo' : 'Quero o Básico'}
                  </button>
                </article>
              </>
            )}

            {passo === 2 && (
              <>
                <p className="mt-[8px] text-center text-[14px] leading-[20px] text-[#6B7280]">
                  Plano <strong className="text-[#1F2937]">{PLANOS[plano].nome}</strong> · R$ {PLANOS[plano].valor}/mês ·{' '}
                  <button type="button" onClick={() => setPasso(1)} className={authLink}>trocar</button>
                </p>
                <div className="mt-[20px]">
                  <CamposAssinatura plano={plano} origem="login" erro={erro} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
