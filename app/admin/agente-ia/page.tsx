import { ICONES } from '@/lib/icones-painel'

/**
 * Agente de IA (atendente com ChatGPT no WhatsApp) — módulo pago (0176), ainda em construção. Só chega aqui a loja
 * com o módulo liberado (o middleware manda as outras para o cadeado). Quando existir, toda chamada à OpenAI passa
 * por chamarIa() (lib/custo/ia.ts) — Regra nº 1 de custo.
 */
export default function AgenteIaPage() {
  return (
    <div className="mx-auto max-w-[560px] p-6" data-testid="agente-ia">
      <div className="rounded-[3px] border border-border bg-white p-6 text-center">
        <div className="mx-auto mb-3 grid h-[48px] w-[48px] place-items-center rounded-full bg-[#E0F2FE] text-[#0369A1]">
          <svg viewBox="0 0 24 24" className="h-[26px] w-[26px] fill-current" aria-hidden="true">{ICONES.robo.map((d) => <path key={d} d={d} />)}</svg>
        </div>
        <h1 className="text-[17px] font-semibold text-text-main">Agente de IA</h1>
        <p className="mt-1.5 text-[13.5px] leading-[20px] text-text-subtle">
          O módulo está liberado na sua loja. O atendente com inteligência artificial que conversa com o cliente no WhatsApp e
          tira o pedido está em construção — avisamos assim que ele estiver pronto para ligar.
        </p>
      </div>
    </div>
  )
}
