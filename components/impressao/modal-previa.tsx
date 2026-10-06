'use client'

import { useEffect, useRef, useState } from 'react'
import TicketMenuzia from '@/printer-agent/src/ticket-canvas.js'
import { montarComandaV3, montarPreContaV3 } from '@/printer-agent/src/v3.js'
import { montarRecibo } from '@/printer-agent/src/recibo.js'
import ReciboAntigo from '@/lib/impressao/recibo-antigo-canvas.js'
import { contaDemonstracao, pedidoAntigoDemonstracao, pedidoDemonstracao } from '@/lib/impressao/demonstracao.mjs'
import { ModalCentral } from '@/components/ui/flutuante'
import type { OpcaoImpressao } from '@/lib/impressao/opcao'
import type { ConfigImpressao } from '@/lib/queries/impressao'

/**
 * Prévia da impressão em JANELA no centro da tela, no TAMANHO DO PAPEL (80 ou 58 mm): o
 * desenho tem a largura impressa de verdade (576 pontos = 72 mm, 384 = 48 mm, a 8 pontos por
 * mm) dentro da bobina. Sem fechar, alterna o documento (Comanda / Pré-conta / Via da cozinha)
 * e o tipo do pedido (Entrega / Retirada / Mesa / Balcão).
 *
 * Mesmo desenho da impressora: no Beta, o v3.js + ticket-canvas.js do Assistente (1 bit, a
 * intensidade da impressora); no antigo, o recibo.js do Assistente + a porta do print.ps1
 * (lib/impressao/recibo-antigo-canvas.js). Dados de demonstração = os dos modelos v3.
 */

export type DocPrevia = 'comanda' | 'pre_conta' | 'via_cozinha'
type Tipo = 'entrega' | 'retirada' | 'mesa' | 'balcao'
const ROTULO_DOC: Record<DocPrevia, string> = { comanda: 'Comanda', pre_conta: 'Pré-conta', via_cozinha: 'Via da cozinha' }
const ROTULO_TIPO: Record<Tipo, string> = { entrega: 'Entrega', retirada: 'Retirada', mesa: 'Mesa', balcao: 'Balcão' }

export interface PapelPrevia { larguraMm: 58 | 80; larguraPontos: number | null; tamanhoFonte: 'grande' | 'media' | 'pequena'; intensidade: 'normal' | 'escura' | 'mais_escura' }
export interface LojaPrevia { loja: { nome: string; telefone: string; endereco: string; linha1?: string; cidade?: string }; qr: unknown; logoUrl: string | null }

let fontes: Promise<unknown> | null = null
const carregarFontes = () => (fontes ??= TicketMenuzia.carregarRecursos('/impressao/fonts').catch((e: unknown) => { fontes = null; throw e }))

export function ModalPrevia({ aberto, onFechar, opcao, docInicial, dados, config, papelBeta, papelPreConta, antigo }: {
  aberto: boolean
  onFechar: () => void
  opcao: OpcaoImpressao
  docInicial: DocPrevia
  dados: LojaPrevia | null
  config: ConfigImpressao | null
  /** Impressora da Cozinha (comanda e via da cozinha) e a do Recibo/Extrato (pré-conta). */
  papelBeta: PapelPrevia
  papelPreConta: PapelPrevia
  /** Assistente antigo: papel e colunas da impressora dele. */
  antigo: { larguraMm: 58 | 80; colunas: number }
}) {
  const [doc, setDoc] = useState<DocPrevia>(docInicial)
  const [tipo, setTipo] = useState<Tipo>('entrega')
  const [logo, setLogo] = useState<HTMLImageElement | null>(null)
  const [medida, setMedida] = useState<{ largura: number; altura: number } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // Tamanho real (milímetros do papel) ou ampliado (1 ponto = 1 pixel) para ler os detalhes.
  const [ampliado, setAmpliado] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => { if (aberto) { setDoc(opcao === 'antigo' ? 'comanda' : docInicial); setTipo(docInicial === 'pre_conta' ? 'mesa' : 'entrega') } }, [aberto, docInicial, opcao])
  useEffect(() => {
    let vivo = true
    if (!aberto || !dados?.logoUrl) { setLogo(null); return }
    void TicketMenuzia.carregarImagem(dados.logoUrl).then((img) => { if (vivo) setLogo(img) })
    return () => { vivo = false }
  }, [aberto, dados?.logoUrl])

  const tipos: Tipo[] = doc === 'pre_conta' ? ['mesa', 'balcao'] : ['entrega', 'retirada', 'mesa', 'balcao']
  const tipoVisto: Tipo = tipos.includes(tipo) ? tipo : tipos[0]
  const papel = opcao === 'antigo' ? null : doc === 'pre_conta' ? papelPreConta : papelBeta
  const imprimirLogo = config?.imprimirLogo !== false
  const chaveCfg = config ? [config.mostrarNumeroItem, config.mostrarNomeComplementos, config.mostrarPrecoComplementos, config.multiplicarOpcoesQtd, config.fonteMaiorProducao, config.imprimirLogo].join('') : ''

  useEffect(() => {
    if (!aberto || !dados) return
    let vivo = true
    const desenhar = async () => {
      // O canvas só existe depois que a janela abriu.
      for (let i = 0; i < 20 && !canvas.current; i++) await new Promise((r) => requestAnimationFrame(r))
      const c = canvas.current
      if (!c || !vivo) return
      if (opcao === 'antigo') {
        const cfg = { mostrarNumeroItem: true, mostrarNomeComplementos: true, mostrarPrecoComplementos: true, multiplicarOpcoesQtd: false, imprimirLogo: true, fonteMaiorProducao: false, ...(config ?? {}) }
        const comLogo = cfg.imprimirLogo && !!logo
        const texto = montarRecibo(pedidoAntigoDemonstracao(tipoVisto), cfg, antigo.colunas, dados.loja.nome, comLogo)
        setMedida(ReciboAntigo.desenhar(c, texto, { larguraMm: antigo.larguraMm, colunas: antigo.colunas, fonteMaior: cfg.fonteMaiorProducao === true, logo: comLogo ? logo : null, umBit: false }))
        return
      }
      await carregarFontes()
      if (!vivo || !papel) return
      const docTicket = doc === 'pre_conta'
        ? montarPreContaV3({ ...contaDemonstracao(dados.loja.nome, tipoVisto === 'balcao' ? 'balcao' : 'mesa'), qr: dados.qr, loja_dados: dados.loja })
        : (() => {
            const d = pedidoDemonstracao(tipoVisto)
            return montarComandaV3(d.pedido, { config: config ?? {}, lojaNome: dados.loja.nome, loja: dados.loja, extras: d.extras, qr: dados.qr, via: doc === 'via_cozinha' ? 'cozinha' : 'cliente' })
          })()
      if (!docTicket) return
      setMedida(TicketMenuzia.desenhar(c, docTicket, { larguraMm: papel.larguraMm, larguraPontos: papel.larguraPontos, tamanhoFonte: papel.tamanhoFonte, logo, imprimirLogo, intensidade: papel.intensidade }))
    }
    desenhar().then(() => vivo && setErro(null)).catch(() => { if (vivo) setErro('Não foi possível desenhar a prévia. Feche e abra de novo.') })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, dados, logo, opcao, doc, tipoVisto, chaveCfg, papel?.larguraMm, papel?.larguraPontos, papel?.tamanhoFonte, papel?.intensidade, antigo.larguraMm, antigo.colunas, imprimirLogo])

  const docs: DocPrevia[] = opcao === 'antigo' ? ['comanda'] : ['comanda', 'pre_conta', 'via_cozinha']
  const mm = opcao === 'antigo' ? antigo.larguraMm : papel?.larguraMm ?? 80
  const pontos = medida?.largura ?? (mm === 58 ? 384 : 576)
  const aba = (ativo: boolean) => ['flex-1 whitespace-nowrap rounded-[6px] px-2.5 py-1.5 text-[13px] font-semibold', ativo ? 'bg-white text-[#0868A6] shadow-sm' : 'text-[#465A69] hover:text-[#1C2B33]'].join(' ')

  return (
    <ModalCentral
      aberto={aberto}
      onFechar={onFechar}
      largura={520}
      testid="modal-previa"
      titulo={opcao === 'antigo' ? 'Comanda do Assistente antigo' : `${ROTULO_DOC[doc]} — Assistente Beta`}
      subtitulo={`Papel ${mm} mm, no tamanho real · ${pontos} pontos de largura · dados de demonstração`}
    >
      <div className="space-y-2 px-4 pt-3 sm:px-5">
        {docs.length > 1 && (
          <div className="flex gap-1 rounded-[8px] bg-[#EFF1F3] p-1" role="tablist" aria-label="Documento">
            {docs.map((d) => (
              <button key={d} type="button" role="tab" aria-selected={doc === d} onClick={() => setDoc(d)} data-testid={`modal-doc-${d}`} className={aba(doc === d)}>{ROTULO_DOC[d]}</button>
            ))}
          </div>
        )}
        <div className="flex gap-1 rounded-[8px] bg-[#EFF1F3] p-1" role="radiogroup" aria-label="Tipo do pedido" data-testid="modal-tipos">
          {tipos.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={tipoVisto === t} onClick={() => setTipo(t)} data-testid={`modal-tipo-${t}`} className={aba(tipoVisto === t)}>{ROTULO_TIPO[t]}</button>
          ))}
        </div>
      </div>
      <div className="flex justify-end px-4 pt-2 sm:px-5">
        <button type="button" onClick={() => setAmpliado((v) => !v)} aria-pressed={ampliado} data-testid="modal-ampliar" className="fin-btn fin-btn-texto">
          {ampliado ? 'Ver no tamanho real' : 'Ampliar'}
        </button>
      </div>
      <div className="mt-1 flex justify-center overflow-x-auto bg-[#E4E7EA] px-3 py-5" data-testid="modal-previa-papel" data-papel-mm={mm}>
        {/* A bobina (80/58 mm) com a área impressa (72/48 mm) no centro, em milímetros reais. */}
        <div className="flex flex-shrink-0 justify-center bg-white py-2 shadow-[0_2px_10px_rgba(15,23,42,0.16)]" style={ampliado ? { width: (pontos * mm) / (pontos / 8) } : { width: `${mm}mm`, maxWidth: '100%' }}>
          <canvas ref={canvas} data-testid="modal-previa-canvas" className="block h-auto bg-white" style={ampliado ? { width: pontos } : { width: `${pontos / 8}mm`, maxWidth: '100%' }} />
        </div>
      </div>
      {erro && <p className="px-5 pb-3 text-[13px] text-[#D93616]">{erro}</p>}
    </ModalCentral>
  )
}
