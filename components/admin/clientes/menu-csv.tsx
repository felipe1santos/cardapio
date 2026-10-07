'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, History, Upload } from 'lucide-react'
import { ModalExportar } from './modal-exportar'
import { ModalImportar } from './modal-importar'
import { BTN, ModalCsv } from './csv-comum'
import { Flutuante } from '@/components/ui/flutuante'

/** Botão "CSV ▾" da Base de Clientes: Importar, Exportar e Histórico de importações. */
export function MenuCsv({ onToast, onMudou }: { onToast: (tom: 'ok' | 'erro', t: string) => void; onMudou: () => void }) {
  const [aberto, setAberto] = useState(false)
  const [modal, setModal] = useState<'importar' | 'exportar' | 'historico' | null>(null)
  // Menu por cima de tudo (portal): fecha com clique fora e Esc.
  const botao = useRef<HTMLButtonElement>(null)
  const fecharMenu = useCallback(() => setAberto(false), [])
  const fechar = useCallback(() => setModal(null), [])
  const Item = ({ icone: Icone, rotulo, onClick, testid }: { icone: typeof Upload; rotulo: string; onClick: () => void; testid: string }) => (
    <button type="button" role="menuitem" onClick={() => { setAberto(false); onClick() }} data-testid={testid}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-medium text-[#1f2937] hover:bg-[#f3f4f6]">
      <Icone className="h-4 w-4 text-[#0688d4]" /> {rotulo}
    </button>
  )
  return (
    <div className="relative">
      <button ref={botao} type="button" onClick={() => setAberto((v) => !v)} aria-haspopup="menu" aria-expanded={aberto} data-testid="botao-csv"
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-menuzia bg-primary px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark sm:w-auto">
        CSV <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <Flutuante ancora={botao} aberto={aberto} onFechar={fecharMenu} largura={230} testid="menu-csv" rotulo="CSV" className="py-1">
        <div role="menu">
          <Item icone={Upload} rotulo="Importar clientes" onClick={() => setModal('importar')} testid="menu-importar" />
          <Item icone={Download} rotulo="Exportar clientes" onClick={() => setModal('exportar')} testid="menu-exportar" />
          <div className="my-1 border-t border-[#f0f1f3]" />
          <Item icone={History} rotulo="Histórico de importações" onClick={() => setModal('historico')} testid="menu-historico" />
        </div>
      </Flutuante>
      {modal === 'exportar' && <ModalExportar onFechar={fechar} onToast={onToast} />}
      {modal === 'importar' && <ModalImportar onFechar={fechar} onImportou={onMudou} />}
      {modal === 'historico' && <Historico onFechar={fechar} onToast={onToast} onMudou={onMudou} />}
    </div>
  )
}

interface Importacao { id: string; usuario_nome: string; arquivo_nome: string; modo: string; total_linhas: number; criados: number; atualizados: number; ignorados: number; erros: number; status: string; criado_em: string; desfeita_em: string | null }

function Historico({ onFechar, onToast, onMudou }: { onFechar: () => void; onToast: (tom: 'ok' | 'erro', t: string) => void; onMudou: () => void }) {
  const [lista, setLista] = useState<Importacao[] | null>(null)
  const [dias, setDias] = useState(7)
  const [confirmar, setConfirmar] = useState<Importacao | null>(null)
  const [desfazendo, setDesfazendo] = useState(false)
  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/clientes/importacoes', { cache: 'no-store' })
    const j = await r.json().catch(() => null)
    if (r.ok) { setLista(j.importacoes); setDias(j.diasDesfazer) } else setLista([])
  }, [])
  useEffect(() => { void carregar() }, [carregar])
  const podeDesfazer = (i: Importacao) => i.status === 'concluida' && Date.now() - new Date(i.criado_em).getTime() < dias * 86_400_000
  async function desfazer(i: Importacao) {
    setDesfazendo(true)
    const r = await fetch(`/api/admin/clientes/importacoes/${i.id}/desfazer`, { method: 'POST' })
    const j = await r.json().catch(() => null)
    setDesfazendo(false)
    setConfirmar(null)
    if (!r.ok) { onToast('erro', j?.error ?? 'Não foi possível desfazer.'); return }
    onToast('ok', `Importação desfeita: ${j.removidos} removidos, ${j.restaurados} restaurados${j.mantidos ? `, ${j.mantidos} mantidos (já pediram)` : ''}.`)
    await carregar()
    onMudou()
  }
  const data = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  const MODO: Record<string, string> = { ignorar: 'Ignorar existentes', completar: 'Completar vazios', atualizar: 'Atualizar existentes' }
  return (
    <ModalCsv titulo="Histórico de importações" subtitulo={`Desfazer fica disponível por ${dias} dias.`} onFechar={onFechar} testid="modal-historico" largura={860}>
      {lista === null ? <p className="text-[13px] text-[#6b7280]">Carregando…</p> : lista.length === 0 ? <p className="py-8 text-center text-[13px] text-[#6b7280]" data-testid="historico-vazio">Nenhuma importação ainda.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead className="border-b border-[#e5e7eb] bg-[#f9fafb] text-[#5b6472]"><tr>{['Data', 'Usuário', 'Arquivo', 'Criados', 'Atualiz.', 'Ignor.', 'Erros', ''].map((h) => <th key={h} className="px-2.5 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.id} className="border-b border-[#f0f1f3]" data-testid="historico-linha" data-arquivo={i.arquivo_nome}>
                  <td className="whitespace-nowrap px-2.5 py-2">{data(i.criado_em)}</td>
                  <td className="px-2.5 py-2">{i.usuario_nome || '—'}</td>
                  <td className="max-w-[200px] px-2.5 py-2"><div className="truncate font-medium" title={i.arquivo_nome}>{i.arquivo_nome || '—'}</div><div className="text-[11.5px] text-[#6b7280]">{MODO[i.modo] ?? i.modo}</div></td>
                  <td className="px-2.5 py-2 tabular-nums">{i.criados}</td>
                  <td className="px-2.5 py-2 tabular-nums">{i.atualizados}</td>
                  <td className="px-2.5 py-2 tabular-nums">{i.ignorados}</td>
                  <td className="px-2.5 py-2 tabular-nums">{i.erros}</td>
                  <td className="px-2.5 py-2 text-right">
                    {i.status === 'desfeita' ? <span className="rounded-[4px] bg-[#f1f5f9] px-2 py-[3px] text-[11.5px] font-semibold text-[#64748b]">Desfeita</span>
                      : i.status === 'processando' ? <span className="text-[11.5px] text-[#b45309]">Incompleta</span>
                      : podeDesfazer(i) ? <button type="button" className="text-[12.5px] font-semibold text-[#b91c1c] hover:underline" onClick={() => setConfirmar(i)} data-testid="historico-desfazer">Desfazer</button>
                      : <span className="text-[11.5px] text-[#9ca3af]">Prazo encerrado</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmar && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onMouseDown={() => setConfirmar(null)}>
          <div role="alertdialog" className="w-full max-w-[420px] rounded-[8px] bg-white p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()} data-testid="confirmar-desfazer">
            <h3 className="text-[15px] font-semibold text-[#1f2937]">Desfazer importação?</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#4b5563]">Os {confirmar.criados} clientes criados por <b>{confirmar.arquivo_nome}</b> saem da base (menos quem já fez pedido). Os {confirmar.atualizados} atualizados voltam aos dados de antes.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={BTN.sec} onClick={() => setConfirmar(null)}>Voltar</button>
              <button type="button" className="inline-flex h-10 items-center rounded-[5px] bg-[#dc2626] px-4 text-[13px] font-semibold text-white hover:bg-[#b91c1c] disabled:opacity-50" disabled={desfazendo} onClick={() => void desfazer(confirmar)} data-testid="confirmar-desfazer-ok">{desfazendo ? 'Desfazendo…' : 'Desfazer'}</button>
            </div>
          </div>
        </div>
      )}
    </ModalCsv>
  )
}
