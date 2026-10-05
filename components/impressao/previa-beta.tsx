'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import TicketMenuzia from '@/printer-agent/src/ticket-canvas.js'
import { montarComandaV3, montarPreContaV3 } from '@/printer-agent/src/v3.js'
import { contaDemonstracao, pedidoDemonstracao, type TipoDemonstracao } from '@/lib/impressao/previa-beta'
import type { DispositivoVisao } from '@/lib/impressao/servico'
import type { ConfigImpressao } from '@/lib/queries/impressao'
import { SECUNDARIO, TAMANHOS_LETRA, nomeDisp, type PainelDados, type TamanhoLetra } from '@/components/impressao/beta-cards'

/**
 * Pré-visualização REAL do Assistente Beta (coluna da direita da tela Impressão): a
 * comanda, a pré-conta e a via da cozinha montadas pelo mesmo montador do Beta (v3.js, modelo
 * oficial v3) e desenhadas pelo mesmo ticket-canvas.js, com as mesmas fontes, a logo
 * e os dados da loja — na largura em pontos e no tamanho de letra da impressora. O que
 * aparece aqui é o que sai no papel. Embaixo, as "Opções da impressão" da loja (mesmas
 * chaves de sempre), que atualizam o desenho na hora.
 */

type Modelo = 'cozinha' | 'pre_conta' | 'via_cozinha'
const ROTULO: Record<Modelo, string> = { cozinha: 'Comanda', pre_conta: 'Pré-conta', via_cozinha: 'Via da cozinha' }

// Modelo v3: os adicionais saem no nome do item, "(+ Bacon)", com o valor somado ao do item —
// "Mostrar preço dos complementos" não muda o desenho do Beta (continua valendo no Assistente antigo).
type ChaveOpcao = 'mostrarNumeroItem' | 'mostrarNomeComplementos' | 'fonteMaiorProducao' | 'multiplicarOpcoesQtd' | 'imprimirLogo' | 'viaCozinha'
const OPCOES: { chave: ChaveOpcao; rotulo: string; modelos: Modelo[] }[] = [
  { chave: 'viaCozinha', rotulo: 'Imprimir também a via da cozinha (sem valores)', modelos: ['via_cozinha'] },
  { chave: 'mostrarNumeroItem', rotulo: 'Mostrar número do item', modelos: ['cozinha', 'via_cozinha'] },
  { chave: 'mostrarNomeComplementos', rotulo: 'Mostrar nome dos complementos', modelos: ['cozinha'] },
  { chave: 'fonteMaiorProducao', rotulo: 'Fonte maior na via de produção', modelos: ['cozinha'] },
  { chave: 'multiplicarOpcoesQtd', rotulo: 'Multiplicar opções pela quantidade', modelos: ['cozinha', 'via_cozinha'] },
  { chave: 'imprimirLogo', rotulo: 'Imprimir logo da loja', modelos: ['cozinha', 'pre_conta', 'via_cozinha'] },
]

let fontes: Promise<unknown> | null = null
const carregarFontes = () => (fontes ??= TicketMenuzia.carregarRecursos('/impressao/fonts').catch((e: unknown) => {
  fontes = null
  throw e
}))

type Loja = { nome: string; telefone: string; endereco: string; linha1?: string; cidade?: string }
type DadosLoja = { loja: Loja; qr: unknown; logoUrl: string | null }
const LOJA_VAZIA: Loja = { nome: '', telefone: '', endereco: '', linha1: '', cidade: '' }
const TIPOS: { valor: TipoDemonstracao; rotulo: string }[] = [{ valor: 'entrega', rotulo: 'Entrega' }, { valor: 'retirada', rotulo: 'Retirada' }, { valor: 'mesa', rotulo: 'Mesa' }, { valor: 'balcao', rotulo: 'Balcão' }]
// Pré-conta: só mesa e balcão.
const TIPOS_CONTA = TIPOS.filter((t) => t.valor === 'mesa' || t.valor === 'balcao')

export function PreviaBeta({ p, ocupado, config, podeEditar, onPatchConfig, onSalvarLetra }: {
  p: PainelDados
  ocupado: boolean
  config: ConfigImpressao | null
  podeEditar: boolean
  onPatchConfig: (patch: Partial<ConfigImpressao>) => void
  onSalvarLetra: (d: DispositivoVisao, tamanho: TamanhoLetra) => Promise<void>
}) {
  const [modelo, setModelo] = useState<Modelo>('cozinha')
  const [tipoPedido, setTipoPedido] = useState<TipoDemonstracao>('entrega')
  const [dados, setDados] = useState<DadosLoja | null>(null)
  const [logo, setLogo] = useState<HTMLImageElement | null>(null)
  const ativos = useMemo(() => p.dispositivos.filter((d) => !p.agentes.find((a) => a.id === d.agenteId)?.revogado), [p.dispositivos, p.agentes])
  // Impressora da função do documento (Cozinha → comanda; Recibo/Extrato → pré-conta).
  const daFuncao = (m: Modelo) => ativos.find((d) => d.id === (m === 'pre_conta' ? p.funcoes.caixa : p.funcoes.cozinha)) ?? null
  const [impId, setImpId] = useState<string>('')
  const imp = ativos.find((d) => d.id === impId) ?? daFuncao(modelo) ?? ativos[0] ?? null
  const [letra, setLetra] = useState<TamanhoLetra | null>(null)
  const letraVista: TamanhoLetra = letra ?? (imp?.tamanhoFonte as TamanhoLetra) ?? 'grande'
  const [mmSem, setMmSem] = useState<58 | 80>(80)
  const larguraMm = imp ? (imp.larguraMm <= 58 ? 58 : 80) : mmSem
  const larguraPontos = imp?.larguraPontos ?? null

  const canvas = useRef<HTMLCanvasElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [medida, setMedida] = useState<{ largura: number; altura: number } | null>(null)

  useEffect(() => {
    let vivo = true
    fetch('/api/admin/impressao/previa', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (j) => {
        if (!vivo) return
        const d: DadosLoja = j ? { loja: j.loja ?? LOJA_VAZIA, qr: j.qr ?? null, logoUrl: j.logoUrl ?? null } : { loja: LOJA_VAZIA, qr: null, logoUrl: null }
        setDados(d)
        const img = d.logoUrl ? await TicketMenuzia.carregarImagem(d.logoUrl) : null
        if (vivo) setLogo(img)
      })
      .catch(() => { if (vivo) setDados({ loja: LOJA_VAZIA, qr: null, logoUrl: null }) })
    return () => { vivo = false }
  }, [])

  // As opções da loja entram no desenho na hora (a comanda usa todas; a pré-conta, a logo).
  const cfg = config ?? { mostrarNumeroItem: true, mostrarPrecoComplementos: true, mostrarNomeComplementos: true, fonteMaiorProducao: false, multiplicarOpcoesQtd: false, imprimirLogo: true, viaCozinha: false }
  const chaveCfg = OPCOES.map((o) => (cfg[o.chave] ? '1' : '0')).join('')

  useEffect(() => {
    if (!dados || !canvas.current) return
    let vivo = true
    const agora = new Date()
    const doc = modelo === 'pre_conta'
      ? montarPreContaV3({ ...contaDemonstracao(dados.loja.nome, agora, tipoPedido === 'balcao' ? 'balcao' : 'mesa'), qr: dados.qr, loja_dados: dados.loja })
      : (() => {
          const d = pedidoDemonstracao(agora, tipoPedido)
          return montarComandaV3(d.pedido, { config: cfg, lojaNome: dados.loja.nome, loja: dados.loja, extras: d.extras, qr: dados.qr, via: modelo === 'via_cozinha' ? 'cozinha' : 'cliente' })
        })()
    if (!doc) return
    carregarFontes()
      .then(() => {
        if (!vivo || !canvas.current) return
        // Mesmo desenho do papel: 1 bit e a intensidade da impressora.
        setMedida(TicketMenuzia.desenhar(canvas.current, doc, { larguraMm, larguraPontos, tamanhoFonte: letraVista, logo, imprimirLogo: cfg.imprimirLogo !== false, intensidade: imp?.intensidade ?? 'normal' }))
        setErro(null)
      })
      .catch(() => { if (vivo) setErro('Não foi possível carregar as fontes da pré-visualização. Recarregue a página.') })
    return () => { vivo = false }
    // cfg entra pela chave (objeto novo a cada render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados, logo, modelo, tipoPedido, larguraMm, larguraPontos, letraVista, chaveCfg, imp?.intensidade])

  function trocarModelo(m: Modelo) {
    setModelo(m)
    if (m === 'pre_conta' && tipoPedido !== 'mesa' && tipoPedido !== 'balcao') setTipoPedido('mesa')
    setImpId('')
    setLetra(null)
  }

  const salvo = imp?.tamanhoFonte ?? 'grande'
  const aba = (ativo: boolean) =>
    ['flex-1 rounded-[6px] px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors', ativo ? 'bg-white text-[#0570AE] shadow-sm' : 'text-[#4B5563] hover:text-[#111827]'].join(' ')
  const opcoesDaAba = OPCOES.filter((o) => o.modelos.includes(modelo))

  return (
    <section className="rounded-[12px] border border-[#E5E7EB] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5" data-testid="cartao-previa">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">Pré-visualização</h2>
      <div className="mt-2.5 flex gap-1 rounded-[8px] bg-[#F3F4F6] p-1" role="tablist" aria-label="Documento">
        {(['cozinha', 'pre_conta', 'via_cozinha'] as Modelo[]).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={modelo === m} onClick={() => trocarModelo(m)} data-testid={`previa-${m}`} className={aba(modelo === m)}>{ROTULO[m]}</button>
        ))}
      </div>

      {modelo === 'via_cozinha' && (
        <p className="mt-2 rounded-[8px] bg-[#F3F4F6] px-3 py-2 text-[12.5px] text-[#4B5563]" data-testid="previa-via-cozinha-aviso">
          {cfg.viaCozinha ? 'Ligada: sai logo depois de cada comanda, na impressora da Cozinha.' : 'Desligada: só a comanda sai. Para ligar, use as Opções da impressão abaixo.'}
        </p>
      )}
      <div className="mt-2 flex gap-1 rounded-[8px] bg-[#F3F4F6] p-1" role="radiogroup" aria-label="Tipo do pedido">
        {(modelo === 'pre_conta' ? TIPOS_CONTA : TIPOS).map((t) => (
          <button key={t.valor} type="button" role="radio" aria-checked={tipoPedido === t.valor} onClick={() => setTipoPedido(t.valor)} data-testid={`previa-tipo-${t.valor}`} className={aba(tipoPedido === t.valor)}>{t.rotulo}</button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {ativos.length > 0 ? (
          <label className="min-w-0 flex-1 text-[12px] text-[#6B7280]">
            Impressora
            <select value={imp?.id ?? ''} onChange={(e) => { setImpId(e.target.value); setLetra(null) }} data-testid="previa-impressora" className="mt-1 block h-[34px] w-full rounded-[8px] border border-[#D1D5DB] bg-white px-2 text-[13px] text-[#111827]">
              {ativos.map((d) => <option key={d.id} value={d.id}>{nomeDisp(d)}{daFuncao(modelo)?.id === d.id ? (modelo === 'pre_conta' ? ' — Recibo/Extrato' : ' — Cozinha') : ''}</option>)}
            </select>
          </label>
        ) : (
          <div className="flex flex-1 gap-1 rounded-[8px] bg-[#F3F4F6] p-1">
            {([80, 58] as const).map((mm) => <button key={mm} type="button" onClick={() => setMmSem(mm)} className={aba(mmSem === mm)}>Papel {mm} mm</button>)}
          </div>
        )}
        <div className="text-[12px] text-[#6B7280]">
          Letra
          <div className="mt-1 flex gap-1 rounded-[8px] bg-[#F3F4F6] p-1" role="radiogroup" aria-label="Tamanho da letra">
            {TAMANHOS_LETRA.map((t) => (
              <button key={t.valor} type="button" role="radio" aria-checked={letraVista === t.valor} title={t.rotulo} onClick={() => setLetra(t.valor)} data-testid={`previa-letra-${t.valor}`} className={['h-[26px] w-[30px] rounded-[6px] text-[12.5px] font-semibold', letraVista === t.valor ? 'bg-white text-[#0570AE] shadow-sm' : 'text-[#4B5563] hover:text-[#111827]'].join(' ')}>
                {t.curto}
              </button>
            ))}
          </div>
        </div>
      </div>
      {imp && letraVista !== salvo && (
        <button type="button" disabled={ocupado} onClick={() => void onSalvarLetra(imp, letraVista).then(() => setLetra(null))} data-testid="previa-salvar-letra" className={`${SECUNDARIO} mt-2 w-full`}>
          Salvar letra {TAMANHOS_LETRA.find((t) => t.valor === letraVista)?.rotulo.toLowerCase()} em {nomeDisp(imp)}
        </button>
      )}
      <p className="mt-2 text-[12px] text-[#6B7280]" data-testid="previa-medida">
        papel {larguraMm} mm · {medida?.largura ?? (larguraMm === 58 ? 384 : 576)} pontos de largura{larguraPontos ? ' (calibrada)' : ''} · dados de demonstração
      </p>

      <div className="mt-3 flex justify-center rounded-[10px] bg-[#F3F4F6] px-3 py-4">
        {/* Mesma proporção do papel (576 pontos → 360 px na tela; 58 mm e calibrada na mesma escala). */}
        <canvas ref={canvas} data-testid="previa-canvas" className="h-auto bg-white shadow-[0_2px_10px_rgba(15,23,42,0.12)]" style={{ width: Math.round((medida?.largura ?? (larguraMm === 58 ? 384 : 576)) * 0.625), maxWidth: '100%' }} />
      </div>
      {erro && <p className="mt-2 text-[12.5px] text-[#DC2626]">{erro}</p>}

      <div className="mt-4 border-t border-[#F3F4F6] pt-3" data-testid="opcoes-impressao">
        <p className="text-[13px] font-semibold text-[#111827]">Opções da impressão</p>
        {!config ? (
          <p className="mt-1 text-[12.5px] text-[#6B7280]">Carregando…</p>
        ) : (
          <ul className="mt-1 divide-y divide-[#F3F4F6]">
            {opcoesDaAba.map((o) => {
              const ligado = !!config[o.chave]
              return (
                <li key={o.chave} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-[13px] text-[#374151]" id={`opcao-${o.chave}`}>{o.rotulo}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={ligado}
                    aria-labelledby={`opcao-${o.chave}`}
                    disabled={!podeEditar}
                    onClick={() => onPatchConfig({ [o.chave]: !ligado } as Partial<ConfigImpressao>)}
                    data-testid={`opcao-${o.chave}`}
                    className={['relative h-[22px] w-[38px] flex-shrink-0 rounded-full transition-colors disabled:opacity-45', ligado ? 'bg-[#0688D4]' : 'bg-[#D1D5DB]'].join(' ')}
                  >
                    <span className={['absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white shadow transition-all', ligado ? 'left-[19px]' : 'left-[3px]'].join(' ')} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {config && !podeEditar && <p className="mt-1 text-[12px] text-[#6B7280]">Só o dono da loja altera estas opções.</p>}
      </div>
    </section>
  )
}
