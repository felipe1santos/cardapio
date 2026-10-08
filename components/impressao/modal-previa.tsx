'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import TicketMenuzia from '@/printer-agent/src/ticket-canvas.js'
import { montarComandaV3, montarPreContaV3 } from '@/printer-agent/src/v3.js'
import { montarRecibo } from '@/printer-agent/src/recibo.js'
import ReciboAntigo from '@/lib/impressao/recibo-antigo-canvas.js'
import { contaDemonstracao, pedidoAntigoDemonstracao, pedidoDemonstracao } from '@/lib/impressao/demonstracao.mjs'
import { JanelaCrua } from '@/components/ui/flutuante'
import type { OpcaoImpressao } from '@/lib/impressao/opcao'
import type { ConfigImpressao } from '@/lib/queries/impressao'
import { compararVersao } from '@/lib/avisos-painel'

/** Primeira versão do Assistente que imprime o QR da rota na comanda de entrega (item 59). */
export const VERSAO_QR_ROTA = '0.2.0-beta.10'

/**
 * "Ver modelo da impressão" — janela VERTICAL no centro (protótipo aprovado,
 * docs/impressao-tela-nova/prototipo/): estreita e quase da altura da tela (no celular, a tela
 * toda). Abre com o papel na LARGURA da janela (legível) e rolagem vertical; "Inteira" cabe tudo,
 * "Largura" volta a encher a largura, − e + mudam o zoom; 100% = tamanho real do papel (80 ou 58 mm).
 *
 * A imagem é a do MESMO desenho da impressora: no Beta, o v3.js + ticket-canvas.js do Assistente
 * (1 bit, a intensidade da impressora); no antigo, o recibo.js do Assistente + a porta do print.ps1
 * (lib/impressao/recibo-antigo-canvas.js). Dados de exemplo = os dos modelos v3.
 */

export type DocPrevia = 'comanda' | 'pre_conta'
type Tipo = 'entrega' | 'retirada' | 'mesa' | 'balcao'
// Item 61: só dois modelos no papel — Cozinha (a comanda de qualquer tipo de pedido) e Pré-conta.
const ROTULO_DOC: Record<DocPrevia, string> = { comanda: 'Cozinha', pre_conta: 'Pré-conta' }
const ROTULO_TIPO: Record<Tipo, string> = { entrega: 'Entrega', retirada: 'Retirada', mesa: 'Mesa', balcao: 'Balcão' }
const PX_POR_MM = 96 / 25.4

export interface PapelPrevia { larguraMm: 58 | 80; larguraPontos: number | null; tamanhoFonte: 'grande' | 'media' | 'pequena'; intensidade: 'normal' | 'escura' | 'mais_escura' }
export interface LojaPrevia { loja: { nome: string; telefone: string; endereco: string; linha1?: string; cidade?: string }; qr: unknown; qrRota?: unknown; logoUrl: string | null; temInstagram?: boolean }

let fontes: Promise<unknown> | null = null
const carregarFontes = () => (fontes ??= TicketMenuzia.carregarRecursos('/impressao/fonts').catch((e: unknown) => { fontes = null; throw e }))

export function ModalPrevia({ aberto, onFechar, opcao, docInicial, dados, config, papelBeta, papelPreConta, antigo, versaoAssistente }: {
  aberto: boolean
  onFechar: () => void
  opcao: OpcaoImpressao
  docInicial: DocPrevia
  dados: LojaPrevia | null
  config: ConfigImpressao | null
  /** Impressora da Cozinha (comanda e via da cozinha) e a do Caixa (pré-conta). */
  papelBeta: PapelPrevia
  papelPreConta: PapelPrevia
  /** Assistente antigo: papel e colunas da impressora dele. */
  antigo: { larguraMm: 58 | 80; colunas: number }
  /** Versão do Assistente do computador que imprime a comanda: até o beta.9 o QR da comanda é o de sempre. */
  versaoAssistente: string
}) {
  const idTitulo = useId()
  const [doc, setDoc] = useState<DocPrevia>(docInicial)
  const [tipo, setTipo] = useState<Tipo>('entrega')
  const [logo, setLogo] = useState<HTMLImageElement | null>(null)
  const [medida, setMedida] = useState<{ largura: number; altura: number } | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  // Até a pessoa mexer no zoom, a janela acompanha a largura (abrir, trocar documento, girar o celular).
  const [ajuste, setAjuste] = useState<'largura' | 'inteira' | 'livre'>('largura')
  const canvas = useRef<HTMLCanvasElement>(null)
  const palco = useRef<HTMLDivElement>(null)

  useEffect(() => { if (aberto) { setDoc(opcao === 'antigo' ? 'comanda' : docInicial); setTipo(docInicial === 'pre_conta' ? 'mesa' : 'entrega'); setAjuste('largura') } }, [aberto, docInicial, opcao])
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
  const qr = config?.qr === false ? null : dados?.qr ?? null
  // Item 61 — o mesmo QR que o servidor manda: comanda de ENTREGA = QR da rota ("ROTA DE ENTREGA");
  // retirada, balcão e mesa sem QR; pré-conta = Instagram da loja (ou nada). Nunca o do cardápio.
  // Até o beta.9 a comanda sai sem QR (o que a loja vê é o que imprime).
  const temQrRota = compararVersao(versaoAssistente, VERSAO_QR_ROTA) >= 0
  const qrComanda = temQrRota && tipoVisto === 'entrega' ? dados?.qrRota ?? null : null
  const avisoAtualizar = opcao !== 'antigo' && !temQrRota && doc !== 'pre_conta' && tipoVisto === 'entrega'
  const chaveCfg = config ? [config.mostrarNumeroItem, config.mostrarNomeComplementos, config.mostrarPrecoComplementos, config.multiplicarOpcoesQtd, config.fonteMaiorProducao, config.imprimirLogo, config.qr].join('') : ''

  useEffect(() => {
    if (!aberto || !dados) return
    let vivo = true
    setCarregando(true)
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
        ? montarPreContaV3({ ...contaDemonstracao(dados.loja.nome, tipoVisto === 'balcao' ? 'balcao' : 'mesa'), qr, loja_dados: dados.loja })
        : (() => {
            const d = pedidoDemonstracao(tipoVisto)
            return montarComandaV3(d.pedido, { config: config ?? {}, lojaNome: dados.loja.nome, loja: dados.loja, extras: d.extras, qr: qrComanda, via: 'cliente' })
          })()
      if (!docTicket) return
      setMedida(TicketMenuzia.desenhar(c, docTicket, { larguraMm: papel.larguraMm, larguraPontos: papel.larguraPontos, tamanhoFonte: papel.tamanhoFonte, logo, imprimirLogo, intensidade: papel.intensidade }))
    }
    desenhar().then(() => { if (vivo) { setErro(null); setCarregando(false) } }).catch(() => { if (vivo) { setCarregando(false); setErro('Não foi possível desenhar o modelo. Feche e abra de novo.') } })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, dados, logo, opcao, doc, tipoVisto, chaveCfg, papel?.larguraMm, papel?.larguraPontos, papel?.tamanhoFonte, papel?.intensidade, antigo.larguraMm, antigo.colunas, imprimirLogo])

  const mm = opcao === 'antigo' ? antigo.larguraMm : papel?.larguraMm ?? 80
  const pontos = medida?.largura ?? (mm === 58 ? 384 : 576)
  // 100% = tamanho real: a bobina em mm e a área impressa em pontos ÷ 8 (mm).
  const bobina1 = mm * PX_POR_MM
  const area1 = (pontos / 8) * PX_POR_MM
  const altura1 = medida ? (medida.altura / medida.largura) * area1 + 12 : 0

  const calcular = useCallback((modo: 'largura' | 'inteira') => {
    const p = palco.current
    if (!p) return 1
    const w = p.clientWidth - 32, h = p.clientHeight - 32
    const porLargura = w / bobina1
    const z = modo === 'largura' || !altura1 ? porLargura : Math.min(porLargura, h / altura1)
    return Math.max(0.2, Math.min(3, Math.round(z * 100) / 100))
  }, [bobina1, altura1])
  useLayoutEffect(() => { if (aberto && ajuste !== 'livre') setZoom(calcular(ajuste)) }, [aberto, ajuste, calcular, medida])
  useEffect(() => {
    if (!aberto) return
    const r = () => setAjuste((a) => { if (a !== 'livre') setZoom(calcular(a)); return a })
    window.addEventListener('resize', r)
    return () => window.removeEventListener('resize', r)
  }, [aberto, calcular])

  const docs: DocPrevia[] = opcao === 'antigo' ? ['comanda'] : ['comanda', 'pre_conta']
  const passo = (d: number) => { setAjuste('livre'); setZoom((z) => Math.max(0.2, Math.min(3, Math.round((z + d) * 10) / 10))) }

  return (
    <JanelaCrua aberto={aberto} onFechar={onFechar} rotuloId={idTitulo} testid="modal-previa" classeTema="tela-impressao" classeFundo="ti-fundo-modal" classeJanela="ti-modal">
      <div className="ti-m-cab">
        <div>
          <h3 id={idTitulo}>Modelo da impressão</h3>
          <p data-testid="modal-previa-sub">{opcao === 'antigo' ? 'Assistente antigo' : 'Assistente novo'}, papel {mm} mm, dados de exemplo</p>
        </div>
        <button type="button" className="ti-fechar" onClick={onFechar} aria-label="Fechar" data-testid="modal-previa-fechar"><X className="h-[18px] w-[18px]" /></button>
      </div>
      <div className="ti-m-ctl">
        {docs.length > 1 && (
          <div className="ti-seg" role="group" aria-label="Documento">
            {docs.map((d) => (
              <button key={d} type="button" aria-pressed={doc === d} onClick={() => { setDoc(d); setAjuste('largura') }} data-testid={`modal-doc-${d}`}>{ROTULO_DOC[d]}</button>
            ))}
          </div>
        )}
        <select className="ti-campo" aria-label="Tipo de pedido" value={tipoVisto} onChange={(e) => { setTipo(e.target.value as Tipo); setAjuste('largura') }} data-testid="modal-tipo">
          {tipos.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
        </select>
      </div>
      <div className="ti-palco" ref={palco} data-testid="modal-previa-papel" data-papel-mm={mm}>
        <div className="ti-papel" style={{ width: bobina1 * zoom }}>
          <canvas ref={canvas} data-testid="modal-previa-canvas" style={{ width: area1 * zoom }} />
        </div>
        {carregando && <p className="absolute mt-6 text-[13px] font-semibold" style={{ color: 'var(--ti-ink-2)' }} data-testid="modal-previa-carregando">Desenhando o modelo…</p>}
      </div>
      {avisoAtualizar && <p className="px-4 py-2 text-[12.5px]" style={{ color: 'var(--ti-ink-2)' }} data-testid="modal-previa-atualizar">Atualize o assistente para imprimir o QR da rota do entregador.</p>}
      {erro && <p className="px-4 py-2 text-[13px]" style={{ color: 'var(--ti-bad)' }}>{erro}</p>}
      <div className="ti-m-rod">
        <span>100% = tamanho real</span>
        <div className="ti-zoom">
          <button type="button" onClick={() => passo(-0.1)} aria-label="Diminuir" data-testid="modal-zoom-menos">−</button>
          <span data-testid="modal-zoom-valor">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => passo(0.1)} aria-label="Aumentar" data-testid="modal-zoom-mais">+</button>
          <button type="button" onClick={() => setAjuste('inteira')} data-testid="modal-zoom-inteira">Inteira</button>
          <button type="button" onClick={() => setAjuste('largura')} data-testid="modal-zoom-largura">Largura</button>
        </div>
      </div>
    </JanelaCrua>
  )
}
