'use client'

import { useEffect, useState } from 'react'
import { Download, FileSpreadsheet, Megaphone } from 'lucide-react'
import { diaSP } from '@/lib/clientes-csv'
import { BTN, ModalCsv, baixarArquivo } from './csv-comum'

/**
 * Exportar clientes: período (atalhos ou personalizado), base do período (última compra ou
 * cadastro), filtros, prévia da contagem e dois formatos. O arquivo é gerado no servidor
 * (que confere a permissão e registra na auditoria).
 */
type Atalho = '7' | '30' | '90' | 'mes' | 'todos' | 'personalizado'
const ATALHOS: { id: Atalho; rotulo: string }[] = [
  { id: '7', rotulo: 'Últimos 7 dias' }, { id: '30', rotulo: 'Últimos 30 dias' }, { id: '90', rotulo: 'Últimos 90 dias' },
  { id: 'mes', rotulo: 'Este mês' }, { id: 'todos', rotulo: 'Todos' }, { id: 'personalizado', rotulo: 'Personalizado' },
]

function periodoDoAtalho(a: Atalho, de: string, ate: string): { de: string | null; ate: string | null } {
  const hoje = diaSP(new Date().toISOString())
  const menos = (n: number) => diaSP(new Date(Date.now() - n * 86_400_000).toISOString())
  if (a === 'todos') return { de: null, ate: null }
  if (a === 'mes') return { de: `${hoje.slice(0, 8)}01`, ate: hoje }
  if (a === 'personalizado') return { de: de || null, ate: ate || null }
  return { de: menos(Number(a) - 1), ate: hoje }
}

export function ModalExportar({ onFechar, onToast }: { onFechar: () => void; onToast: (tom: 'ok' | 'erro', t: string) => void }) {
  const [atalho, setAtalho] = useState<Atalho>('30')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [base, setBase] = useState<'compra' | 'cadastro'>('compra')
  const [recorrentes, setRecorrentes] = useState(false)
  const [umaVez, setUmaVez] = useState(false)
  const [comTelefone, setComTelefone] = useState(false)
  const [formato, setFormato] = useState<'completa' | 'meta'>('completa')
  const [quantidade, setQuantidade] = useState<number | null>(null)
  const [contando, setContando] = useState(false)
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const periodo = periodoDoAtalho(atalho, de, ate)
  const filtro = { ...periodo, base, recorrentes, umaVez, comTelefone }
  const chaveFiltro = JSON.stringify(filtro)
  const personalizadoInvalido = atalho === 'personalizado' && (!de || !ate || de > ate)

  useEffect(() => {
    if (personalizadoInvalido) { setQuantidade(null); return }
    let vivo = true
    setContando(true)
    const t = setTimeout(async () => {
      const r = await fetch('/api/admin/clientes/exportar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filtro: JSON.parse(chaveFiltro), previa: true }) })
      const j = await r.json().catch(() => null)
      if (!vivo) return
      setContando(false)
      if (!r.ok) { setErro(j?.error ?? 'Não foi possível contar.'); setQuantidade(null) } else { setErro(null); setQuantidade(j.quantidade) }
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [chaveFiltro, personalizadoInvalido])

  async function exportar() {
    setBaixando(true)
    const r = await fetch('/api/admin/clientes/exportar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filtro, formato }) })
    setBaixando(false)
    if (!r.ok) { const j = await r.json().catch(() => null); onToast('erro', j?.error ?? 'Não foi possível exportar.'); return }
    const nome = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'clientes.csv'
    baixarArquivo(await r.blob(), nome)
    onToast('ok', `${Number(r.headers.get('X-Quantidade') ?? 0).toLocaleString('pt-BR')} clientes exportados.`)
    onFechar()
  }

  const Chip = ({ id, rotulo }: { id: Atalho; rotulo: string }) => (
    <button type="button" onClick={() => setAtalho(id)} aria-pressed={atalho === id} data-testid={`periodo-${id}`}
      className={`h-9 rounded-[5px] border px-3 text-[12.5px] font-semibold transition-colors ${atalho === id ? 'border-[#0688d4] bg-[#eef6fc] text-[#0570ae]' : 'border-[#d6dae1] bg-white text-[#374151] hover:border-[#0688d4]'}`}>{rotulo}</button>
  )
  const Caixa = ({ marcado, onChange, children, testid }: { marcado: boolean; onChange: (v: boolean) => void; children: React.ReactNode; testid: string }) => (
    <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-[#1f2937]">
      <input type="checkbox" className="h-4 w-4 accent-[#0688d4]" checked={marcado} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />{children}
    </label>
  )

  return (
    <ModalCsv titulo="Exportar clientes" subtitulo="Baixe a base de clientes em CSV." onFechar={onFechar} testid="modal-exportar"
      rodape={<>
        <span className="mr-auto text-[13px] text-[#374151]" data-testid="exportar-previa">
          {personalizadoInvalido ? 'Escolha a data inicial e a final.' : contando || quantidade === null ? 'Contando…' : <><b>{quantidade.toLocaleString('pt-BR')}</b> {quantidade === 1 ? 'cliente será exportado' : 'clientes serão exportados'}</>}
        </span>
        <button type="button" className={BTN.sec} onClick={onFechar}>Cancelar</button>
        <button type="button" className={BTN.pri} disabled={baixando || contando || !quantidade || personalizadoInvalido} onClick={() => void exportar()} data-testid="exportar-confirmar">
          <Download className="h-4 w-4" /> {baixando ? 'Gerando…' : 'Exportar'}
        </button>
      </>}>
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.05em] text-[#5b6472]">Período</h3>
          <div className="flex flex-wrap gap-1.5">{ATALHOS.map((a) => <Chip key={a.id} {...a} />)}</div>
          {atalho === 'personalizado' && (
            <div className="mt-3 grid max-w-[360px] grid-cols-2 gap-2">
              <label className="text-[11.5px] font-semibold text-[#5b6472]">Data inicial<input type="date" className="campanha-data mt-1 w-full" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} data-testid="exportar-de" /></label>
              <label className="text-[11.5px] font-semibold text-[#5b6472]">Data final<input type="date" className="campanha-data mt-1 w-full" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} data-testid="exportar-ate" /></label>
            </div>
          )}
          {atalho !== 'todos' && (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] text-[#1f2937]">
              <span className="text-[12.5px] text-[#6b7280]">Filtrar por:</span>
              {([['compra', 'Última compra no período'], ['cadastro', 'Cadastrados no período']] as const).map(([v, r]) => (
                <label key={v} className="flex cursor-pointer items-center gap-2"><input type="radio" name="base" className="h-4 w-4 accent-[#0688d4]" checked={base === v} onChange={() => setBase(v)} data-testid={`exportar-base-${v}`} />{r}</label>
              ))}
            </div>
          )}
        </section>
        <section>
          <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.05em] text-[#5b6472]">Filtros (opcionais)</h3>
          <div className="flex flex-col gap-2">
            <Caixa marcado={recorrentes} onChange={(v) => { setRecorrentes(v); if (v) setUmaVez(false) }} testid="exportar-recorrentes">Somente recorrentes (2+ pedidos)</Caixa>
            <Caixa marcado={umaVez} onChange={(v) => { setUmaVez(v); if (v) setRecorrentes(false) }} testid="exportar-uma-vez">Somente quem comprou 1x</Caixa>
            <Caixa marcado={comTelefone} onChange={setComTelefone} testid="exportar-com-telefone">Somente com telefone</Caixa>
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.05em] text-[#5b6472]">Formato</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              ['completa', FileSpreadsheet, 'Planilha completa (Excel)', 'Todas as colunas da tabela, em português, abre direto no Excel.'],
              ['meta', Megaphone, 'Meta Ads (público personalizado)', 'O arquivo para subir no Gerenciador de Anúncios, como antes.'],
            ] as const).map(([v, Icone, r, d]) => (
              <label key={v} className={`flex cursor-pointer gap-3 rounded-[6px] border p-3 transition-colors ${formato === v ? 'border-[#0688d4] bg-[#f5fbff]' : 'border-[#e5e7eb] hover:border-[#b8bfca]'}`} data-testid={`formato-${v}`}>
                <input type="radio" name="formato" className="mt-1 h-4 w-4 accent-[#0688d4]" checked={formato === v} onChange={() => setFormato(v)} />
                <span><span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-[#1f2937]"><Icone className="h-4 w-4 text-[#0688d4]" />{r}</span><span className="mt-0.5 block text-[12px] text-[#6b7280]">{d}</span></span>
              </label>
            ))}
          </div>
        </section>
        {erro && <p className="text-[12.5px] font-semibold text-[#b91c1c]">{erro}</p>}
      </div>
    </ModalCsv>
  )
}
