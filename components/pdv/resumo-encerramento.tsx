'use client'

import type { ResumoEncerramento } from '@/lib/encerramento-conta'
import { formatBRL } from './util'

/**
 * Depois de fechar ou cancelar uma conta: o que aconteceu, em números, antes de a tela
 * voltar para o salão/Central. Usado pelo PDV e pelo painel de Mesas.
 */
export function ResumoEncerramentoModal({
  titulo,
  resumo,
  emLimpeza,
  onOk,
}: {
  /** "Mesa 03", "Senha 12 · Ana"… */
  titulo: string
  resumo: ResumoEncerramento
  /** Mesa foi para limpeza (fechamento do PDV v2): o próximo passo é liberar. */
  emLimpeza?: boolean
  onOk: () => void
}) {
  const cancelada = resumo.acao === 'cancelada'
  const quando = resumo.horario
    ? new Date(resumo.horario).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null
  const linha = (rotulo: string, valor: string, forte?: boolean, tom?: string) => (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-[13px] text-text-subtle">{rotulo}</span>
      <span className={`text-[14px] ${forte ? 'font-bold' : 'font-semibold'} ${tom ?? 'text-text-main'}`}>{valor}</span>
    </div>
  )
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Resumo do encerramento" data-testid="resumo-encerramento">
      <div className="w-full max-w-sm overflow-hidden rounded-menuzia bg-white shadow-xl">
        <div className={`border-b border-border px-4 py-3 ${cancelada ? 'bg-danger-bg' : 'bg-price-bg'}`}>
          <p className={`text-[11px] font-bold uppercase tracking-wide ${cancelada ? 'text-danger' : 'text-price-text'}`}>
            {cancelada ? 'Conta cancelada' : 'Conta fechada'}
          </p>
          <h2 className="text-[15px] font-bold text-text-main">{titulo}</h2>
        </div>
        <div className="px-4 py-3">
          {linha(cancelada ? 'Total cancelado' : 'Total', formatBRL(resumo.total), true)}
          {linha('Pago', formatBRL(resumo.pago), false, 'text-price-text')}
          {linha('Falta pagar', formatBRL(resumo.faltaPagar), false, resumo.faltaPagar > 0 ? 'text-danger' : 'text-text-main')}
          <div className="my-2 border-t border-border" />
          {linha('Pedidos pendentes no encerramento', String(resumo.pendentes))}
          {linha('Pedidos cancelados', String(resumo.cancelados), false, resumo.cancelados > 0 ? 'text-danger' : 'text-text-main')}
          {resumo.motivo && (
            <p className="mt-2 rounded-menuzia bg-page px-3 py-2 text-[12px] text-text-main">
              <span className="font-semibold">Motivo:</span> {resumo.motivo}
            </p>
          )}
          <p className="mt-2 text-[12px] text-text-subtle" data-testid="resumo-autor">
            {cancelada ? 'Cancelada' : 'Fechada'}
            {resumo.usuario ? ` por ${resumo.usuario}` : ''}
            {quando ? ` em ${quando}` : ''}. Registrado na auditoria.
          </p>
          {emLimpeza && (
            <p className="mt-2 rounded-menuzia bg-warn-bg px-3 py-2 text-[12px] text-text-main">
              A mesa ficou <strong>em limpeza</strong>. Libere para o próximo cliente quando estiver pronta.
            </p>
          )}
        </div>
        <div className="border-t border-border px-4 py-3">
          <button type="button" onClick={onOk} className="w-full rounded-menuzia bg-primary py-3 text-[13px] font-bold uppercase tracking-wide text-white hover:bg-primary-dark">
            Ok
          </button>
        </div>
      </div>
    </div>
  )
}
