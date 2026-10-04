'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { formatarCentavos, paraCentavos } from '@/lib/financeiro/centavos'
import { FORMAS_CONTA, ROTULO_FORMA_CONTA, type FormaConta } from '@/lib/financeiro/contas-regras'
import { AprovacaoPin, Janela, type AprovacaoDada, type PedidoRemoto } from '../apoio'
import { BOTAO, PainelLateral, Selo } from '../ui/blocos'
import type { Fornecedor } from './secao-contas'

/**
 * Compras de insumos (Fase 5b): nota com itens. Ao salvar, o servidor atualiza o custo de cada insumo (com
 * histórico), o que recalcula o CMV dos produtos, e gera a conta a pagar, a conta já paga pela empresa ou a
 * saída do caixa do turno.
 */
export interface InsumoLeve { id: string; nome: string; unidade_compra: string; unidade_base: string }
interface Compra {
  id: string; numero_nota: string | null; data_compra: string; total_centavos: number; pagamento: 'a_prazo' | 'caixa' | 'empresa'; status: 'ativa' | 'cancelada'
  criado_por_nome: string; fin_fornecedores: { nome: string } | null
  fin_compra_itens: { quantidade: number; unidade: string; valor_centavos: number; custo_anterior_centavos: number | null; custo_novo_centavos: number; cmv_insumos: { nome: string } | null }[]
}
type Toast = (tom: 'ok' | 'erro', t: string) => void
const CAMPO = 'h-[40px] w-full rounded-[3px] border border-border bg-white px-2.5 text-[14px] outline-none focus:border-primary'
const ROT = 'mb-[4px] block text-[11px] font-bold uppercase tracking-wide text-text-subtle'
const ROT_PAG: Record<Compra['pagamento'], string> = { a_prazo: 'A prazo (conta a pagar)', caixa: 'Dinheiro do caixa', empresa: 'Paga pela empresa' }
const brl = (c: number | null | undefined) => (c == null ? '—' : formatarCentavos(c))

export function SecaoCompras({ insumos, fornecedores, podeLancar, podePagar, podeVerCusto, caixaAberto, toast, onMudou }: {
  insumos: InsumoLeve[]; fornecedores: Fornecedor[]; podeLancar: boolean; podePagar: boolean; podeVerCusto: boolean; caixaAberto: boolean; toast: Toast; onMudou: () => void
}) {
  const [compras, setCompras] = useState<Compra[] | null>(null)
  const [nova, setNova] = useState(false)
  const [cancelando, setCancelando] = useState<Compra | null>(null)
  const [motivo, setMotivo] = useState('')
  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/financeiro/contas/compras', { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    setCompras(r.ok ? j.compras ?? [] : [])
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  async function cancelar(c: Compra) {
    const r = await fetch('/api/admin/financeiro/contas/compras', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, motivo }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast('erro', j.error ?? 'Não foi possível.'); return }
    setCancelando(null); setMotivo('')
    toast('ok', 'Compra cancelada. O custo do insumo não volta sozinho: ajuste em Insumos, se precisar.'); void carregar(); onMudou()
  }

  return (
    <div className="flex flex-col gap-3" data-testid="secao-compras">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12.5px] text-text-subtle">Cada compra atualiza o custo dos insumos (com histórico) e o CMV dos produtos que usam esses insumos.</p>
        {podeLancar && <button type="button" className={`${BOTAO.primario} ml-auto`} onClick={() => setNova(true)} data-testid="compra-nova"><Plus className="h-4 w-4" /> Nova compra</button>}
      </div>
      {compras === null ? <p className="text-[13px] text-text-subtle">Carregando…</p> : compras.length === 0 ? (
        <p className="rounded-[6px] border border-border bg-white px-4 py-8 text-center text-[13px] text-text-subtle">Nenhuma compra lançada.</p>
      ) : (
        <div className="flex flex-col gap-2" data-testid="compras-lista">
          {compras.map((c) => (
            <div key={c.id} className="rounded-[6px] border border-border bg-white p-3" data-testid="compra-linha" data-nota={c.numero_nota ?? ''}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  <b className="block text-[14px]">{c.numero_nota ? `Nota ${c.numero_nota}` : 'Compra sem nota'}{c.fin_fornecedores?.nome ? ` · ${c.fin_fornecedores.nome}` : ''}</b>
                  <span className="block text-[12px] text-text-subtle">{c.data_compra.split('-').reverse().join('/')} · {ROT_PAG[c.pagamento]} · por {c.criado_por_nome}</span>
                </span>
                <span className="flex items-center gap-2">
                  {c.status === 'cancelada' ? <Selo cor="#4B5563">Cancelada</Selo> : null}
                  <b className="text-[15px]">{brl(c.total_centavos)}</b>
                </span>
              </div>
              <ul className="mt-2 grid gap-0.5 text-[12.5px] text-text-subtle">
                {c.fin_compra_itens.map((i, k) => (
                  <li key={k}>{Number(i.quantidade).toLocaleString('pt-BR')} {i.unidade} de <b className="text-text-main">{i.cmv_insumos?.nome ?? '—'}</b> — {brl(i.valor_centavos)}
                    {podeVerCusto && i.custo_anterior_centavos !== i.custo_novo_centavos ? <> · custo {brl(i.custo_anterior_centavos)} → <b className="text-text-main">{brl(i.custo_novo_centavos)}</b></> : null}</li>
                ))}
              </ul>
              {c.status === 'ativa' && c.pagamento !== 'caixa' && podeLancar && (
                <button type="button" className="mt-2 text-[11.5px] font-semibold uppercase tracking-wide text-[#B91C1C]" onClick={() => setCancelando(c)} data-testid="compra-cancelar">Cancelar compra</button>
              )}
            </div>
          ))}
        </div>
      )}
      {cancelando && (
        <Janela titulo="Cancelar compra" onFechar={() => setCancelando(null)} testid="janela-cancelar-compra">
          <p className="mb-2 text-[13px]">A conta a pagar desta compra é cancelada junto. O custo dos insumos NÃO volta sozinho.</p>
          <textarea className={`${CAMPO} h-[60px] py-2`} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" data-testid="compra-cancelar-motivo" />
          <button type="button" className="mt-3 h-[38px] w-full rounded-[4px] bg-[#B91C1C] text-[12px] font-semibold uppercase tracking-wide text-white disabled:opacity-50" disabled={motivo.trim().length < 5} onClick={() => void cancelar(cancelando)} data-testid="compra-cancelar-confirmar">Cancelar compra</button>
        </Janela>
      )}
      {nova && <NovaCompra insumos={insumos} fornecedores={fornecedores.filter((f) => f.ativo)} podePagar={podePagar} caixaAberto={caixaAberto} toast={toast}
        onFechar={() => setNova(false)} onSalvou={() => { setNova(false); void carregar(); onMudou() }} />}
    </div>
  )
}

function NovaCompra({ insumos, fornecedores, podePagar, caixaAberto, toast, onFechar, onSalvou }: {
  insumos: InsumoLeve[]; fornecedores: Fornecedor[]; podePagar: boolean; caixaAberto: boolean; toast: Toast; onFechar: () => void; onSalvou: () => void
}) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const [fornecedorId, setFornecedorId] = useState('')
  const [nota, setNota] = useState('')
  const [data, setData] = useState(hoje)
  const [pagamento, setPagamento] = useState<'a_prazo' | 'caixa' | 'empresa'>('a_prazo')
  const [vencimento, setVencimento] = useState(hoje)
  const [forma, setForma] = useState<FormaConta>('boleto')
  const [itens, setItens] = useState<{ insumoId: string; quantidade: string; unidade: string; valor: string }[]>([{ insumoId: '', quantidade: '', unidade: '', valor: '' }])
  const [salvando, setSalvando] = useState(false)
  const [pin, setPin] = useState<{ erro: string | null; remoto?: PedidoRemoto | null } | null>(null)
  const [ch] = useState(() => `ui-${crypto.randomUUID()}`)
  const mapa = new Map(insumos.map((i) => [i.id, i]))
  const total = itens.reduce((s, i) => s + (paraCentavos(i.valor) ?? 0), 0)

  async function salvar(aprovacao?: AprovacaoDada) {
    setSalvando(true)
    try {
      const corpo = {
        fornecedorId: fornecedorId || null, numeroNota: nota, dataCompra: data, pagamento, vencimento, forma, chave: ch, aprovacao,
        itens: itens.filter((i) => i.insumoId).map((i) => ({ insumoId: i.insumoId, quantidade: Number(i.quantidade.replace(',', '.')), unidade: i.unidade, valorCentavos: paraCentavos(i.valor) })),
      }
      const r = await fetch('/api/admin/financeiro/contas/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      const j = await r.json().catch(() => ({}))
      if (r.ok) { toast('ok', `Compra registrada. ${j.insumosAtualizados ?? 0} insumo(s) com custo atualizado.`); onSalvou(); return }
      if (j.codigo === 'aprovacao_necessaria' || (pin && r.status !== 400)) { setPin({ erro: aprovacao ? j.error ?? null : null, remoto: (j.pedidoRemoto as PedidoRemoto) ?? pin?.remoto ?? null }); return }
      toast('erro', j.error ?? 'Não foi possível registrar.')
    } finally { setSalvando(false) }
  }

  return (
    <PainelLateral titulo="Nova compra de insumos" subtitulo={`Total ${brl(total)}`} onFechar={onFechar} largura={720} testid="form-compra"
      acoes={<button type="button" className={BOTAO.primario} disabled={salvando || total <= 0} onClick={() => void salvar()} data-testid="compra-salvar">{salvando ? 'Salvando…' : 'Registrar compra'}</button>}>
      <div className="grid gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label><span className={ROT}>Fornecedor</span>
            <select className={CAMPO} value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)} data-testid="compra-fornecedor"><option value="">—</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>
          </label>
          <label><span className={ROT}>Nº da nota</span><input className={CAMPO} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={40} data-testid="compra-nota" /></label>
          <label><span className={ROT}>Data da compra</span><input type="date" className={CAMPO} value={data} onChange={(e) => setData(e.target.value)} /></label>
        </div>
        <div>
          <span className={ROT}>Itens</span>
          <div className="flex flex-col gap-2">
            {itens.map((i, k) => {
              const ins = mapa.get(i.insumoId)
              const mudar = (p: Partial<typeof i>) => setItens(itens.map((x, n) => (n === k ? { ...x, ...p } : x)))
              return (
                <div key={k} className="grid grid-cols-[1fr_80px_90px_110px_32px] items-center gap-1.5" data-testid="compra-item">
                  <select className={CAMPO} value={i.insumoId} onChange={(e) => { const x = mapa.get(e.target.value); mudar({ insumoId: e.target.value, unidade: x?.unidade_compra ?? '' }) }} data-testid="compra-insumo">
                    <option value="">Insumo…</option>{insumos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                  </select>
                  <input className={`${CAMPO} text-right`} inputMode="decimal" placeholder="Qtd" value={i.quantidade} onChange={(e) => mudar({ quantidade: e.target.value.replace(/[^\d.,]/g, '') })} data-testid="compra-qtd" />
                  <select className={CAMPO} value={i.unidade} onChange={(e) => mudar({ unidade: e.target.value })} disabled={!ins} data-testid="compra-unidade">
                    {ins ? [...new Set([ins.unidade_compra, ins.unidade_base])].map((u) => <option key={u} value={u}>{u}</option>) : <option value="">—</option>}
                  </select>
                  <input className={`${CAMPO} text-right`} inputMode="decimal" placeholder="Valor R$" value={i.valor} onChange={(e) => mudar({ valor: e.target.value.replace(/[^\d.,]/g, '') })} data-testid="compra-valor" />
                  <button type="button" aria-label="Tirar item" className="grid h-[32px] w-[32px] place-items-center rounded-[4px] text-[#B91C1C] hover:bg-[#FEE2E2]" onClick={() => setItens(itens.filter((_, n) => n !== k))}><Trash2 className="h-4 w-4" /></button>
                </div>
              )
            })}
          </div>
          <button type="button" className={`${BOTAO.neutro} mt-2`} onClick={() => setItens([...itens, { insumoId: '', quantidade: '', unidade: '', valor: '' }])} data-testid="compra-adicionar"><Plus className="h-4 w-4" /> Item</button>
          {insumos.length === 0 && <p className="mt-2 text-[12.5px] text-text-subtle">Nenhum insumo cadastrado. Cadastre em Precificação / CMV › Insumos.</p>}
        </div>
        <div>
          <span className={ROT}>Pagamento</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(['a_prazo', 'empresa', 'caixa'] as const).map((p) => {
              const bloqueado = (p !== 'a_prazo' && !podePagar) || (p === 'caixa' && !caixaAberto)
              return (
                <button key={p} type="button" disabled={bloqueado} aria-pressed={pagamento === p} onClick={() => setPagamento(p)} data-testid={`compra-pag-${p}`}
                  className={`rounded-[4px] border px-3 py-2 text-left text-[13px] font-semibold disabled:opacity-50 ${pagamento === p ? 'border-[#0369A1] bg-[#E0F2FE]' : 'border-border bg-white'}`}>
                  {ROT_PAG[p]}{p === 'caixa' && !caixaAberto ? <span className="block text-[11.5px] font-normal text-text-subtle">Caixa fechado</span> : null}
                </button>
              )
            })}
          </div>
        </div>
        {pagamento !== 'caixa' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pagamento === 'a_prazo' && <label><span className={ROT}>Vencimento</span><input type="date" className={CAMPO} value={vencimento} onChange={(e) => setVencimento(e.target.value)} data-testid="compra-vencimento" /></label>}
            <label><span className={ROT}>Forma</span>
              <select className={CAMPO} value={forma} onChange={(e) => setForma(e.target.value as FormaConta)}>{FORMAS_CONTA.filter((f) => f !== 'dinheiro').map((f) => <option key={f} value={f}>{ROTULO_FORMA_CONTA[f]}</option>)}</select>
            </label>
          </div>
        )}
        {pin && <AprovacaoPin titulo="Valor acima do limite: precisa da aprovação de um gerente" erro={pin.erro} remoto={pin.remoto} ocupado={salvando} onCancelar={() => setPin(null)} onConfirmar={(a) => void salvar(a)} />}
      </div>
    </PainelLateral>
  )
}
