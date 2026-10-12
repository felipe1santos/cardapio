'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Lock } from 'lucide-react'

/**
 * Tela "Pague com cartão" (cartão online, Mercado Pago — 12/10/2026). O formulário é o Card Payment Brick do próprio MP:
 * o número do cartão nunca passa pelo nosso servidor (o Brick troca por um token). Recusado: mensagem clara, o cliente
 * tenta outro cartão ou troca a forma de pagamento. Em análise: poucas consultas, espaçadas. A confirmação vem SEMPRE do
 * servidor, que confere o pagamento na API do MP.
 */
export interface CartaoAguardando { id: string; numero: number; valor: number; publicKey: string; parcelasMax: number; expiraEm: string }

type Fase = 'formulario' | 'em_analise' | 'aprovado' | 'expirado'
type Resposta = { resultado: 'aprovado' | 'recusado' | 'em_analise' | 'expirado' | 'ja_pago'; mensagem: string | null }

interface BrickController { unmount: () => void }
interface MercadoPagoSdk { bricks: () => { create: (tipo: string, container: string, opcoes: unknown) => Promise<BrickController> } }
declare global { interface Window { MercadoPago?: new (chave: string, op: { locale: string }) => MercadoPagoSdk } }

const SDK = 'https://sdk.mercadopago.com/js/v2'
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const horaBrasilia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
// Em análise: consulta em 5, 10, 20, 40, 60 e 90 s — e para. Nada de consulta a cada segundo.
const ESPERAS_ANALISE = [5_000, 5_000, 10_000, 20_000, 20_000, 30_000]

let sdkPromessa: Promise<void> | null = null
function carregarSdk(): Promise<void> {
  if (window.MercadoPago) return Promise.resolve()
  sdkPromessa ??= new Promise<void>((ok, falha) => {
    const s = document.createElement('script')
    s.src = SDK
    s.async = true
    s.onload = () => ok()
    s.onerror = () => { sdkPromessa = null; falha(new Error('sdk')) }
    document.head.appendChild(s)
  })
  return sdkPromessa
}

export function TelaCartaoOnline({ slug, cartao, onPago, onTrocar, onRefazer }: {
  slug: string; cartao: CartaoAguardando; onPago: () => void; onTrocar: () => void; onRefazer: () => void
}) {
  const [fase, setFase] = useState<Fase>('formulario')
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [trocando, setTrocando] = useState(false)
  const avisou = useRef(false)
  const expira = new Date(cartao.expiraEm).getTime()

  const tratar = (r: Resposta) => {
    if (r.resultado === 'aprovado' || r.resultado === 'ja_pago') { setFase('aprovado'); return }
    if (r.resultado === 'expirado') { setFase('expirado'); setErro(r.mensagem); return }
    if (r.resultado === 'em_analise') { setFase('em_analise'); setErro(r.mensagem); return }
    setFase('formulario'); setErro(r.mensagem ?? 'Pagamento recusado. Tente outro cartão ou outra forma de pagamento.')
  }
  const tratarRef = useRef(tratar)
  tratarRef.current = tratar

  // Brick do MP: monta uma vez por pedido e desmonta ao sair (controller.unmount).
  useEffect(() => {
    let vivo = true
    let controle: BrickController | null = null
    carregarSdk()
      .then(async () => {
        if (!vivo || !window.MercadoPago) return
        const mp = new window.MercadoPago(cartao.publicKey, { locale: 'pt-BR' })
        controle = await mp.bricks().create('cardPayment', 'cartao-online-brick', {
          initialization: { amount: cartao.valor },
          customization: { paymentMethods: { minInstallments: 1, maxInstallments: cartao.parcelasMax } },
          callbacks: {
            onReady: () => { if (vivo) setCarregando(false) },
            onError: () => { if (vivo) setCarregando(false) },
            onSubmit: async (dados: Record<string, unknown>) => {
              setErro(null)
              try {
                const r = await fetch(`/api/loja/${slug}/pedido/${cartao.id}/cartao`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ acao: 'pagar', token: dados.token, payment_method_id: dados.payment_method_id, issuer_id: dados.issuer_id, installments: dados.installments, payer: dados.payer }),
                })
                const j = (await r.json().catch(() => null)) as Resposta | null
                if (vivo) tratarRef.current(j ?? { resultado: 'recusado', mensagem: 'Não foi possível concluir. Tente de novo.' })
              } catch {
                if (vivo) tratarRef.current({ resultado: 'recusado', mensagem: 'Sem conexão. Confira a internet e tente de novo.' })
              }
            },
          },
        })
        if (!vivo) controle.unmount()
      })
      .catch(() => { if (vivo) { setCarregando(false); setErro('Não foi possível abrir o pagamento com cartão. Troque a forma de pagamento.') } })
    return () => { vivo = false; controle?.unmount() }
  }, [slug, cartao.id, cartao.publicKey, cartao.valor, cartao.parcelasMax])

  // Em análise pelo banco: poucas consultas espaçadas; depois disso o pedido segue sozinho quando o MP avisar.
  useEffect(() => {
    if (fase !== 'em_analise') return
    let vivo = true
    let i = 0
    let t: ReturnType<typeof setTimeout>
    const passo = () => {
      if (i >= ESPERAS_ANALISE.length) return
      t = setTimeout(async () => {
        i++
        try {
          const r = await fetch(`/api/loja/${slug}/pedido/${cartao.id}/cartao`, { cache: 'no-store' })
          const j = (await r.json()) as Resposta
          if (!vivo) return
          if (j.resultado === 'em_analise') passo()
          else tratarRef.current(j)
        } catch { if (vivo) passo() }
      }, ESPERAS_ANALISE[i])
    }
    passo()
    return () => { vivo = false; clearTimeout(t) }
  }, [fase, slug, cartao.id])

  useEffect(() => {
    if (fase === 'aprovado' && !avisou.current) { avisou.current = true; const t = setTimeout(onPago, 1200); return () => clearTimeout(t) }
  }, [fase, onPago])

  const trocar = async () => {
    setTrocando(true)
    try {
      const r = await fetch(`/api/loja/${slug}/pedido/${cartao.id}/cartao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'desistir' }) })
      const j = (await r.json().catch(() => null)) as { resultado?: string } | null
      if (j?.resultado === 'pago') { setFase('aprovado'); return }
      onTrocar()
    } catch {
      setErro('Sem conexão. Tente de novo.')
    } finally {
      setTrocando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[96] flex flex-col bg-[var(--v-fundo,#F8FAFC)] font-vitrine" role="dialog" aria-modal="true" aria-label="Pagamento com cartão" data-testid="tela-cartao-online">
      <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-white px-[16px] py-[12px]">
        <p className="text-[16px] font-semibold text-[#1F1F1F]">Pague com cartão</p>
        <span className="flex items-center gap-[4px] text-[12px] text-[#5C5C5C]"><Lock className="h-[14px] w-[14px]" /> Mercado Pago</span>
      </div>
      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col overflow-y-auto px-[16px] py-[16px]">
        {fase === 'formulario' && (
          <>
            <div className="text-center">
              <p className="text-[14px] text-[#5C5C5C]">Pedido #{cartao.numero}</p>
              <p className="mt-[2px] text-[28px] font-semibold text-[#1F1F1F]" data-testid="cartao-valor">{brl(cartao.valor)}</p>
              <p className="mt-[4px] text-[13px] text-[#5C5C5C]">
                Crédito ou débito{cartao.parcelasMax > 1 ? ` · até ${cartao.parcelasMax}x` : ' · à vista'} · pague até {horaBrasilia.format(expira)}
              </p>
            </div>
            {erro && (
              <p role="alert" className="mt-[12px] rounded-[8px] border border-[#FCA5A5] bg-[#FEE2E2] px-[12px] py-[10px] text-[13px] font-medium leading-[18px] text-[#991B1B]" data-testid="cartao-recusado">{erro}</p>
            )}
            {carregando && <p className="mt-[24px] flex items-center justify-center gap-[8px] text-[13px] text-[#5C5C5C]"><Loader2 className="h-[16px] w-[16px] animate-spin" /> Abrindo o pagamento seguro…</p>}
            <div id="cartao-online-brick" className="mt-[12px]" />
            <p className="mt-[8px] text-center text-[12px] leading-[16px] text-[#5C5C5C]">Os dados do cartão vão direto para o Mercado Pago. O pedido só vai para a cozinha depois do pagamento.</p>
            <button type="button" onClick={() => void trocar()} disabled={trocando}
              className="mt-[16px] h-[48px] w-full rounded-[8px] border border-[#D1D5DB] bg-white text-[15px] font-semibold text-[#1446AB] disabled:opacity-60" data-testid="cartao-trocar">
              {trocando ? 'Voltando…' : 'Trocar forma de pagamento'}
            </button>
          </>
        )}
        {fase === 'em_analise' && (
          <div className="mt-[40px] flex flex-col items-center text-center" data-testid="cartao-analise">
            <Loader2 className="h-[40px] w-[40px] animate-spin text-[#1446AB]" />
            <p className="mt-[16px] text-[18px] font-semibold text-[#1F1F1F]">Pagamento em análise</p>
            <p className="mt-[6px] text-[14px] text-[#5C5C5C]">{erro ?? 'O banco está analisando. Assim que aprovar, o pedido vai para a loja.'}</p>
            <p className="mt-[6px] text-[13px] text-[#5C5C5C]">Pode fechar esta tela: acompanhe na aba Pedidos.</p>
          </div>
        )}
        {fase === 'aprovado' && (
          <div className="mt-[40px] flex flex-col items-center text-center" data-testid="cartao-aprovado">
            <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-[#16884D] text-white"><Check className="h-[40px] w-[40px]" /></span>
            <p className="mt-[16px] text-[20px] font-semibold text-[#1F1F1F]">Pagamento aprovado!</p>
            <p className="mt-[4px] text-[14px] text-[#5C5C5C]">Pedido #{cartao.numero} enviado para a loja.</p>
          </div>
        )}
        {fase === 'expirado' && (
          <div className="mt-[40px] flex flex-col items-center text-center" data-testid="cartao-expirado">
            <p className="text-[20px] font-semibold text-[#1F1F1F]">O tempo para pagar acabou</p>
            <p className="mt-[6px] text-[14px] text-[#5C5C5C]">{erro ?? `O pedido #${cartao.numero} foi cancelado e nada foi cobrado.`}</p>
            <button type="button" onClick={onRefazer} className="mt-[20px] h-[52px] w-full rounded-[8px] bg-[#1446AB] px-[20px] text-[16px] font-semibold text-white" data-testid="cartao-refazer">Fazer o pedido de novo</button>
          </div>
        )}
      </div>
    </div>
  )
}
