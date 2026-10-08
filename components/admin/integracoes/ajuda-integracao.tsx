'use client'

import { useState, type ReactNode } from 'react'
import { BadgeDollarSign, CircleHelp, Info, ListChecks, MessageCircle, QrCode } from 'lucide-react'
import { Dica, ModalCentral } from '@/components/ui/flutuante'
import { SUPORTE_MENUZIA } from '@/lib/suporte'

/**
 * Ajuda de uma integração (2026-10-08): botão "i" sutil (cinza, azul no hover, dica "Como funciona")
 * que abre uma janela central com a explicação para o lojista — curta e sem nada técnico.
 * Por enquanto só o Mercado Pago (Pix online); o mesmo par botão + janela serve depois para
 * WhatsApp e Pixel: basta outro conteúdo em CONTEUDO.
 */

type IdAjuda = 'mercadopago'

export function BotaoAjudaIntegracao({ id, className = '' }: { id: IdAjuda; className?: string }) {
  const [aberta, setAberta] = useState(false)
  return (
    <>
      <Dica texto="Como funciona">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setAberta(true) }}
          aria-label="Como funciona"
          data-testid={`ajuda-${id}`}
          className={`flex h-[32px] w-[32px] flex-shrink-0 items-center justify-center rounded-full text-[#9CA3AF] transition-colors hover:bg-[#EFF7FD] hover:text-[#0688D4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0688D4] ${className}`}
        >
          <Info className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </Dica>
      <ModalCentral
        aberto={aberta}
        onFechar={() => setAberta(false)}
        titulo={CONTEUDO[id].titulo}
        subtitulo={CONTEUDO[id].subtitulo}
        largura={560}
        testid={`ajuda-${id}-janela`}
        classeCorpo="px-4 py-4 sm:px-5"
        rodape={
          <a
            href={`https://wa.me/${SUPORTE_MENUZIA.whatsapp}?text=${encodeURIComponent(CONTEUDO[id].mensagemSuporte)}`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`ajuda-${id}-suporte`}
            className="flex h-[44px] w-full items-center justify-center gap-2 rounded-[6px] bg-[#15803D] px-4 text-[14px] font-semibold text-white hover:bg-[#166534]"
          >
            <MessageCircle className="h-[18px] w-[18px]" strokeWidth={2} /> Falar com o suporte
          </a>
        }
      >
        {CONTEUDO[id].corpo}
      </ModalCentral>
    </>
  )
}

function Bloco({ icone, titulo, children }: { icone: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <section className="flex gap-3 border-b border-[#E5E7EB] py-4 first:pt-0 last:border-0 last:pb-0">
      <span className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-full bg-[#EFF7FD] text-[#0688D4]">{icone}</span>
      <div className="min-w-0 flex-1 text-[14px] leading-[21px] text-[#374151]">
        <h3 className="mb-1 text-[15px] font-semibold text-[#1F2937]">{titulo}</h3>
        {children}
      </div>
    </section>
  )
}

function Pergunta({ p, children }: { p: string; children: ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="font-semibold text-[#1F2937]">{p}</p>
      <p>{children}</p>
    </div>
  )
}

const ICONE = 'h-[18px] w-[18px]'

const CONTEUDO: Record<IdAjuda, { titulo: string; subtitulo: string; mensagemSuporte: string; corpo: ReactNode }> = {
  mercadopago: {
    titulo: 'Pix online: como funciona',
    subtitulo: 'Receba o Pix na hora, direto pelo seu cardápio.',
    mensagemSuporte: 'Olá! Preciso de ajuda com o Pix online (Mercado Pago).',
    corpo: (
      <div data-testid="ajuda-mercadopago-texto">
        <Bloco icone={<QrCode className={ICONE} />} titulo="O que é">
          <p>O cliente paga com Pix na hora, pelo seu cardápio. O dinheiro cai direto na sua conta do Mercado Pago. O pedido só vai para a cozinha depois de pago.</p>
        </Bloco>
        <Bloco icone={<BadgeDollarSign className={ICONE} />} titulo="Quanto custa">
          <p>A Menuzia não cobra nada a mais. O Mercado Pago cobra a taxa da sua conta por Pix recebido — confira o valor no app do Mercado Pago.</p>
        </Bloco>
        <Bloco icone={<ListChecks className={ICONE} />} titulo="Passo a passo">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Crie uma conta grátis no app do Mercado Pago (de preferência no CNPJ da loja).</li>
            <li>No app, cadastre uma chave Pix — o CNPJ é o recomendado.</li>
            <li>Aqui, toque em <span className="font-semibold">Conectar Mercado Pago</span> e autorize. Só o dono da loja consegue conectar.</li>
            <li>Pronto: aparece <span className="font-semibold">Pagar agora</span> no seu cardápio.</li>
          </ol>
        </Bloco>
        <Bloco icone={<CircleHelp className={ICONE} />} titulo="Perguntas comuns">
          <Pergunta p="E se o cliente não pagar?">O pedido é cancelado sozinho depois do prazo para pagar. Nada é cobrado.</Pergunta>
          <Pergunta p="E se ele pagar depois do prazo?">O pagamento fica como &quot;a devolver&quot; e você recebe um aviso.</Pergunta>
          <Pergunta p="Como devolver o dinheiro?">Aqui mesmo, em Últimos Pix online › Devolver. Precisa da senha (PIN) do gerente ou do dono.</Pergunta>
          <Pergunta p="Como desligar?">Toque em Desconectar. O cardápio para de oferecer o Pix online na hora.</Pergunta>
        </Bloco>
      </div>
    ),
  },
}
