'use client'

/**
 * Ajustes › Robô de atendimento — tela ÚNICA dos dois robôs (10/10/2026, ordem do dono).
 *
 *  - Robô simples (v1): liga/desliga de sempre (robo_ativo). Ligado hoje em Estância, Ponto 400 e Villa.
 *  - Robô de autoatendimento (novo, 0177): interruptor próprio (autoatendimento_ativo), ligado só na Menuzia.
 *
 * Nada muda no que cada loja tem: o webhook usa o autoatendimento quando ele está ligado; senão, o v1 de
 * sempre (lib/mensageria/entrada.ts). O quadro do topo só explica qual dos dois está respondendo.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RoboWhatsappCard, type ConexaoWhatsapp } from '@/components/admin/robo-whatsapp'
import { PainelAutoatendimento } from '@/components/admin/robo/painel-autoatendimento'

type Quem = 'auto' | 'v1' | 'nenhum' | null

function QuemResponde({ quem }: { quem: Quem }) {
  if (quem === null) return null
  const texto = {
    auto: { titulo: 'O robô de autoatendimento (novo) está respondendo.', detalhe: 'Enquanto ele estiver ligado, o robô simples fica em espera — mesmo que esteja ligado.' },
    v1: { titulo: 'O robô simples está respondendo, como sempre.', detalhe: 'Para usar o novo, ligue o robô de autoatendimento abaixo: ele passa a responder no lugar do simples. Teste antes no simulador.' },
    nenhum: { titulo: 'Nenhum robô está respondendo.', detalhe: 'As mensagens dos clientes vão direto para a central de atendimento (botão do WhatsApp no canto da tela).' },
  }[quem]
  return (
    <section className="fin-card min-w-0 px-5 py-4" data-testid="robo-quem-responde" data-quem={quem}>
      <p className="text-[15px] font-semibold text-[#1C2B33]">{texto.titulo}</p>
      <p className="mt-1 text-[13px] leading-[18px] text-[#465A69]">{texto.detalhe}</p>
    </section>
  )
}

export function RoboAtendimentoAjustes({ avisar }: { avisar: (tom: 'ok' | 'erro', texto: string) => void }) {
  const router = useRouter()
  const [conexao, setConexao] = useState<ConexaoWhatsapp>(null)
  const [v1, setV1] = useState<boolean | null>(null)
  const [auto, setAuto] = useState<boolean | null>(null)

  const lerV1 = useCallback(() => {
    fetch('/api/admin/whatsapp/robo', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { roboAtivo?: boolean } | null) => setV1(d ? d.roboAtivo === true : null))
      .catch(() => setV1(null))
  }, [])

  useEffect(() => {
    lerV1()
    fetch('/api/admin/whatsapp/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { configurado: boolean; connected: boolean; state: string | null }) => setConexao({ configurado: d.configurado, conectado: d.connected, estado: d.state }))
      .catch(() => setConexao('falhou'))
  }, [lerV1])

  const quem: Quem = auto === null || v1 === null ? null : auto ? 'auto' : v1 ? 'v1' : 'nenhum'

  return (
    <div className="space-y-4" data-testid="robo-ajustes">
      <QuemResponde quem={quem} />

      <section className="fin-card min-w-0" data-testid="robo-simples">
        <div className="border-b border-[#E4E7EA] px-5 py-4">
          <h3 className="text-[16px] font-semibold leading-tight text-[#1C2B33]">Robô simples</h3>
          <p className="mt-1 text-[13px] leading-[18px] text-[#465A69]">
            O robô de sempre: menu com status do pedido, cardápio, horário e taxa.{auto ? ' Em espera enquanto o autoatendimento estiver ligado.' : ''}
          </p>
        </div>
        <div className="px-5 py-4">
          {/* Mesmo cartão e mesma API de antes; ao ligar/desligar, o quadro do topo relê o estado. */}
          <RoboWhatsappCard somenteConfig conexao={conexao} onConectar={() => { router.push('/admin/integracoes?abrir=whatsapp') }} avisar={(tom, t) => { avisar(tom, t); lerV1() }} />
        </div>
      </section>

      <PainelAutoatendimento onAtivoMudou={setAuto} />
    </div>
  )
}
