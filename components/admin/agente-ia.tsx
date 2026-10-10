import { ICONES } from '@/lib/icones-painel'

/**
 * Agente de IA (atendente com ChatGPT no WhatsApp) — módulo pago (0176), ainda em construção. Fica em Ajustes ›
 * Agente de IA (10/10/2026); sem o módulo, a seção mostra o "Quero liberar". Quando existir, toda chamada à OpenAI
 * passa por chamarIa() (lib/custo/ia.ts) — Regra nº 1 de custo.
 */
export function AgenteIa() {
  return (
    <div className="max-w-[560px]" data-testid="agente-ia">
      <div className="fin-card p-6 text-center">
        <div className="mx-auto mb-3 grid h-[48px] w-[48px] place-items-center rounded-full bg-[#E0F2FE] text-[#0369A1]">
          <svg viewBox="0 0 24 24" className="h-[26px] w-[26px] fill-current" aria-hidden="true">{ICONES.robo.map((d) => <path key={d} d={d} />)}</svg>
        </div>
        <h3 className="text-[17px] font-semibold text-[#1C2B33]">Agente de IA</h3>
        <p className="mt-1.5 text-[13.5px] leading-[20px] text-[#465A69]">
          O módulo está liberado na sua loja. O atendente com inteligência artificial que conversa com o cliente no WhatsApp e
          tira o pedido está em construção — avisamos assim que ele estiver pronto para ligar.
        </p>
      </div>
    </div>
  )
}
