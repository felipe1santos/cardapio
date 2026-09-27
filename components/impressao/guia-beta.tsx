'use client'

import { Check, Download, KeyRound, Printer, ShieldCheck, Monitor, ReceiptText, ChefHat, FlaskConical, ToggleRight, MonitorCog, Link2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { DOWNLOAD_ASSISTENTE_BETA } from '@/lib/impressao/rotulos'
import type { ModoBeta } from '@/lib/impressao/servico'

/**
 * "Assistente Beta em 8 passos": o que muda em relação ao Assistente atual, o passo a
 * passo com o que JÁ foi feito nesta loja (tirado do painel, não de memória do navegador)
 * e o que cada modo imprime. Só explica — nenhuma ação aqui além de gerar o código.
 */
export interface EstadoGuia {
  liberado: boolean
  pareados: number
  online: number
  cozinhaOk: boolean
  caixaOk: boolean
  testeImpresso: boolean
  modo: ModoBeta
}

const MODOS: { m: ModoBeta; titulo: string; texto: string }[] = [
  { m: 'teste', titulo: 'Somente teste', texto: 'Só calibração e teste. Não imprime pedido real.' },
  { m: 'caixa', titulo: 'Somente Caixa', texto: 'Imprime o Recibo/Extrato no Caixa. A cozinha continua no Assistente atual.' },
  { m: 'cozinha_caixa', titulo: 'Cozinha e Caixa', texto: 'A cozinha sai na impressora da Cozinha e o Recibo/Extrato no Caixa.' },
]

export function GuiaBeta({ e, onParear, ocupado }: { e: EstadoGuia; onParear: () => void; ocupado: boolean }) {
  const passos: { icone: LucideIcon; titulo: string; texto: React.ReactNode; feito: boolean }[] = [
    {
      icone: Download,
      titulo: 'Baixar o Assistente Beta',
      texto: (
        <a href={DOWNLOAD_ASSISTENTE_BETA.url} className="font-semibold text-primary underline" data-testid="guia-baixar-beta">
          Baixar versão {DOWNLOAD_ASSISTENTE_BETA.versao} (Windows)
        </a>
      ),
      feito: e.pareados > 0,
    },
    { icone: Monitor, titulo: 'Instalar no Windows', texto: 'Dois cliques no instalador. Se o Windows avisar: “Mais informações” → “Executar assim mesmo”.', feito: e.pareados > 0 },
    {
      icone: Link2,
      titulo: 'Clicar em “Parear computador (Beta)”',
      texto: e.liberado ? (
        <button type="button" onClick={onParear} disabled={ocupado} data-testid="gerar-codigo-guia" className="font-semibold text-primary underline disabled:opacity-50">
          Gerar o código agora
        </button>
      ) : (
        'Disponível quando o suporte liberar o Beta para a loja.'
      ),
      feito: e.pareados > 0,
    },
    { icone: KeyRound, titulo: 'Digitar o código no Assistente Beta', texto: 'Vale 10 minutos e uma vez só. Depois disso o computador fica autorizado sozinho.', feito: e.online > 0 },
    { icone: ChefHat, titulo: 'Escolher a impressora da Cozinha', texto: 'Na seção “Funções”, logo abaixo.', feito: e.cozinhaOk },
    { icone: ReceiptText, titulo: 'Escolher a impressora do Caixa (Recibo/Extrato)', texto: 'Pode ser a mesma da cozinha, se a loja só tiver uma.', feito: e.caixaOk },
    { icone: FlaskConical, titulo: 'Imprimir calibração e teste', texto: 'Na seção “Teste e calibração”. Confira se o papel saiu inteiro e sem corte.', feito: e.testeImpresso },
    { icone: ToggleRight, titulo: 'Só depois, mudar o modo para imprimir de verdade', texto: 'Enquanto estiver em “Somente teste”, nenhum pedido real sai pelo Beta.', feito: e.modo !== 'teste' },
  ]
  const proximo = passos.findIndex((p) => !p.feito)

  return (
    <section className="min-w-0 overflow-hidden rounded-menuzia border border-border bg-white" data-testid="guia-beta">
      <div className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[14px] font-bold text-text-main">
          <MonitorCog className="h-4 w-4 text-primary" /> Assistente Beta em 8 passos
        </h2>
        <p className="mt-0.5 text-[12px] text-text-subtle">
          {proximo === -1 ? 'Tudo pronto nesta loja.' : `Próximo passo: ${passos[proximo].titulo.replace(/“|”/g, '"')}.`}
        </p>
      </div>

      {/* O que muda */}
      <div className="grid gap-3 p-4 md:grid-cols-2 [&>*]:min-w-0">
        <div className="rounded-menuzia border border-border p-3">
          <p className="flex items-center gap-2 text-[13px] font-bold text-text-main"><Printer className="h-4 w-4 text-text-subtle" /> Assistente atual</p>
          <ul className="mt-1.5 space-y-1 text-[12px] leading-[17px] text-text-subtle">
            <li>Usa o <strong className="text-text-main">token manual</strong>: você copia daqui e cola no programa.</li>
            <li>Continua instalado e imprimindo a cozinha enquanto o Beta estiver em teste.</li>
          </ul>
        </div>
        <div className="rounded-menuzia border-2 border-primary/40 bg-alert-bg/40 p-3">
          <p className="flex items-center gap-2 text-[13px] font-bold text-text-main"><ShieldCheck className="h-4 w-4 text-primary" /> Assistente Beta</p>
          <ul className="mt-1.5 space-y-1 text-[12px] leading-[17px] text-text-subtle">
            <li><strong className="text-text-main">Não usa token.</strong> Pareia com um código temporário gerado aqui.</li>
            <li>Depois de pareado, guarda a autorização sozinho (cifrada no computador). Não há nada para copiar.</li>
            <li>Usa as impressoras <strong className="text-text-main">já instaladas no Windows</strong> e não cria impressora nova.</li>
            <li>Instala ao lado do Assistente atual, sem desinstalar nada.</li>
          </ul>
        </div>
      </div>

      {/* Passos */}
      <ol className="grid gap-2 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="guia-passos">
        {passos.map((p, i) => {
          const Icone = p.icone
          const atual = i === proximo
          return (
            <li
              key={p.titulo}
              data-feito={p.feito ? 'sim' : 'nao'}
              className={[
                'flex min-w-0 gap-2.5 rounded-menuzia border p-3',
                p.feito ? 'border-status-ready/40 bg-price-bg/40' : atual ? 'border-primary bg-alert-bg/50' : 'border-border',
              ].join(' ')}
            >
              <span
                className={[
                  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
                  p.feito ? 'bg-status-ready text-white' : atual ? 'bg-primary text-white' : 'bg-page text-text-subtle',
                ].join(' ')}
                aria-hidden
              >
                {p.feito ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[12.5px] font-bold leading-[17px] text-text-main">
                  <Icone className="h-3.5 w-3.5 flex-shrink-0 text-text-subtle" /> {p.titulo}
                </p>
                <p className="mt-0.5 text-[12px] leading-[17px] text-text-subtle">{p.texto}</p>
              </div>
            </li>
          )
        })}
      </ol>

      {/* Modos */}
      <div className="border-t border-border px-4 py-3">
        <p className="text-[12.5px] font-bold text-text-main">O que cada modo imprime</p>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          {MODOS.map((x) => (
            <div key={x.m} className={['rounded-menuzia border p-2.5', e.modo === x.m ? 'border-primary bg-alert-bg/40' : 'border-border'].join(' ')}>
              <p className="text-[12.5px] font-bold text-text-main">
                {x.titulo} {e.modo === x.m && <span className="ml-1 rounded-full bg-primary px-1.5 py-[1px] text-[10px] font-bold uppercase text-white">agora</span>}
              </p>
              <p className="mt-0.5 text-[12px] leading-[17px] text-text-subtle">{x.texto}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-text-subtle">
          Deu problema? Volte para <strong className="text-text-main">Somente teste</strong> em “Funções”: os pedidos reais param de sair pelo Beta na hora e a cozinha volta para o Assistente atual.
        </p>
      </div>
    </section>
  )
}
