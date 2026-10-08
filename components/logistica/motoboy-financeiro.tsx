'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * Logística + financeiro (Fase 3, 0136).
 * - AcessoEntregador: no painel de "Acesso" — gerar link novo (o antigo para na hora), desativar/reativar,
 *   criar o login do app do motoboy.
 * - DinheiroComMotoboys: "Dinheiro com cada motoboy agora" e o troco a entregar no despacho (modo por
 *   pedido: valor sugerido e editável; modo fundo: aviso quando o troco necessário passa do que ele tem).
 * Tudo vai pelo servidor, que confere permissão, caixa aberto e grava no livro-caixa.
 */
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const post = async (url: string, corpo: Record<string, unknown>) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  return { s: r.status, j: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const btn = 'h-[34px] rounded-[3px] border border-border bg-white px-3 text-[11px] font-semibold uppercase tracking-wide text-text-main hover:border-primary hover:text-primary disabled:opacity-50'

export function AcessoEntregador({ id, nome, desativado, temLogin, onMudou }: { id: string; nome: string; desativado?: boolean; temLogin?: boolean; onMudou: () => void }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [login, setLogin] = useState(false)
  const [usuario, setUsuario] = useState(''); const [senha, setSenha] = useState('')
  const acao = async (corpo: Record<string, unknown>, ok: string) => {
    const r = await post(`/api/admin/entregadores/${id}`, corpo)
    setMsg(r.s === 200 ? ok : String(r.j.error ?? 'Não foi possível.'))
    if (r.s === 200) onMudou()
  }
  return (
    <div className="mt-4 space-y-2 border-t border-border pt-3" data-testid="acesso-entregador">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Segurança do acesso</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} data-testid="entregador-novo-link" onClick={() => void acao({ acao: 'novo_link' }, 'Link novo gerado. O antigo parou de funcionar.')}>Gerar link novo</button>
        {desativado
          ? <button type="button" className={btn} data-testid="entregador-reativar" onClick={() => void acao({ acao: 'reativar' }, `${nome} reativado.`)}>Reativar</button>
          : <button type="button" className={`${btn} text-danger`} data-testid="entregador-desativar" onClick={() => void acao({ acao: 'desativar' }, `${nome} desativado: link e login param na hora.`)}>Desativar</button>}
        {!temLogin && <button type="button" className={btn} data-testid="entregador-criar-login" onClick={() => setLogin((v) => !v)}>Criar login do app</button>}
      </div>
      {temLogin && <p className="text-[12px] text-text-subtle">Tem login do app (entra em /motoboy com usuário e senha).</p>}
      {login && (
        <div className="space-y-2 rounded-[3px] border border-border p-2">
          <input placeholder="usuário (ex.: joao.moto)" value={usuario} onChange={(e) => setUsuario(e.target.value.slice(0, 30))} className="h-[36px] w-full rounded-[3px] border border-border px-2 text-[13px]" data-testid="login-usuario" />
          <input type="password" placeholder="senha (mín. 8)" value={senha} onChange={(e) => setSenha(e.target.value.slice(0, 72))} className="h-[36px] w-full rounded-[3px] border border-border px-2 text-[13px]" data-testid="login-senha" />
          <button type="button" className={`${btn} w-full border-primary bg-primary text-white hover:text-white`} data-testid="login-criar"
            onClick={() => void acao({ acao: 'criar_login', usuario, senha }, `Login criado. ${nome} entra em ${typeof window !== 'undefined' ? window.location.origin : ''}/login.`)}>Criar</button>
        </div>
      )}
      {msg && <p className="text-[12px] font-semibold text-primary" data-testid="acesso-msg">{msg}</p>}
    </div>
  )
}

interface Fin { modo: 'pedido' | 'fundo'; veValores: boolean; motoboys: { entregadorId: string; nome: string; saldoCentavos: number }[]; trocos: { pedidoId: string; numero: number; entregadorId: string; entregador: string; trocoCentavos: number; cobre: boolean; temCentavos: number | null }[] }

/** `compacto` (item 58, tela Pedidos): card baixo, com o atalho para Financeiro › Acerto de motoboys. */
export function DinheiroComMotoboys({ compacto = false }: { compacto?: boolean } = {}) {
  const [f, setF] = useState<Fin | null>(null)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/caixa', { cache: 'no-store' }).catch(() => null)
    const j = r?.ok ? await r.json().catch(() => null) : null
    setF(j?.financeiro ?? null)
  }, [])
  useEffect(() => { void carregar(); const i = setInterval(() => void carregar(), 15000); return () => clearInterval(i) }, [carregar])
  if (!f || (!f.veValores && f.trocos.length === 0)) return null
  return (
    <section className={`${compacto ? '' : 'mb-4 '}rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white`} data-testid="dinheiro-motoboys">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-text-main">Dinheiro com cada motoboy agora</h2>
        <span className="flex items-center gap-3 text-[11px] text-text-subtle">Troco: {f.modo === 'pedido' ? 'por pedido' : 'fundo fixo'}{compacto && <Link href="/admin/financeiro?secao=motoboys" className="text-[12px] font-semibold text-[var(--adm-azul,#0b78d0)] hover:underline" data-testid="link-acerto-motoboys">Acerto de motoboys →</Link>}</span>
      </div>
      {!f.veValores ? null : f.motoboys.length === 0 ? <p className="px-4 py-2.5 text-[13px] text-text-subtle">Nenhum motoboy com dinheiro.</p> : (
        <div className="flex flex-wrap gap-2 px-4 py-2.5">
          {f.motoboys.map((m) => (
            <span key={m.entregadorId} className="rounded-[3px] border border-border px-2.5 py-1 text-[12.5px]" data-testid="motoboy-saldo">{m.nome}: <b>{brl(m.saldoCentavos)}</b></span>
          ))}
        </div>
      )}
      {f.trocos.length > 0 && (
        <div className="border-t border-border px-4 py-2.5" data-testid="trocos-a-entregar">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#B45309]">Troco para levar</p>
          <ul className="max-h-[180px] space-y-1.5 overflow-y-auto">
            {f.trocos.map((t) => {
              const valor = valores[t.pedidoId] ?? (t.trocoCentavos / 100).toFixed(2).replace('.', ',')
              const falta = f.modo === 'fundo' && !t.cobre
              return (
                <li key={t.pedidoId} className="flex flex-wrap items-center gap-2 text-[13px]" data-testid="troco-linha">
                  <span>#{t.numero} · {t.entregador} · precisa de <b>{brl(t.trocoCentavos)}</b></span>
                  {f.modo === 'pedido' ? (
                    <>
                      <label className="flex h-[32px] items-center rounded-[3px] border border-border px-2"><span className="mr-1 text-[12px] text-text-subtle">entregue R$</span>
                        <input className="w-[70px] border-0 bg-transparent p-0 text-[13px] shadow-none outline-none focus:ring-0" inputMode="decimal" value={valor} onChange={(e) => setValores((v) => ({ ...v, [t.pedidoId]: e.target.value.replace(/[^\d.,]/g, '') }))} data-testid="troco-entregue" />
                      </label>
                      <button type="button" className={btn} data-testid="troco-confirmar"
                        onClick={async () => { const c = Math.round(Number(valor.replace(/\./g, '').replace(',', '.')) * 100); const r = await post('/api/admin/caixa', { acao: 'troco', entregadorId: t.entregadorId, pedidoId: t.pedidoId, valorCentavos: c, chave: `ped-${t.pedidoId}` }); setMsg(r.s === 200 ? null : String(r.j.error)); void carregar() }}>Registrar troco</button>
                    </>
                  ) : falta ? (
                    <>
                      <span className="text-[12px] font-semibold text-danger" data-testid="troco-falta">{t.temCentavos === null ? 'o fundo do motoboy não cobre' : `o motoboy tem cerca de ${brl(t.temCentavos)}`}</span>
                      <button type="button" className={btn} data-testid="troco-complementar"
                        onClick={async () => { const r = await post('/api/admin/caixa', { acao: 'troco', entregadorId: t.entregadorId, valorCentavos: t.trocoCentavos - (t.temCentavos ?? 0), motivo: 'complemento', chave: `comp-${t.pedidoId}` }); setMsg(r.s === 200 ? null : String(r.j.error)); void carregar() }}>Complementar troco</button>
                    </>
                  ) : <span className="text-[12px] text-[#16A34A]">coberto pelo fundo</span>}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {msg && <p className="px-4 pb-2.5 text-[12px] font-semibold text-danger">{msg}</p>}
    </section>
  )
}
