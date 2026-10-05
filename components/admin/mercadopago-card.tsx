'use client'

import { useCallback, useEffect, useState } from 'react'
import { AprovacaoPin, Janela, type AprovacaoDada } from '@/components/financeiro/apoio'

/**
 * Integrações › Mercado Pago (Pix online, 0148). Conectar/desconectar (só o dono), validade da cobrança,
 * situação da conta (sem token — só "••••1234") e os últimos Pix online com "Devolver" (estorno total,
 * aprovado por gerente/dono com PIN, nunca por quem pediu).
 */
interface Pagamento {
  id: string; numero: number | null; cliente: string | null; valor: number; status: string; taxa: number | null; liquido: number | null
  criado_em: string; pago_em: string | null; devolvido_em: string | null; aprovado_por_nome: string | null; motivo_devolucao: string | null
}
interface Estado {
  servidorPronto: boolean; lojaLiberada: boolean; validadeMin: number; podeConectar: boolean
  conta: { conectada: boolean; status: string | null; apelido: string | null; email: string | null; desde: string | null; final: string | null; ambiente: string | null; erro: string | null }
  pagamentos: Pagamento[]
}

const brl = (v: number | null) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const ROTULO: Record<string, { t: string; cor: string }> = {
  pendente: { t: 'Aguardando', cor: '#B45309' }, pago: { t: 'Pago', cor: '#047857' }, expirado: { t: 'Expirou', cor: '#4B5563' },
  cancelado: { t: 'Cancelado', cor: '#4B5563' }, a_devolver: { t: 'A devolver', cor: '#B91C1C' }, devolvido: { t: 'Devolvido', cor: '#1D4ED8' },
  verificacao_pendente: { t: 'Verificação pendente', cor: '#B45309' }, erro: { t: 'Não confere', cor: '#B91C1C' },
}

export function MercadoPagoCard({ avisar }: { avisar: (m: string) => void }) {
  const [e, setE] = useState<Estado | null>(null)
  const [devolver, setDevolver] = useState<Pagamento | null>(null)
  const [motivo, setMotivo] = useState('')
  const [etapa, setEtapa] = useState<'motivo' | 'aprovar'>('motivo')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/pix-online', { cache: 'no-store' }).catch(() => null)
    if (r?.ok) setE(await r.json())
  }, [])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('mercadopago')
    if (!q) return
    const msg: Record<string, string> = { conectado: 'Conta do Mercado Pago conectada.', falhou: 'Não foi possível conectar. Tente de novo.', cancelado: 'Conexão cancelada.', sem_permissao: 'Só o dono conecta a conta de pagamentos.', nao_configurado: 'O Pix online ainda não foi configurado no servidor.' }
    avisar(msg[q] ?? q)
  }, [avisar])

  async function desconectar() {
    if (!window.confirm('Desconectar a conta do Mercado Pago? A vitrine para de oferecer o Pix online.')) return
    await fetch('/api/admin/pix-online', { method: 'DELETE' })
    avisar('Conta desconectada.'); void carregar()
  }
  async function salvarValidade(min: number) {
    const r = await fetch('/api/admin/pix-online', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ validadeMin: min }) })
    if (r.ok) { avisar(`Validade do Pix: ${min} minutos.`); void carregar() }
  }
  async function confirmarDevolucao(a: AprovacaoDada) {
    if (!devolver) return
    setOcupado(true); setErro(null)
    const r = await fetch('/api/admin/pix-online', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'devolver', pagamentoId: devolver.id, motivo, aprovacao: a }) })
    const j = await r.json().catch(() => ({}))
    setOcupado(false)
    if (!r.ok) { setErro(j.error ?? 'Não foi possível devolver.'); return }
    setDevolver(null); setMotivo(''); setEtapa('motivo')
    avisar('Pix devolvido ao cliente.'); void carregar()
  }

  // Loja sem o Pix online liberado: o card nem aparece (nada muda em Integrações).
  if (!e || !e.lojaLiberada) return null
  const c = e.conta
  return (
    <section className="flex h-full flex-col rounded-[12px] border border-[#E5E7EB] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]" data-testid="cartao-mercadopago">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-text-main">Mercado Pago · Pix online</p>
          <p className="mt-[2px] text-[12.5px] text-text-subtle">O cliente paga o Pix na hora, pelo QR; o pedido só vai para a cozinha depois que o Mercado Pago confirma. O dinheiro cai na conta da loja.</p>
        </div>
        <span className={`flex-shrink-0 rounded-[3px] px-[8px] py-[3px] text-[11px] font-bold uppercase tracking-wide text-white ${c.conectada ? 'bg-[#047857]' : c.status === 'erro' ? 'bg-[#B91C1C]' : 'bg-[#4B5563]'}`} data-testid="mp-situacao">
          {c.conectada ? 'Conectado' : c.status === 'erro' ? 'Reconectar' : 'Desconectado'}
        </span>
      </div>

      {!e.lojaLiberada && <p className="mt-[10px] rounded-[3px] bg-[#F3F4F6] px-[10px] py-[8px] text-[12.5px] text-text-main">Pix online ainda não liberado para esta loja.</p>}
      {e.lojaLiberada && !e.servidorPronto && <p className="mt-[10px] rounded-[3px] bg-[#FEF3C7] px-[10px] py-[8px] text-[12.5px] text-[#92400E]">Falta configurar o Mercado Pago no servidor.</p>}

      {c.conectada || c.status === 'erro' ? (
        <div className="mt-[12px] text-[13px] text-text-main" data-testid="mp-conta">
          <p>Conta {c.apelido ?? ''} ••••{c.final}{c.email ? ` · ${c.email}` : ''}{c.ambiente === 'teste' ? ' (TESTE)' : ''}</p>
          {c.desde && <p className="text-text-subtle">Desde {new Date(c.desde).toLocaleDateString('pt-BR')}</p>}
          {c.erro && <p className="mt-[4px] font-semibold text-[#B91C1C]">{c.erro}. Conecte de novo.</p>}
        </div>
      ) : null}

      {e.podeConectar && e.lojaLiberada && (
        <div className="mt-[12px] flex flex-wrap items-center gap-2">
          {!c.conectada && <a href="/api/integracoes/mercadopago/conectar" className="inline-flex h-[40px] items-center rounded-[3px] bg-[#0369A1] px-[14px] text-[12px] font-semibold uppercase tracking-wide text-white hover:bg-[#075985]" data-testid="mp-conectar">Conectar Mercado Pago</a>}
          {(c.conectada || c.status === 'erro') && <button type="button" onClick={() => void desconectar()} className="h-[40px] rounded-[3px] border border-[#CBD2D9] bg-white px-[14px] text-[12px] font-semibold uppercase tracking-wide text-text-main hover:bg-[#F3F4F6]" data-testid="mp-desconectar">Desconectar</button>}
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-text-main">Prazo para pagar
            <select value={e.validadeMin} onChange={(ev) => void salvarValidade(Number(ev.target.value))} className="h-[36px] rounded-[3px] border border-[#CBD2D9] bg-white px-2 text-[13px]" data-testid="mp-validade">
              {[5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
        </div>
      )}

      {e.pagamentos.length > 0 && (
        <div className="mt-[14px]">
          <p className="mb-[6px] text-[12px] font-semibold uppercase tracking-wide text-text-subtle">Últimos Pix online</p>
          <ul className="divide-y divide-[#E5E7EB] text-[13px]" data-testid="mp-pagamentos">
            {e.pagamentos.slice(0, 12).map((p) => {
              const r = ROTULO[p.status] ?? { t: p.status, cor: '#4B5563' }
              return (
                <li key={p.id} className="flex items-center gap-2 py-[7px]">
                  <span className="w-[54px] font-semibold">#{p.numero ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-text-subtle">{p.cliente ?? ''}</span>
                  <span className="font-semibold">{brl(p.valor)}</span>
                  <span className="rounded-[3px] px-[6px] py-[2px] text-[11px] font-bold text-white" style={{ background: r.cor }}>{r.t}</span>
                  {['pago', 'a_devolver'].includes(p.status) && (
                    <button type="button" onClick={() => { setDevolver(p); setEtapa('motivo'); setErro(null) }} className="h-[30px] rounded-[3px] border border-[#B91C1C] px-[8px] text-[11px] font-bold uppercase text-[#B91C1C] hover:bg-[#FEE2E2]" data-testid="mp-devolver">Devolver</button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {devolver && (
        <Janela titulo={`Devolver Pix do pedido #${devolver.numero ?? ''}`} onFechar={() => setDevolver(null)} testid="janela-devolver-pix">
          <p className="text-[13px] text-text-main">Devolve {brl(devolver.valor)} ao cliente pelo Mercado Pago (valor total). Precisa da aprovação de um gerente ou do dono — nunca de quem pediu.</p>
          {etapa === 'motivo' ? (
            <>
              <label className="mt-[10px] block text-[12.5px] font-semibold text-text-main">Motivo
                <input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} maxLength={300} className="mt-[4px] h-[40px] w-full rounded-[3px] border border-[#CBD2D9] px-[10px] text-[14px]" data-testid="devolver-motivo" />
              </label>
              <div className="mt-[12px] flex justify-end gap-2">
                <button type="button" onClick={() => setDevolver(null)} className="h-[40px] rounded-[3px] border border-[#CBD2D9] px-[14px] text-[12px] font-semibold uppercase">Cancelar</button>
                <button type="button" disabled={motivo.trim().length < 3} onClick={() => setEtapa('aprovar')} className="h-[40px] rounded-[3px] bg-[#B91C1C] px-[14px] text-[12px] font-semibold uppercase text-white disabled:opacity-50" data-testid="devolver-seguir">Pedir aprovação</button>
              </div>
            </>
          ) : (
            <div className="mt-[10px]">
              <AprovacaoPin titulo="Aprovação da devolução" onConfirmar={(a) => void confirmarDevolucao(a)} onCancelar={() => setEtapa('motivo')} erro={erro} ocupado={ocupado}
                remoto={{ acao: 'pix_online_devolver', valorCentavos: Math.round(devolver.valor * 100), motivo }} />
            </div>
          )}
          {erro && etapa === 'motivo' && <p className="mt-[8px] text-[12px] text-danger">{erro}</p>}
        </Janela>
      )}
    </section>
  )
}
