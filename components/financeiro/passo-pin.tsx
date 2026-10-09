'use client'

import { useCallback, useEffect, useState } from 'react'
import { ModalMeuPin } from '@/components/admin/modal-meu-pin'
import { FIN_BTN, FIN_COR } from '@/components/graficos/kit-meta'

/**
 * Passo destacado no topo do Financeiro para o dono (que vale como gerente aprovador) e para o gerente que
 * ainda não têm PIN. O PIN é criado pela própria pessoa (exige a senha dela); o sistema nunca cria PIN de ninguém.
 */
export function PassoPin({ papel }: { papel: string | null }) {
  const [temPin, setTemPin] = useState<boolean | null>(null)
  const [aberto, setAberto] = useState(false)
  const ler = useCallback(() => {
    void fetch('/api/sessao/estado', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => setTemPin(j ? !!j.temPin : null)).catch(() => setTemPin(null))
  }, [])
  useEffect(() => { ler() }, [ler])
  if (temPin !== false || !papel || !['dono', 'gerente'].includes(papel)) return null
  return (
    <div className="fin-card flex flex-col gap-3 border-l-[3px] p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderLeftColor: '#1877F2' }} data-testid="fin-passo-pin">
      <div>
        <p className="text-[15px] font-semibold" style={{ color: FIN_COR.texto }}>Crie seu PIN de aprovação (4 a 6 números)</p>
        <p className="mt-1 text-[13px]" style={{ color: FIN_COR.texto2 }}>Ele é usado para aprovar sangrias, estornos e diferenças de caixa feitas pelos funcionários.{papel === 'dono' ? ' Como dono da conta, você vale como gerente.' : ''}</p>
      </div>
      <button type="button" className={`${FIN_BTN.primario} w-full flex-shrink-0 sm:w-auto`} onClick={() => setAberto(true)} data-testid="fin-criar-pin">Criar meu PIN</button>
      {aberto && <ModalMeuPin temPin={false} onFechar={() => { setAberto(false); ler(); window.dispatchEvent(new Event('menuzia:sessao-mudou')) }} />}
    </div>
  )
}
