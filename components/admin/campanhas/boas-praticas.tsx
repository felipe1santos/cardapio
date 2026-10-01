'use client'

import { useEffect } from 'react'
import { BellOff, Clock, Gauge, Lightbulb, MessageCircleHeart, ShieldCheck, Target, X } from 'lucide-react'

/** Painel "Boas práticas" das campanhas: como mandar sem ser bloqueado e vendendo mais. */
const DICAS = [
  { icone: Target, titulo: 'Escolha bem o público', texto: 'Mande para quem tem motivo para receber: quem não pede há um tempo, quem pede toda semana, quem gosta de um dia específico.' },
  { icone: Clock, titulo: 'Horário certo', texto: 'Uma a duas horas antes do pico (ex.: 17h30 para o jantar). Evite madrugada e muito cedo.' },
  { icone: Gauge, titulo: 'Sem exagero', texto: 'Uma ou duas campanhas por semana no máximo. Muitas mensagens viram denúncia e o WhatsApp pode bloquear o número.' },
  { icone: MessageCircleHeart, titulo: 'Pessoal e curta', texto: 'Use {nome}, vá direto à oferta, uma imagem bonita do prato e o link do cardápio. Texto longo ninguém lê.' },
  { icone: BellOff, titulo: 'Deixe sair', texto: 'Mantenha o "responda SAIR para não receber". Quem pede para sair não recebe mais — e isso protege o seu número.' },
  { icone: ShieldCheck, titulo: 'Só clientes da loja', texto: 'Mande só para quem já comprou ou falou com a loja. Lista comprada é o caminho mais rápido para o bloqueio.' },
]

export function BoasPraticas({ onFechar }: { onFechar: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])
  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-end bg-black/40" onMouseDown={onFechar}>
      <aside role="dialog" aria-modal="true" aria-label="Boas práticas" className="flex h-full w-full max-w-[440px] flex-col bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()} data-testid="boas-praticas">
        <div className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-[#e5e7eb] px-5">
          <span className="flex items-center gap-2 text-[15px] font-bold text-[#1f2937]"><Lightbulb className="h-5 w-5 text-[#f59e0b]" /> Boas práticas</span>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="text-[#6b7280] hover:text-[#1f2937]"><X className="h-5 w-5" /></button>
        </div>
        <ul className="flex-1 space-y-3 overflow-y-auto p-5">
          {DICAS.map((d) => (
            <li key={d.titulo} className="flex gap-3 rounded-[6px] border border-[#e5e7eb] p-3.5">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[8px] bg-[#E0F2FE] text-[#0688d4]"><d.icone className="h-[18px] w-[18px]" /></span>
              <div>
                <h4 className="text-[13.5px] font-bold text-[#1f2937]">{d.titulo}</h4>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-[#5b6472]">{d.texto}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
