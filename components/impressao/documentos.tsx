'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/admin/campos-ajustes'
import type { ConfigImpressao, ImpressoraInput } from '@/lib/queries/impressao'

/**
 * Documentos do Assistente de Impressão atual: impressoras cadastradas (papel, fonte,
 * cópias) e a prévia FIEL da ficha da cozinha. Vieram da antiga aba Ajustes › Impressão sem
 * mudança de lógica — a Impressão agora tem uma página só.
 */

const TAMANHOS_FONTE = [
  { value: 'grande', label: 'Grande (recomendado)' },
  { value: 'media', label: 'Média' },
  { value: 'pequena', label: 'Pequena (mais conteúdo por linha)' },
]
// Largura do papel -> nº de colunas base (a fonte escala a partir disso).
const LARGURAS_PAPEL = [
  { value: 48, label: '80mm (padrão)' },
  { value: 32, label: '58mm (bobina pequena)' },
]

export const IMPRESSORA_VAZIA: ImpressoraInput = { nome: '', tamanhoFonte: 'grande', largura: 48, copias: 1 }

export function ImpressoraModal({
  initial,
  onSave,
  onClose,
}: {
  initial: ImpressoraInput
  onSave: (input: ImpressoraInput) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<ImpressoraInput>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!form.nome.trim()) {
      setError('Dê um nome para a impressora.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
    } catch {
      setError('Não foi possível salvar a impressora.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-menuzia bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4.5 py-3.5">
          <h3 className="text-[15px] font-bold">Editar impressora</h3>
          <button onClick={onClose} className="flex h-[28px] w-[28px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">×</button>
        </div>
        <div className="space-y-3.5 p-4.5">
          <Field label="Nome da impressora" hint="Só um apelido pra você identificar (ex.: Cozinha, Balcão).">
            <Input value={form.nome} onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))} placeholder="Ex: Impressora Padrão" />
          </Field>
          <div className="flex gap-3">
            <div className="flex-1">
              <Field label="Tamanho da fonte" hint="'Grande' = letras maiores. Use 'Grande' pra recibo bem legível.">
                <select value={form.tamanhoFonte} onChange={(e) => setForm((p) => ({ ...p, tamanhoFonte: e.target.value }))}
                  className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary">
                  {TAMANHOS_FONTE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Largura do papel" hint="A bobina que você usa.">
                <select value={form.largura} onChange={(e) => setForm((p) => ({ ...p, largura: Number(e.target.value) }))}
                  className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary">
                  {LARGURAS_PAPEL.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </Field>
            </div>
          </div>
          <Field label="Cópias impressas por pedido">
            <Input type="number" min={1} max={5} value={form.copias} onChange={(e) => setForm((p) => ({ ...p, copias: Number(e.target.value) || 1 }))} />
          </Field>
          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </div>
        <div className="flex gap-2.5 border-t border-border p-4.5">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Preview do recibo: PORT FIEL do printer-agent/src/recibo.js ─────────────
// Estes helpers e a função montarReciboTexto reproduzem EXATAMENTE o que o agente
// imprime (mesmas seções, mesma largura, mesma quebra de linha), pra a prévia bater
// 1:1 com a impressão real. Se mudar o recibo.js do agente, mude aqui também.

function brlR(v: number): string { return `R$ ${v.toFixed(2).replace('.', ',')}` }

/** Tamanho da fonte (config da impressora) -> nº de colunas — espelha o agente (main.js).
 * Relativo à largura base do papel: em 48 dá grande=30/média=38/pequena=48; em 32
 * (58mm) escala junto (grande=20/média=25/pequena=32). */
export function colsParaFontePreview(tamanho: string | undefined, largura: number): number {
  const t = String(tamanho || '').toLowerCase()
  const base = Number(largura) > 0 ? Number(largura) : 48
  if (t.includes('grand')) return Math.max(14, Math.round(base * 0.55))
  if (t.includes('med') || t.includes('norm')) return Math.max(16, Math.round(base * 0.72))
  return base
}

interface PreviewItem { quantidade: number; nome: string; precoUnitario: number; tamanhoNome: string; saborNome: string; bordaNome: string; massaNome: string; complementos: { nome: string; preco: number }[]; observacao: string }
interface PreviewPedido { numero: number; tipo: 'entrega' | 'retirada'; clienteNome: string; clienteTelefone: string; enderecoRua: string; enderecoNumero: string; enderecoComplemento: string; enderecoBairro: string; enderecoCep: string; formaPagamento: string; trocoPara: number | null; pago: boolean; origem: string; mesa: string | null; observacao: string; criadoEm: string; subtotal: number; taxaEntrega: number; total: number; itens: PreviewItem[] }

// Pedido fictício só pra ilustrar — não vem do banco. Traz de propósito um complemento
// COM preço, uma observação de item, observação do pedido e pagamento em dinheiro com
// troco, pra que TODOS os toggles (preço/nome dos complementos, multiplicar opções etc.)
// produzam mudança visível na prévia ao serem ligados/desligados.
const PEDIDO_PREVIEW_RECIBO: PreviewPedido = {
  numero: 1234,
  tipo: 'entrega',
  clienteNome: 'João Silva',
  clienteTelefone: '(81) 99999-0000',
  enderecoRua: 'Rua das Flores', enderecoNumero: '123', enderecoComplemento: 'Apto 202', enderecoBairro: 'Centro', enderecoCep: '52000-000',
  formaPagamento: 'dinheiro', trocoPara: 150, pago: false, origem: 'cardapio', mesa: null,
  observacao: 'Tocar a campainha', criadoEm: '2026-07-14T20:30:00-03:00',
  subtotal: 110, taxaEntrega: 6, total: 116,
  itens: [
    { quantidade: 2, nome: 'Pizza Grande', precoUnitario: 45, tamanhoNome: 'Grande', saborNome: 'Calabresa', bordaNome: 'Catupiry', massaNome: '', complementos: [{ nome: 'Bacon extra', preco: 4 }], observacao: 'Bem assada' },
    { quantidade: 1, nome: 'Coca-Cola 2L', precoUnitario: 12, tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos: [{ nome: 'Bem gelada', preco: 0 }], observacao: '' },
  ],
}

// Linha tipada do recibo — espelha os marcadores de montarReciboLinhas() do agente
// (recibo.js). O preview desenha cada tipo com CSS (barra preta, item negrito, etc.).
type ReciboLinha =
  | { t: 'N'; s: string } | { t: 'H'; s: string } | { t: 'C'; s: string }
  | { t: 'I'; nome: string; preco: string } | { t: 'S'; s: string }
  | { t: 'P'; k: string; v: string } | { t: 'T'; k: string; v: string }
  | { t: 'L'; s: string } | { t: 'R' } | { t: 'F'; s: string }

/** Mesma lógica de montarReciboLinhas() do agente, retornando linhas tipadas. */
function montarReciboLinhasPreview(pedido: PreviewPedido, config: ConfigImpressao, lojaNome: string, temLogoImagem: boolean): ReciboLinha[] {
  const L: ReciboLinha[] = []
  if (config.imprimirLogo && lojaNome && !temLogoImagem) L.push({ t: 'N', s: lojaNome.toUpperCase() })

  L.push({ t: 'H', s: `PEDIDO #${pedido.numero}` })
  L.push({ t: 'C', s: pedido.tipo === 'entrega' ? 'ENTREGA' : 'RETIRADA' })
  if (pedido.origem === 'pdv') L.push({ t: 'C', s: pedido.mesa ? `MESA ${pedido.mesa}` : 'BALCAO (PDV)' })
  if (pedido.criadoEm) {
    const dt = new Date(pedido.criadoEm)
    if (!isNaN(dt.getTime())) {
      L.push({ t: 'C', s: dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' -') })
    }
  }

  const totalUnidades = pedido.itens.reduce((s, i) => s + (i.quantidade || 1), 0)
  L.push({ t: 'H', s: `ITENS (${totalUnidades})` })
  pedido.itens.forEach((item, idx) => {
    const baseNome = config.mostrarNumeroItem ? `${item.quantidade}x ${item.nome}` : item.nome
    const variacao = [item.tamanhoNome, item.saborNome].filter(Boolean).join(' - ')
    const nome = variacao ? `${baseNome} (${variacao})` : baseNome
    L.push({ t: 'I', nome, preco: brlR(item.precoUnitario * item.quantidade) })
    if (item.bordaNome) L.push({ t: 'S', s: `+ Borda: ${item.bordaNome}` })
    if (item.massaNome) L.push({ t: 'S', s: `+ Massa: ${item.massaNome}` })
    if (config.mostrarNomeComplementos) {
      // Espelha o agente: complementos repetidos agrupados como "2x Nome".
      const agrupados = new Map<string, { nome: string; preco: number; qtd: number }>()
      for (const comp of item.complementos) {
        const cur = agrupados.get(comp.nome) ?? { nome: comp.nome, preco: comp.preco, qtd: 0 }
        cur.qtd += 1
        agrupados.set(comp.nome, cur)
      }
      for (const comp of agrupados.values()) {
        const precoComp = comp.preco * comp.qtd * (config.multiplicarOpcoesQtd ? item.quantidade : 1)
        const precoTxt = config.mostrarPrecoComplementos && precoComp > 0 ? ` (+${brlR(precoComp)})` : ''
        L.push({ t: 'S', s: `+ ${comp.qtd > 1 ? `${comp.qtd}x ` : ''}${comp.nome}${precoTxt}` })
      }
    }
    if (item.observacao) L.push({ t: 'S', s: `Obs: ${item.observacao}` })
    if (idx < pedido.itens.length - 1) L.push({ t: 'R' })
  })

  L.push({ t: 'H', s: 'PAGAMENTO' })
  L.push({ t: 'P', k: 'Subtotal', v: brlR(pedido.subtotal) })
  if (pedido.tipo === 'entrega') L.push({ t: 'P', k: 'Taxa de entrega', v: brlR(pedido.taxaEntrega) })
  L.push({ t: 'T', k: 'TOTAL', v: brlR(pedido.total) })
  L.push({ t: 'L', s: `Pagamento: ${pedido.formaPagamento.toUpperCase()}` })
  if (typeof pedido.pago === 'boolean') L.push({ t: 'L', s: pedido.pago ? 'Status: PAGO' : 'Status: A RECEBER' })
  if (pedido.formaPagamento === 'dinheiro' && pedido.trocoPara) L.push({ t: 'L', s: `Troco para: ${brlR(pedido.trocoPara)}` })
  if (pedido.observacao) L.push({ t: 'L', s: `Obs. do pedido: ${pedido.observacao}` })

  if (pedido.clienteNome || pedido.clienteTelefone || pedido.tipo === 'entrega') {
    L.push({ t: 'H', s: 'CLIENTE' })
    if (pedido.clienteNome) L.push({ t: 'L', s: `Cliente: ${pedido.clienteNome}` })
    if (pedido.clienteTelefone) L.push({ t: 'L', s: `Tel.: ${pedido.clienteTelefone}` })
    if (pedido.tipo === 'entrega') {
      L.push({ t: 'L', s: `End.: ${pedido.enderecoRua}, ${pedido.enderecoNumero}` })
      if (pedido.enderecoComplemento) L.push({ t: 'L', s: `Compl.: ${pedido.enderecoComplemento}` })
      if (pedido.enderecoBairro) L.push({ t: 'L', s: `Bairro: ${pedido.enderecoBairro}` })
      if (pedido.enderecoCep) L.push({ t: 'L', s: `CEP: ${pedido.enderecoCep}` })
    }
  }

  L.push({ t: 'F', s: 'feito por Menuzia.com.br' })
  return L
}

export function ReciboPreview({ config, nomeLoja, logoUrl }: { config: ConfigImpressao; nomeLoja: string; logoUrl: string | null; cols: number }) {
  const temLogoImagem = Boolean(config.imprimirLogo && logoUrl)
  const linhas = useMemo(
    () => montarReciboLinhasPreview(PEDIDO_PREVIEW_RECIBO, config, nomeLoja, temLogoImagem),
    [config, nomeLoja, temLogoImagem],
  )

  return (
    <div className="sticky top-0">
      <h3 className="mb-2 text-[13px] font-bold text-text-main">Como vai ficar o recibo</h3>
      <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
        Prévia <b>fiel</b> do que o agente imprime — mesmas seções, barras, negrito e rodapé. Atualiza ao vivo.
      </p>
      <div className="rounded-menuzia border border-border bg-[#F3F4F6] p-4">
        <div className="mx-auto w-[300px] max-w-full rounded bg-white px-3 py-3 shadow-sm font-sans text-text-main">
          {temLogoImagem && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl!} alt="Logo da loja" className="mx-auto mb-1 block w-[55%] object-contain" />
          )}
          {linhas.map((l, i) => {
            switch (l.t) {
              case 'N': return <div key={i} className="mb-1 text-center text-[18px] font-extrabold leading-tight">{l.s}</div>
              case 'H': return <div key={i} className="my-1 bg-black py-[3px] text-center text-[13px] font-bold uppercase tracking-wide text-white">{l.s}</div>
              case 'C': return <div key={i} className="text-center text-[14px] font-bold">{l.s}</div>
              case 'I': return <div key={i} className={['mt-1.5 flex justify-between gap-2 font-bold leading-tight', config.fonteMaiorProducao ? 'text-[19px]' : 'text-[15px]'].join(' ')}><span>{l.nome}</span><span className="whitespace-nowrap">{l.preco}</span></div>
              case 'S': return <div key={i} className={['mb-0.5 pl-3 leading-snug', config.fonteMaiorProducao ? 'text-[15px] font-semibold text-text-main' : 'text-[13px] text-text-subtle'].join(' ')}>{l.s}</div>
              case 'P': return <div key={i} className="mb-0.5 flex justify-between text-[13px]"><span>{l.k}</span><span>{l.v}</span></div>
              case 'T': return <div key={i} className="mt-1 flex items-end justify-between border-t border-black pt-1 text-[22px] font-extrabold leading-none"><span>{l.k}</span><span>{l.v}</span></div>
              case 'L': return <div key={i} className="mb-0.5 text-[13px] leading-snug">{l.s}</div>
              case 'R': return <div key={i} className="my-1 border-t border-dotted border-black/60" />
              case 'F': return <div key={i} className="mt-3 text-center text-[10px] text-text-subtle">{l.s}</div>
            }
          })}
        </div>
      </div>
    </div>
  )
}
