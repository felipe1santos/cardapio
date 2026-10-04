'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Paperclip, Plus } from 'lucide-react'
import { CartaoNumero } from '@/components/admin/cartao-numero'
import { PilhaToasts, useToasts } from '@/components/admin/toasts'
import { ICONES } from '@/lib/icones-painel'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { FORMAS_CONTA, ROTULO_FORMA_CONTA, type FormaConta } from '@/lib/financeiro/contas-regras'
import { AprovacaoPin, CampoDinheiro, Janela, type AprovacaoDada, type PedidoRemoto } from '../apoio'
import { BOTAO, Chip, PainelLateral, Selo } from '../ui/blocos'
import { SecaoDre } from './dre'
import { SecaoCompras, type InsumoLeve } from './compras'
import { SecaoCadastros } from './cadastros'

/**
 * Financeiro › Contas e DRE (Fase 5b). Contas a pagar e a receber, compras de insumos, DRE e cadastros
 * (plano de contas e fornecedores). Quem decide é o servidor; a tela só esconde o que a pessoa não pode.
 * Nada se apaga: conta se cancela, baixa se estorna.
 */
export interface Categoria { id: string; nome: string; tipo: 'pagar' | 'receber'; grupo: 'despesa' | 'insumo' | 'receita' | 'fora'; padrao: boolean; ativo: boolean }
export interface Fornecedor { id: string; nome: string; documento: string | null; telefone: string | null; observacao: string | null; ativo: boolean }
interface Conta {
  id: string; tipo: 'pagar' | 'receber'; descricao: string; fornecedor_id: string | null; fornecedor: string | null; categoria_id: string; categoria: string
  valor_centavos: number; vencimento: string; forma_prevista: FormaConta | null; observacao: string | null; anexo_path: string | null; anexo_nome: string | null
  recorrencia: 'nenhuma' | 'mensal' | 'semanal'; serie_id: string | null; origem: string; status: 'a_pagar' | 'pago' | 'cancelado'; statusExibido: 'a_pagar' | 'pago' | 'cancelado' | 'vencido'
  pago_em: string | null; pago_carteira: 'gaveta' | 'empresa' | null; pago_forma: string | null; pago_por_nome: string | null; pago_aprovado_por_nome: string | null
  cancelado_motivo: string | null; criado_por_nome: string
}
interface Dados {
  contas: Conta[]; hoje: string; categorias: Categoria[]; fornecedores: Fornecedor[]; insumos: InsumoLeve[]
  resumo: { aPagarCentavos: number; vencidoCentavos: number; vencidas: number; aReceberCentavos: number; venceHojeCentavos: number }
  saldos: { caixaAberto: boolean; gavetaCentavos: number | null; empresaCentavos: number }
  pode: { lancar: boolean; pagar: boolean; dre: boolean; exportar: boolean; insumos: boolean }
}
type Aba = 'pagar' | 'receber' | 'compras' | 'dre' | 'cadastros'
type Situacao = 'abertas' | 'vencidas' | 'pagas' | 'canceladas' | 'todas'

const brl = (c: number | null | undefined) => (c === null || c === undefined ? '—' : formatarCentavos(c))
const dataBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')
const chave = () => `ui-${crypto.randomUUID()}`
const SELO: Record<Conta['statusExibido'], [string, string]> = {
  a_pagar: ['#0369A1', 'Em aberto'], vencido: ['#B91C1C', 'Vencida'], pago: ['#15803D', 'Paga'], cancelado: ['#4B5563', 'Cancelada'],
}
const rotuloStatus = (k: Conta) => (k.statusExibido === 'pago' ? (k.tipo === 'pagar' ? 'Paga' : 'Recebida') : SELO[k.statusExibido][1])

async function pedir(url: string, metodo: string, corpo?: unknown) {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, j: j as Record<string, unknown> & { error?: string; codigo?: string } }
}

export function SecaoContas() {
  const toasts = useToasts()
  const toast = toasts.mostrar
  const [aba, setAba] = useState<Aba>('pagar')
  const [situacao, setSituacao] = useState<Situacao>('abertas')
  const [busca, setBusca] = useState('')
  const [d, setD] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [form, setForm] = useState<{ conta: Conta | null; tipo: 'pagar' | 'receber' } | null>(null)
  const [baixa, setBaixa] = useState<Conta | null>(null)
  const [estorno, setEstorno] = useState<Conta | null>(null)
  const [cancelar, setCancelar] = useState<Conta | null>(null)

  const tipo = aba === 'receber' ? 'receber' : 'pagar'
  const carregar = useCallback(async () => {
    const q = new URLSearchParams({ tipo, situacao })
    const r = await pedir(`/api/admin/financeiro/contas?${q}`, 'GET')
    if (!r.ok) { setErro(r.j.error ?? 'Não foi possível abrir.'); return }
    setErro(null); setD(r.j as unknown as Dados)
  }, [tipo, situacao])
  useEffect(() => { void carregar() }, [carregar])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (d?.contas ?? []).filter((k) => !q || `${k.descricao} ${k.categoria} ${k.fornecedor ?? ''}`.toLowerCase().includes(q))
  }, [d, busca])

  async function exportar() {
    const r = await fetch(`/api/admin/financeiro/contas/exportar?tipo=${tipo}`, { cache: 'no-store' })
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast('erro', j.error ?? 'Não foi possível exportar.'); return }
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'contas.csv'; document.body.appendChild(a); a.click(); a.remove()
  }
  async function verAnexo(k: Conta) {
    const r = await pedir(`/api/admin/financeiro/contas/${k.id}`, 'GET')
    if (!r.ok) { toast('erro', r.j.error ?? 'Sem anexo.'); return }
    window.open(String(r.j.url), '_blank', 'noopener')
  }
  async function anexar(k: Conta, arquivo: File) {
    const r = await fetch(`/api/admin/financeiro/contas/${k.id}`, { method: 'POST', headers: { 'Content-Type': arquivo.type, 'x-nome': encodeURIComponent(arquivo.name) }, body: arquivo })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast('erro', j.error ?? 'Não foi possível anexar.'); return }
    toast('ok', 'Arquivo anexado.'); void carregar()
  }

  const abas: [Aba, string][] = [['pagar', 'A pagar'], ['receber', 'A receber'], ['compras', 'Compras de insumos'], ...(d?.pode.dre ? [['dre', 'DRE'] as [Aba, string]] : []), ['cadastros', 'Categorias e fornecedores']]
  const acoes = (k: Conta) => (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {k.status === 'a_pagar' && d?.pode.pagar && <button type="button" className="inline-flex h-[32px] items-center rounded-[4px] bg-[#15803D] px-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-white hover:brightness-110" onClick={() => setBaixa(k)} data-testid="conta-baixar">{k.tipo === 'pagar' ? 'Pagar' : 'Receber'}</button>}
      {k.status === 'pago' && d?.pode.pagar && <button type="button" className="inline-flex h-[32px] items-center rounded-[4px] border border-border bg-white px-2.5 text-[11.5px] font-semibold uppercase tracking-wide hover:bg-page" onClick={() => setEstorno(k)} data-testid="conta-estornar">Estornar</button>}
      {k.status === 'a_pagar' && d?.pode.lancar && <button type="button" className="inline-flex h-[32px] items-center rounded-[4px] border border-border bg-white px-2.5 text-[11.5px] font-semibold uppercase tracking-wide hover:bg-page" onClick={() => setForm({ conta: k, tipo: k.tipo })} data-testid="conta-editar">Editar</button>}
      {k.status === 'a_pagar' && d?.pode.lancar && <button type="button" className="inline-flex h-[32px] items-center rounded-[4px] px-2 text-[11.5px] font-semibold uppercase tracking-wide text-[#B91C1C] hover:bg-[#FEE2E2]" onClick={() => setCancelar(k)} data-testid="conta-cancelar">Cancelar</button>}
      {k.anexo_path ? <button type="button" aria-label="Ver anexo" title={k.anexo_nome ?? 'Anexo'} className="grid h-[32px] w-[32px] place-items-center rounded-[4px] text-[#0369A1] hover:bg-page" onClick={() => void verAnexo(k)} data-testid="conta-anexo"><Paperclip className="h-4 w-4" /></button>
        : d?.pode.lancar && k.status !== 'cancelado' && (
          <label className="grid h-[32px] w-[32px] cursor-pointer place-items-center rounded-[4px] text-text-subtle hover:bg-page" title="Anexar boleto ou nota">
            <Paperclip className="h-4 w-4" />
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" data-testid="conta-anexar" onChange={(e) => { const f = e.target.files?.[0]; if (f) void anexar(k, f); e.target.value = '' }} />
          </label>
        )}
    </span>
  )

  return (
    <div className="flex flex-col gap-3" data-testid="secao-contas">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]" role="tablist">
        {abas.map(([id, r]) => <Chip key={id} ativo={aba === id} onClick={() => setAba(id)} testid={`contas-aba-${id}`}>{r}</Chip>)}
      </div>
      {erro && <p role="alert" className="rounded-[4px] bg-[#FEE2E2] px-3 py-2 text-[13px] font-medium text-[#B91C1C]" data-testid="contas-erro">{erro}</p>}

      {(aba === 'pagar' || aba === 'receber') && d && (
        <>
          <div className="grid grid-cols-1 gap-2.5 min-[400px]:grid-cols-2 lg:grid-cols-4" data-testid="contas-resumo">
            {aba === 'pagar' ? (
              <>
                <CartaoNumero icone={ICONES.dinheiro} tom="azul" rotulo="A pagar em aberto" valor={<span data-testid="resumo-a-pagar">{brl(d.resumo.aPagarCentavos)}</span>} />
                <CartaoNumero icone={ICONES.aviso} tom="vermelho" rotulo={`Vencidas (${d.resumo.vencidas})`} valor={<span data-testid="resumo-vencido">{brl(d.resumo.vencidoCentavos)}</span>} />
                <CartaoNumero icone={ICONES.calendario} tom="ambar" rotulo="Vence hoje" valor={brl(d.resumo.venceHojeCentavos)} />
              </>
            ) : (
              <>
                <CartaoNumero icone={ICONES.dinheiro} tom="verde" rotulo="A receber em aberto" valor={<span data-testid="resumo-a-receber">{brl(d.resumo.aReceberCentavos)}</span>} />
                <CartaoNumero icone={ICONES.loja} tom="cinza" rotulo="Caixa (gaveta)" valor={d.saldos.caixaAberto ? brl(d.saldos.gavetaCentavos) : 'Fechado'} />
                <div className="hidden lg:block" />
              </>
            )}
            <CartaoNumero icone={ICONES.cartao} tom="roxo" rotulo="Conta da empresa (movimento)" valor={<span data-testid="resumo-empresa" title="Soma do que entrou e saiu pela conta da empresa DENTRO do sistema (sangrias, contas pagas e recebidas, fundo de troco). Não é o saldo do banco.">{brl(d.saldos.empresaCentavos)}</span>} />
          </div>
          {aba === 'receber' && (
            <p className="rounded-[4px] bg-[#E0F2FE] px-3 py-2 text-[12.5px] text-[#0369A1]" data-testid="aviso-vendas">
              As vendas do sistema (vitrine, PDV, mesas, entregas) já entram sozinhas no caixa. Aqui vão só entradas de fora: repasse do iFood, aporte do sócio, venda avulsa feita fora do sistema.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {([['abertas', 'Em aberto'], ['vencidas', 'Vencidas'], ['pagas', aba === 'pagar' ? 'Pagas' : 'Recebidas'], ['canceladas', 'Canceladas'], ['todas', 'Todas']] as [Situacao, string][]).map(([id, r]) => (
              <Chip key={id} ativo={situacao === id} onClick={() => setSituacao(id)} testid={`contas-situacao-${id}`}>{r}</Chip>
            ))}
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" className="h-[38px] w-full max-w-[220px] rounded-[4px] border border-border px-2.5 text-[13px]" data-testid="contas-busca" />
            <span className="ml-auto flex gap-2">
              {d.pode.exportar && <button type="button" className={BOTAO.neutro} onClick={() => void exportar()} data-testid="contas-csv"><Download className="h-4 w-4" /> CSV</button>}
              {d.pode.lancar && <button type="button" className={BOTAO.primario} onClick={() => setForm({ conta: null, tipo })} data-testid="conta-nova"><Plus className="h-4 w-4" /> {aba === 'pagar' ? 'Nova conta a pagar' : 'Nova entrada'}</button>}
            </span>
          </div>

          <div className="hidden overflow-hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white md:block">
            <div className="max-h-[calc(100dvh-380px)] min-h-[180px] overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-[13px]" data-testid="contas-tabela">
                <thead className="sticky top-0 z-[2] bg-[#F6F7F9] text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                  <tr className="[&>th]:border-b [&>th]:border-border">
                    <th className="px-3 py-2.5">Descrição</th><th className="px-3 py-2.5">Categoria</th><th className="px-3 py-2.5">Vencimento</th>
                    <th className="px-3 py-2.5 text-right">Valor</th><th className="px-3 py-2.5">Situação</th><th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {lista.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-text-subtle">Nenhuma conta aqui.</td></tr>}
                  {lista.map((k) => (
                    <tr key={k.id} className="align-middle [&>td]:border-b [&>td]:border-border hover:[&>td]:bg-[#F9FAFB]" data-testid="conta-linha" data-descricao={k.descricao} data-status={k.statusExibido}>
                      <td className="px-3 py-2">
                        <b className="block">{k.descricao}</b>
                        <span className="block text-[12px] text-text-subtle">
                          {[k.fornecedor, k.recorrencia !== 'nenhuma' ? (k.recorrencia === 'mensal' ? 'Todo mês' : 'Toda semana') : null, k.origem === 'compra' ? 'Compra de insumos' : null].filter(Boolean).join(' · ') || `Lançada por ${k.criado_por_nome}`}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-subtle">{k.categoria}</td>
                      <td className="whitespace-nowrap px-3 py-2">{dataBR(k.vencimento)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">{brl(k.valor_centavos)}</td>
                      <td className="px-3 py-2">
                        <Selo cor={SELO[k.statusExibido][0]} testid="conta-status">{rotuloStatus(k)}</Selo>
                        {k.status === 'pago' && <span className="mt-0.5 block text-[11.5px] text-text-subtle">{dataBR(k.pago_em)} · {k.pago_carteira === 'gaveta' ? 'caixa' : 'empresa'}{k.pago_aprovado_por_nome ? ` · aprov. ${k.pago_aprovado_por_nome}` : ''}</span>}
                        {k.status === 'cancelado' && k.cancelado_motivo && <span className="mt-0.5 block max-w-[220px] truncate text-[11.5px] text-text-subtle" title={k.cancelado_motivo}>{k.cancelado_motivo}</span>}
                      </td>
                      <td className="px-3 py-2">{acoes(k)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex flex-col gap-2 md:hidden" data-testid="contas-cartoes">
            {lista.length === 0 && <p className="rounded-[6px] border border-border bg-white px-4 py-8 text-center text-[13px] text-text-subtle">Nenhuma conta aqui.</p>}
            {lista.map((k) => (
              <div key={k.id} className="rounded-[6px] border border-border bg-white p-3" data-testid="conta-cartao" data-descricao={k.descricao}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0"><b className="block text-[14px]">{k.descricao}</b><span className="block text-[12px] text-text-subtle">{k.categoria}{k.fornecedor ? ` · ${k.fornecedor}` : ''}</span></span>
                  <b className="whitespace-nowrap text-[15px]">{brl(k.valor_centavos)}</b>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[12.5px] text-text-subtle"><Selo cor={SELO[k.statusExibido][0]}>{rotuloStatus(k)}</Selo> vence {dataBR(k.vencimento)}</span>
                </div>
                <div className="mt-2 border-t border-border pt-2">{acoes(k)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {aba === 'compras' && d && <SecaoCompras insumos={d.insumos} fornecedores={d.fornecedores} podeLancar={d.pode.lancar} podePagar={d.pode.pagar} podeVerCusto={d.pode.insumos} caixaAberto={d.saldos.caixaAberto} toast={toast} onMudou={carregar} />}
      {aba === 'dre' && d?.pode.dre && <SecaoDre />}
      {aba === 'cadastros' && d && <SecaoCadastros categorias={d.categorias} fornecedores={d.fornecedores} podeEditar={d.pode.lancar} toast={toast} onMudou={carregar} />}

      {form && d && <FormConta conta={form.conta} tipo={form.tipo} categorias={d.categorias.filter((c) => c.tipo === form.tipo && (c.ativo || c.id === form.conta?.categoria_id))} fornecedores={d.fornecedores.filter((f) => f.ativo || f.id === form.conta?.fornecedor_id)} onFechar={() => setForm(null)} onSalvou={() => { setForm(null); void carregar() }} toast={toast} />}
      {baixa && d && <BaixaConta conta={baixa} caixaAberto={d.saldos.caixaAberto} onFechar={() => setBaixa(null)} onFeito={() => { setBaixa(null); void carregar() }} toast={toast} />}
      {estorno && <EstornoConta conta={estorno} onFechar={() => setEstorno(null)} onFeito={() => { setEstorno(null); void carregar() }} toast={toast} />}
      {cancelar && <CancelarConta conta={cancelar} onFechar={() => setCancelar(null)} onFeito={() => { setCancelar(null); void carregar() }} toast={toast} />}
      <PilhaToasts itens={toasts.itens} />
    </div>
  )
}

type Toast = (tom: 'ok' | 'erro', t: string) => void
const CAMPO = 'h-[40px] w-full rounded-[3px] border border-border bg-white px-2.5 text-[14px] outline-none focus:border-primary'
const ROT = 'mb-[4px] block text-[11px] font-bold uppercase tracking-wide text-text-subtle'

function FormConta({ conta, tipo, categorias, fornecedores, onFechar, onSalvou, toast }: {
  conta: Conta | null; tipo: 'pagar' | 'receber'; categorias: Categoria[]; fornecedores: Fornecedor[]; onFechar: () => void; onSalvou: () => void; toast: Toast
}) {
  const [descricao, setDescricao] = useState(conta?.descricao ?? '')
  const [categoriaId, setCategoriaId] = useState(conta?.categoria_id ?? '')
  const [fornecedorId, setFornecedorId] = useState(conta?.fornecedor_id ?? '')
  const [valor, setValor] = useState(conta ? (conta.valor_centavos / 100).toFixed(2).replace('.', ',') : '')
  const [centavos, setCentavos] = useState<number | null>(conta?.valor_centavos ?? null)
  const [vencimento, setVencimento] = useState(conta?.vencimento ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }))
  const [forma, setForma] = useState<FormaConta | ''>(conta?.forma_prevista ?? '')
  const [recorrencia, setRecorrencia] = useState(conta?.recorrencia ?? 'nenhuma')
  const [observacao, setObservacao] = useState(conta?.observacao ?? '')
  const [salvando, setSalvando] = useState(false)
  const [suspeita, setSuspeita] = useState<{ pedidos: { numero: number; total: number }[]; mensagem: string } | null>(null)
  const [justificativa, setJustificativa] = useState('')
  const [pin, setPin] = useState<{ erro: string | null; remoto?: PedidoRemoto | null } | null>(null)
  const [ch] = useState(chave)

  async function salvar(aprovacao?: AprovacaoDada) {
    setSalvando(true)
    try {
      const corpo = { tipo, descricao, categoriaId, fornecedorId: fornecedorId || null, valorCentavos: centavos, vencimento, formaPrevista: forma || null, observacao, recorrencia, chave: ch,
        ...(suspeita && justificativa ? { liberarVenda: { justificativa, aprovacao } } : {}) }
      const r = conta ? await pedir(`/api/admin/financeiro/contas/${conta.id}`, 'PATCH', { ...corpo, acao: 'editar' }) : await pedir('/api/admin/financeiro/contas', 'POST', corpo)
      if (r.ok) { if (r.j.aviso) toast('erro', String(r.j.aviso)); else toast('ok', conta ? 'Conta atualizada.' : 'Conta lançada.'); onSalvou(); return }
      if (r.j.codigo === 'venda_duplicada') { setSuspeita({ pedidos: (r.j.pedidos as { numero: number; total: number }[]) ?? [], mensagem: r.j.error ?? '' }); return }
      if (r.j.codigo === 'aprovacao_necessaria') { setPin({ erro: aprovacao ? r.j.error ?? null : null, remoto: (r.j.pedidoRemoto as PedidoRemoto) ?? null }); return }
      if (pin) { setPin({ erro: r.j.error ?? 'Não foi possível.' }); return }
      toast('erro', r.j.error ?? 'Não foi possível salvar.')
    } finally { setSalvando(false) }
  }

  return (
    <PainelLateral titulo={conta ? 'Editar conta' : tipo === 'pagar' ? 'Nova conta a pagar' : 'Nova entrada (a receber)'} onFechar={onFechar} largura={560} testid="form-conta"
      acoes={<button type="button" className={BOTAO.primario} disabled={salvando || !descricao.trim() || !categoriaId || !centavos} onClick={() => void salvar()} data-testid="conta-salvar">{salvando ? 'Salvando…' : 'Salvar'}</button>}>
      <div className="grid gap-3">
        <label><span className={ROT}>Descrição</span><input className={CAMPO} value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={200} data-testid="conta-descricao" placeholder={tipo === 'pagar' ? 'Ex.: Aluguel de outubro' : 'Ex.: Repasse iFood semana 40'} /></label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label><span className={ROT}>Categoria</span>
            <select className={CAMPO} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} data-testid="conta-categoria">
              <option value="">Escolha…</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label><span className={ROT}>{tipo === 'pagar' ? 'Fornecedor' : 'De quem'} (opcional)</span>
            <select className={CAMPO} value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)} data-testid="conta-fornecedor">
              <option value="">—</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </label>
          <CampoDinheiro rotulo="Valor" valor={valor} onMudar={(t, c) => { setValor(t); setCentavos(c) }} testid="conta-valor" />
          <label><span className={ROT}>{tipo === 'pagar' ? 'Vencimento' : 'Data prevista'}</span><input type="date" className={CAMPO} value={vencimento} onChange={(e) => setVencimento(e.target.value)} data-testid="conta-vencimento" /></label>
          <label><span className={ROT}>Forma prevista</span>
            <select className={CAMPO} value={forma} onChange={(e) => setForma(e.target.value as FormaConta)} data-testid="conta-forma">
              <option value="">—</option>{FORMAS_CONTA.map((f) => <option key={f} value={f}>{ROTULO_FORMA_CONTA[f]}</option>)}
            </select>
          </label>
          {!conta && (
            <label><span className={ROT}>Repetir</span>
              <select className={CAMPO} value={recorrencia} onChange={(e) => setRecorrencia(e.target.value as Conta['recorrencia'])} data-testid="conta-recorrencia">
                <option value="nenhuma">Não repete</option><option value="mensal">Todo mês</option><option value="semanal">Toda semana</option>
              </select>
            </label>
          )}
        </div>
        <label><span className={ROT}>Observação</span><textarea className={`${CAMPO} h-[70px] py-2`} value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} /></label>
        {recorrencia !== 'nenhuma' && !conta && <p className="text-[12.5px] text-text-subtle">A próxima conta aparece sozinha com antecedência ({recorrencia === 'mensal' ? 'um mês' : 'uma semana'}). Para parar, cancele com “e as próximas”.</p>}
        {suspeita && (
          <div className="rounded-[4px] border border-[#B45309] bg-[#FEF3C7] p-3" data-testid="venda-duplicada">
            <p className="text-[13px] font-semibold text-[#92400E]">{suspeita.mensagem}</p>
            <p className="mt-1 text-[12.5px] text-[#92400E]">Se for mesmo uma venda feita FORA do sistema, explique abaixo. O lançamento fica registrado e o dono é avisado.</p>
            <textarea className={`${CAMPO} mt-2 h-[60px] py-2`} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Ex.: venda no evento da praça, pago em dinheiro" data-testid="venda-justificativa" />
            <button type="button" className={`${BOTAO.neutro} mt-2`} disabled={justificativa.trim().length < 10 || salvando} onClick={() => void salvar()} data-testid="venda-lancar-mesmo-assim">Lançar mesmo assim</button>
          </div>
        )}
        {pin && <AprovacaoPin titulo="Precisa da aprovação de um gerente" erro={pin.erro} remoto={pin.remoto} ocupado={salvando} onCancelar={() => setPin(null)} onConfirmar={(a) => void salvar(a)} />}
      </div>
    </PainelLateral>
  )
}

function BaixaConta({ conta, caixaAberto, onFechar, onFeito, toast }: { conta: Conta; caixaAberto: boolean; onFechar: () => void; onFeito: () => void; toast: Toast }) {
  const [carteira, setCarteira] = useState<'gaveta' | 'empresa'>('empresa')
  const [forma, setForma] = useState<FormaConta>(conta.forma_prevista && conta.forma_prevista !== 'dinheiro' ? conta.forma_prevista : 'pix')
  const [ocupado, setOcupado] = useState(false)
  const [pin, setPin] = useState<{ erro: string | null; remoto?: PedidoRemoto | null } | null>(null)
  const pagar = conta.tipo === 'pagar'
  async function confirmar(aprovacao?: AprovacaoDada) {
    setOcupado(true)
    try {
      const r = await pedir(`/api/admin/financeiro/contas/${conta.id}`, 'PATCH', { acao: 'baixar', carteira, forma: carteira === 'gaveta' ? 'dinheiro' : forma, aprovacao })
      if (r.ok) { toast('ok', pagar ? 'Conta paga.' : 'Entrada recebida.'); onFeito(); return }
      if (r.j.codigo === 'aprovacao_necessaria' || (pin && ['pin_errado', 'pin_bloqueado', 'propria', 'sem_permissao', 'sem_pin'].includes(String(r.j.codigo)))) { setPin({ erro: aprovacao ? r.j.error ?? null : null, remoto: (r.j.pedidoRemoto as PedidoRemoto) ?? null }); return }
      toast('erro', r.j.error ?? 'Não foi possível.')
    } finally { setOcupado(false) }
  }
  return (
    <Janela titulo={pagar ? 'Pagar conta' : 'Receber'} onFechar={onFechar} testid="janela-baixa">
      <p className="text-[13px]"><b>{conta.descricao}</b></p>
      <p className="mb-3 text-[22px] font-bold" data-testid="baixa-valor">{brl(conta.valor_centavos)}</p>
      <span className={ROT}>{pagar ? 'De onde sai o dinheiro' : 'Para onde vai o dinheiro'}</span>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {([['empresa', 'Conta da empresa', 'Pix, boleto, cartão da empresa'], ['gaveta', 'Dinheiro do caixa', caixaAberto ? 'Vira movimentação do turno' : 'Caixa fechado']] as const).map(([id, t, s]) => (
          <button key={id} type="button" disabled={id === 'gaveta' && !caixaAberto} onClick={() => setCarteira(id)} aria-pressed={carteira === id} data-testid={`baixa-${id}`}
            className={`rounded-[4px] border px-3 py-2 text-left disabled:opacity-50 ${carteira === id ? 'border-[#0369A1] bg-[#E0F2FE]' : 'border-border bg-white'}`}>
            <b className="block text-[13px]">{t}</b><span className="block text-[11.5px] text-text-subtle">{s}</span>
          </button>
        ))}
      </div>
      {carteira === 'empresa' && (
        <label className="mb-3 block"><span className={ROT}>Forma</span>
          <select className={CAMPO} value={forma} onChange={(e) => setForma(e.target.value as FormaConta)} data-testid="baixa-forma">
            {FORMAS_CONTA.filter((f) => f !== 'dinheiro').map((f) => <option key={f} value={f}>{ROTULO_FORMA_CONTA[f]}</option>)}
          </select>
        </label>
      )}
      {pin ? <AprovacaoPin titulo="Valor acima do limite: precisa da aprovação de um gerente" erro={pin.erro} remoto={pin.remoto} ocupado={ocupado} onCancelar={() => setPin(null)} onConfirmar={(a) => void confirmar(a)} />
        : <button type="button" className={`${BOTAO.primario} w-full`} disabled={ocupado} onClick={() => void confirmar()} data-testid="baixa-confirmar">{ocupado ? 'Registrando…' : pagar ? 'Confirmar pagamento' : 'Confirmar recebimento'}</button>}
    </Janela>
  )
}

function EstornoConta({ conta, onFechar, onFeito, toast }: { conta: Conta; onFechar: () => void; onFeito: () => void; toast: Toast }) {
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [pin, setPin] = useState<{ erro: string | null; remoto?: PedidoRemoto | null } | null>(null)
  async function confirmar(aprovacao?: AprovacaoDada) {
    setOcupado(true)
    try {
      const r = await pedir(`/api/admin/financeiro/contas/${conta.id}`, 'PATCH', { acao: 'estornar', motivo, aprovacao })
      if (r.ok) { toast('ok', 'Baixa estornada: a conta voltou para em aberto.'); onFeito(); return }
      if (r.j.codigo === 'aprovacao_necessaria' || (pin && r.status !== 400)) { setPin({ erro: aprovacao ? r.j.error ?? null : null, remoto: (r.j.pedidoRemoto as PedidoRemoto) ?? pin?.remoto ?? null }); return }
      toast('erro', r.j.error ?? 'Não foi possível.')
    } finally { setOcupado(false) }
  }
  return (
    <Janela titulo="Estornar baixa" onFechar={onFechar} testid="janela-estorno">
      <p className="mb-2 text-[13px]">O dinheiro volta para {conta.pago_carteira === 'gaveta' ? 'a gaveta do caixa aberto' : 'a conta da empresa'} e “{conta.descricao}” ({brl(conta.valor_centavos)}) volta para em aberto. O dono é avisado.</p>
      <textarea className={`${CAMPO} h-[70px] py-2`} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (mínimo 10 letras)" data-testid="estorno-motivo" />
      {pin ? <div className="mt-3"><AprovacaoPin titulo="Estorno precisa da aprovação de um gerente" erro={pin.erro} remoto={pin.remoto} ocupado={ocupado} onCancelar={() => setPin(null)} onConfirmar={(a) => void confirmar(a)} /></div>
        : <button type="button" className={`${BOTAO.primario} mt-3 w-full`} disabled={ocupado || motivo.trim().length < 10} onClick={() => void confirmar()} data-testid="estorno-confirmar">Estornar</button>}
    </Janela>
  )
}

function CancelarConta({ conta, onFechar, onFeito, toast }: { conta: Conta; onFechar: () => void; onFeito: () => void; toast: Toast }) {
  const [motivo, setMotivo] = useState('')
  const [serie, setSerie] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  async function confirmar() {
    setOcupado(true)
    try {
      const r = await pedir(`/api/admin/financeiro/contas/${conta.id}`, 'PATCH', { acao: 'cancelar', motivo, serie })
      if (r.ok) { toast('ok', 'Conta cancelada.'); onFeito(); return }
      toast('erro', r.j.error ?? 'Não foi possível.')
    } finally { setOcupado(false) }
  }
  return (
    <Janela titulo="Cancelar conta" onFechar={onFechar} testid="janela-cancelar">
      <p className="mb-2 text-[13px]">“{conta.descricao}” ({brl(conta.valor_centavos)}) fica como cancelada — não some do histórico.</p>
      <textarea className={`${CAMPO} h-[60px] py-2`} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" data-testid="cancelar-motivo" />
      {conta.serie_id && (
        <label className="mt-2 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={serie} onChange={(e) => setSerie(e.target.checked)} data-testid="cancelar-serie" /> e as próximas (parar de repetir)</label>
      )}
      <button type="button" className="mt-3 h-[38px] w-full rounded-[4px] bg-[#B91C1C] text-[12px] font-semibold uppercase tracking-wide text-white hover:brightness-110 disabled:opacity-50" disabled={ocupado || motivo.trim().length < 5} onClick={() => void confirmar()} data-testid="cancelar-confirmar">Cancelar conta</button>
    </Janela>
  )
}
