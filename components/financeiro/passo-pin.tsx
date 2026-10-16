'use client'

import { useCallback, useEffect, useState } from 'react'
import { ModalMeuPin } from '@/components/admin/modal-meu-pin'
import { AvisoTopo, BOTAO_AVISO_TOPO } from '@/components/ui/topo-compacto'

/**
 * Aviso do PIN na barra do topo do Financeiro (16/10/2026: era um cartão grande no começo de cada seção), para o dono
 * (que vale como gerente aprovador) e o gerente que ainda não têm PIN. O PIN é criado pela própria pessoa (exige a
 * senha dela); o sistema nunca cria PIN de ninguém.
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
    <>
      <AvisoTopo testid="fin-passo-pin" texto="Crie seu PIN de aprovação"
        info={{
          titulo: 'PIN de aprovação',
          conteudo: <>O PIN tem de 4 a 6 números. Ele é usado para aprovar sangrias, estornos e diferenças de caixa feitas pelos funcionários.{papel === 'dono' ? ' Como dono da conta, você vale como gerente.' : ''} Só você cria o seu PIN, com a sua senha.</>,
        }}
        acao={<button type="button" className={BOTAO_AVISO_TOPO} onClick={() => setAberto(true)} data-testid="fin-criar-pin">Criar PIN</button>} />
      {aberto && <ModalMeuPin temPin={false} onFechar={() => { setAberto(false); ler(); window.dispatchEvent(new Event('menuzia:sessao-mudou')) }} />}
    </>
  )
}
