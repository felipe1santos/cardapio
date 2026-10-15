'use client'

import { ArrowRight, Bike, Building2, CalendarClock, Camera, ChevronRight, CircleCheck, Image as ImageIcon, MapPin, PanelTop, Phone, Store, Tag, Truck, UtensilsCrossed } from 'lucide-react'
import type { ComponentType } from 'react'
import { ModalCentral } from '@/components/ui/flutuante'
import type { PendenciaSetup } from '@/lib/setup-checklist'

export interface SetupAlertaProps {
  pendencias: PendenciaSetup[]
  /** "OK, entendi": fecha o modal e deixa só o marcador no menu. */
  onDispensar: () => void
  /** "Corrigir": leva para a tela e a seção que resolvem a pendência. */
  onResolver: (href: string) => void
}

type Destino = { link: string; onde: string; Icone: ComponentType<{ className?: string }> }

/**
 * Para onde cada aviso leva (15/10): a aba e a seção exatas, não só o item do menu. Ajustes lê
 * `?aba=` e `?secao=` (rola até a seção e destaca). Aviso sem entrada aqui cai no item do menu.
 */
const DESTINOS: Record<string, Destino> = {
  'sem-canal': { link: '/admin/ajustes?aba=entrega&secao=atendimento', onde: 'Ajustes › Entrega', Icone: Truck },
  'loja-fechada-manual': { link: '/admin/pedidos', onde: 'Painel de Pedidos › Abrir a loja', Icone: Store },
  'sem-item-disponivel': { link: '/admin/cardapio', onde: 'Cardápio › Itens', Icone: UtensilsCrossed },
  'sem-categoria': { link: '/admin/cardapio', onde: 'Cardápio › Categorias', Icone: UtensilsCrossed },
  'itens-sem-preco': { link: '/admin/cardapio', onde: 'Cardápio › Itens', Icone: Tag },
  'itens-sem-dia': { link: '/admin/cardapio', onde: 'Cardápio › Itens', Icone: CalendarClock },
  'sem-telefone': { link: '/admin/ajustes?secao=dados', onde: 'Ajustes › Dados da loja', Icone: Phone },
  'endereco-incompleto': { link: '/admin/ajustes?secao=endereco', onde: 'Ajustes › Endereço', Icone: MapPin },
  'sem-taxa-entrega': { link: '/admin/ajustes?aba=entrega&secao=taxa-padrao', onde: 'Ajustes › Entrega', Icone: Truck },
  'sem-horario': { link: '/admin/ajustes?secao=horario', onde: 'Ajustes › Horário', Icone: CalendarClock },
  'sem-entregador': { link: '/admin/lista-pedidos?tab=entregadores', onde: 'Pedidos › Entregadores', Icone: Bike },
  'sem-logo': { link: '/admin/ajustes?secao=logo', onde: 'Ajustes › Logo', Icone: ImageIcon },
  'sem-capa': { link: '/admin/ajustes?secao=capa', onde: 'Ajustes › Banner de capa', Icone: PanelTop },
  'itens-sem-foto': { link: '/admin/cardapio', onde: 'Cardápio › Itens', Icone: Camera },
}

const MENU_LABEL: Record<string, string> = {
  '/admin/ajustes': 'Ajustes',
  '/admin/cardapio': 'Cardápio',
  '/admin/lista-pedidos': 'Pedidos',
  '/admin/logistica': 'Pedidos',
  '/admin/pedidos': 'Painel de Pedidos',
}

export function destinoDaPendencia(p: PendenciaSetup): Destino {
  return DESTINOS[p.id] ?? { link: p.href, onde: MENU_LABEL[p.href] ?? 'Ajustes', Icone: Building2 }
}

function LinhaPendencia({ p, onResolver }: { p: PendenciaSetup; onResolver: (href: string) => void }) {
  const d = destinoDaPendencia(p)
  const critico = p.severidade === 'critico'
  return (
    <li>
      <button
        type="button"
        data-testid="pendencia-resolver"
        onClick={() => onResolver(d.link)}
        className="group flex w-full items-start gap-3 rounded-[8px] border border-[#E5E7EB] bg-white p-3 text-left transition-colors hover:border-[#0688D4] hover:bg-[#F5FAFE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0688D4]"
      >
        <span
          aria-hidden
          className={[
            'mt-[1px] flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[8px]',
            critico ? 'bg-[#FEE2E2] text-[#DC2626]' : 'bg-[#FEF3C7] text-[#B45309]',
          ].join(' ')}
        >
          <d.Icone className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold leading-snug text-[#1F2937]">{p.titulo}</span>
          <span className="mt-0.5 block text-[12.5px] leading-[18px] text-[#6B7280]">{p.descricao}</span>
          <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[#0688D4]">
            Corrigir em {d.onde}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </span>
        <ChevronRight className="mt-2 h-4 w-4 flex-shrink-0 text-[#9CA3AF] group-hover:text-[#0688D4]" aria-hidden />
      </button>
    </li>
  )
}

function Grupo({ titulo, cor, itens, onResolver }: { titulo: string; cor: string; itens: PendenciaSetup[]; onResolver: (href: string) => void }) {
  if (itens.length === 0) return null
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cor }} aria-hidden />
        {titulo}
        <span className="font-medium normal-case tracking-normal text-[#9CA3AF]">· {itens.length}</span>
      </h3>
      <ul className="space-y-2">
        {itens.map((p) => <LinhaPendencia key={p.id} p={p} onResolver={onResolver} />)}
      </ul>
    </section>
  )
}

/**
 * Avisos da loja: o que falta configurar, separado entre o que impede pedido e o que só melhora a
 * vitrine. Cada aviso é um atalho para a seção que o corrige. Abre sozinho só com pendência crítica
 * nova (assinatura guardada pelo AdminLayout) e sempre pelo ícone de alerta do menu.
 */
export function SetupAlerta({ pendencias, onDispensar, onResolver }: SetupAlertaProps) {
  // Aberto pelo ícone de alerta do menu sem nada pendente: confirma que está tudo certo.
  if (pendencias.length === 0) {
    return (
      <ModalCentral aberto onFechar={onDispensar} titulo="Avisos da loja" largura={420} testid="setup-alerta"
        rodape={<div className="flex justify-end"><button type="button" onClick={onDispensar} className="h-[36px] rounded-[6px] bg-[#0688D4] px-5 text-[12px] font-semibold uppercase tracking-wide text-white hover:bg-[#0570AE]">OK</button></div>}>
        <div className="flex flex-col items-center px-6 py-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#DCFCE7] text-[#16A34A]" aria-hidden>
            <CircleCheck className="h-7 w-7" />
          </span>
          <p className="mt-3 text-[15px] font-semibold text-[#1F2937]">Nenhuma pendência</p>
          <p className="mt-1 text-[13px] text-[#6B7280]">A configuração da sua loja está completa. Bom trabalho!</p>
        </div>
      </ModalCentral>
    )
  }

  const criticas = pendencias.filter((p) => p.severidade === 'critico')
  const melhorias = pendencias.filter((p) => p.severidade !== 'critico')
  const primeira = criticas[0] ?? pendencias[0]

  return (
    <ModalCentral
      aberto
      onFechar={onDispensar}
      largura={560}
      testid="setup-alerta"
      titulo="Avisos da loja"
      subtitulo={criticas.length > 0
        ? 'Há pendências que atrapalham o pedido: enquanto não forem resolvidas, o cliente pode não conseguir fechar a compra.'
        : 'Nada aqui trava o pedido, mas dá pra deixar sua loja mais completa e vender melhor.'}
      classeCorpo="bg-[#F9FAFB]"
      rodape={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onDispensar}
            className="h-[38px] rounded-[6px] border border-[#E5E7EB] bg-white px-4 text-[12px] font-semibold uppercase tracking-wide text-[#6B7280] hover:bg-[#F3F4F6]">
            OK, entendi
          </button>
          <button type="button" onClick={() => onResolver(destinoDaPendencia(primeira).link)}
            className="h-[38px] rounded-[6px] bg-[#0688D4] px-4 text-[12px] font-semibold uppercase tracking-wide text-white hover:bg-[#0570AE]">
            Resolver agora
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-4 sm:p-5">
        <Grupo titulo="Impede pedidos" cor="#EF4444" itens={criticas} onResolver={onResolver} />
        <Grupo titulo="Para melhorar" cor="#F59E0B" itens={melhorias} onResolver={onResolver} />
      </div>
    </ModalCentral>
  )
}
