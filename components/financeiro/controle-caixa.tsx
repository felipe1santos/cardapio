'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { FIN_BTN, FIN_COR, SeloMeta } from '@/components/graficos/kit-meta'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { estadoMudou } from '@/lib/sessao-cliente'
import type { Passo } from '@/lib/financeiro/controle-caixa'

interface Estado {
  ativo: boolean; ativadoEm: string | null; ativadoPorNome: string | null
  passos: Passo[]; podeAtivar: boolean; souDono: boolean
  fundoCentavos: number | null; toleranciaCentavos: number | null
  caixaAberto: { desde: string; por: string | null } | null
}

const reais = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','))
const centavos = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null }
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

/**
 * Controle de caixa (nível 2, 0167) no topo de Financeiro › Caixa: no nível 1 mostra que o caixa é automático e o
 * passo a passo "Ativar controle de caixa" (guia #ativacao); no nível 2, quem ativou e o "Desativar" do dono.
 */
export function ControleCaixa() {
  const [e, setE] = useState<Estado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)
  const [confirmando, setConfirmando] = useState<null | 'ativar' | 'desativar'>(null)
  const [fundo, setFundo] = useState('')
  const [tol, setTol] = useState('')
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/financeiro/controle-caixa', { cache: 'no-store' }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    if (!r?.ok || !j) return
    setE(j as Estado)
    setFundo((f) => f || reais((j as Estado).fundoCentavos ?? 5000))
    setTol((t) => t || reais((j as Estado).toleranciaCentavos ?? 200))
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  const enviar = async (acao: 'ativar' | 'desativar') => {
    setEnviando(true); setErro(null)
    const corpo = acao === 'ativar' ? { acao, confirmar: true, fundoCentavos: centavos(fundo), toleranciaCentavos: centavos(tol) } : { acao, confirmar: true }
    const r = await fetch('/api/admin/financeiro/controle-caixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    setEnviando(false); setConfirmando(null)
    if (j?.passos) setE(j as Estado)
    if (!r?.ok) { setErro(j?.error ?? 'Não foi possível salvar.'); return }
    setAberto(false)
    estadoMudou()
    window.dispatchEvent(new Event('menuzia:caixa-mudou'))
  }

  if (!e) return null

  if (e.ativo) {
    return (
      <section className="fin-card flex flex-col gap-3 border-l-[3px] p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderLeftColor: '#4DBBA6' }} data-testid="controle-caixa-ativo">
        <div>
          <p className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: FIN_COR.texto }}>Controle de caixa ativo <SeloMeta tom="verde">Nível 2</SeloMeta></p>
          <p className="mt-1 text-[13px]" style={{ color: FIN_COR.texto2 }}>
            Abrir e fechar o caixa é obrigatório, com contagem às cegas.{e.ativadoEm ? ` Ativado por ${e.ativadoPorNome ?? '—'} em ${quando(e.ativadoEm)}.` : ''}
          </p>
          {erro && <p className="mt-1 text-[13px] text-danger">{erro}</p>}
        </div>
        {e.souDono && (confirmando === 'desativar' ? (
          <div className="flex flex-shrink-0 flex-wrap gap-2">
            <button type="button" className={FIN_BTN.contorno} onClick={() => setConfirmando(null)} disabled={enviando}>Voltar</button>
            <button type="button" className={FIN_BTN.perigo} onClick={() => void enviar('desativar')} disabled={enviando} data-testid="controle-caixa-confirmar-desativar">Confirmar: voltar ao caixa automático</button>
          </div>
        ) : (
          <button type="button" className={`${FIN_BTN.contorno} flex-shrink-0`} onClick={() => setConfirmando('desativar')} data-testid="controle-caixa-desativar">Desativar controle de caixa</button>
        ))}
      </section>
    )
  }

  const obrigatoriosOk = e.passos.filter((p) => p.obrigatorio && p.id !== 'fundo').every((p) => p.ok)
  return (
    <section className="fin-card border-l-[3px] p-4" style={{ borderLeftColor: '#1877F2' }} data-testid="controle-caixa-nivel1">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: FIN_COR.texto }}>Caixa automático <SeloMeta tom="azul">Nível 1</SeloMeta></p>
          <p className="mt-1 text-[13px]" style={{ color: FIN_COR.texto2 }}>
            As vendas entram sozinhas no caixa do dia; ninguém precisa abrir nem fechar. PDV, mesas e delivery vendem como antes.{' '}
            <Link href="/admin/financeiro/guia#niveis" className="font-semibold underline">Os dois níveis</Link>
          </p>
        </div>
        <button type="button" className={`${FIN_BTN.primario} w-full flex-shrink-0 sm:w-auto`} onClick={() => setAberto((v) => !v)} aria-expanded={aberto} data-testid="controle-caixa-abrir-passos">
          {aberto ? 'Fechar passo a passo' : 'Ativar controle de caixa'}
        </button>
      </div>

      {aberto && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: '#E4E6EB' }} data-testid="controle-caixa-passos">
          <ol className="space-y-3">
            {e.passos.map((p, i) => (
              <li key={p.id} className="flex gap-3" data-testid={`controle-caixa-passo-${p.id}`} data-ok={p.ok ? '1' : '0'}>
                <span className="grid h-[24px] w-[24px] flex-shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white" style={{ background: p.ok ? '#31A24C' : p.obrigatorio ? '#D47B04' : '#8A8D91' }}>{p.ok ? '✓' : i + 1}</span>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold" style={{ color: FIN_COR.texto }}>{p.titulo}</p>
                  <p className="text-[13px]" style={{ color: FIN_COR.texto2 }}>{p.detalhe}</p>
                  {p.id === 'fundo' && e.souDono && (
                    <div className="mt-2 flex flex-wrap gap-3">
                      <label className="text-[12px]" style={{ color: FIN_COR.texto2 }}>Fundo de caixa (R$)
                        <input inputMode="decimal" value={fundo} onChange={(ev) => setFundo(ev.target.value)} className="fin-card mt-1 block h-[38px] w-[130px] px-2.5 text-[14px] font-semibold outline-none focus:border-primary" data-testid="controle-caixa-fundo" />
                      </label>
                      <label className="text-[12px]" style={{ color: FIN_COR.texto2 }}>Tolerância no fechamento (R$)
                        <input inputMode="decimal" value={tol} onChange={(ev) => setTol(ev.target.value)} className="fin-card mt-1 block h-[38px] w-[130px] px-2.5 text-[14px] font-semibold outline-none focus:border-primary" data-testid="controle-caixa-tolerancia" />
                      </label>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[13px]" style={{ color: FIN_COR.texto2 }}>
            Vale a partir do próximo turno: {e.caixaAberto ? `o caixa aberto agora (${e.caixaAberto.por ?? 'automático'}, desde ${quando(e.caixaAberto.desde)}) continua até ser fechado aqui em Caixa; ` : ''}
            o próximo caixa é aberto à mão com o fundo contado. Sem caixa aberto, o PDV não recebe. Avise a equipe antes.
          </p>
          {erro && <p className="mt-2 text-[13px] text-danger" data-testid="controle-caixa-erro">{erro}</p>}
          {!e.souDono ? (
            <p className="mt-3 text-[13px] font-semibold" style={{ color: FIN_COR.texto }}>Só o dono ativa o controle de caixa.</p>
          ) : confirmando === 'ativar' ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={FIN_BTN.contorno} onClick={() => setConfirmando(null)} disabled={enviando}>Voltar</button>
              <button type="button" className={FIN_BTN.primario} onClick={() => void enviar('ativar')} disabled={enviando} data-testid="controle-caixa-confirmar-ativar">
                Confirmar: ativar (fundo {formatarCentavos(centavos(fundo) ?? 0)})
              </button>
            </div>
          ) : (
            <button type="button" className={`${FIN_BTN.primario} mt-3`} disabled={!obrigatoriosOk || centavos(fundo) === null || centavos(tol) === null} onClick={() => setConfirmando('ativar')} data-testid="controle-caixa-ativar">
              Ativar controle de caixa a partir do próximo turno
            </button>
          )}
        </div>
      )}
    </section>
  )
}
