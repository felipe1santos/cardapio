'use client'

import { useEffect, useState } from 'react'
import { paraCentavos, formatarCentavos } from '@/lib/financeiro/centavos'
import { TecladoPin } from '@/components/admin/teclado-pin'

/** Campo de dinheiro: a pessoa digita "150" ou "150,50"; a tela devolve centavos (ou null). */
export function CampoDinheiro({ valor, onMudar, rotulo, testid, autoFocus }: {
  valor: string; onMudar: (texto: string, centavos: number | null) => void; rotulo: string; testid?: string; autoFocus?: boolean
}) {
  const c = valor.trim() ? paraCentavos(valor) : null
  return (
    <label className="block">
      <span className="mb-[4px] block text-[11px] font-bold uppercase tracking-wide text-text-subtle">{rotulo}</span>
      <div className="flex h-[40px] items-center rounded-[3px] border border-border bg-white px-[10px] focus-within:border-primary">
        <span className="mr-[6px] text-[13px] text-text-subtle">R$</span>
        <input inputMode="decimal" autoFocus={autoFocus} className="h-full w-full bg-transparent text-[15px] font-semibold text-text-main outline-none" placeholder="0,00"
          value={valor} data-testid={testid}
          onChange={(e) => { const t = e.target.value.replace(/[^\d.,]/g, '').slice(0, 12); onMudar(t, t.trim() ? paraCentavos(t) : null) }} />
      </div>
      {valor.trim() && c === null && <span className="mt-[2px] block text-[11px] text-danger">Valor inválido.</span>}
    </label>
  )
}

export const brl = (c: number | null | undefined) => (c == null ? '—' : formatarCentavos(c))

export interface AprovacaoDada { aprovadorId: string; pin: string; remotaId?: string }
/** O que o servidor manda pedir quando a aprovação pode vir pelo celular (ação e valor exatos). */
export interface PedidoRemoto { acao: string; valorCentavos?: number | null; motivo?: string | null }

/**
 * Aprovação de OUTRA pessoa com o PIN dela (gerente/dono). Lista quem pode aprovar (servidor) e
 * devolve { aprovadorId, pin } — quem confere é o servidor, na própria ação.
 * Fase 6: com `remoto`, aparece "Pedir pelo celular": o gerente/dono aprova no celular dele, com o PIN dele;
 * aqui a tela espera e devolve { remotaId } (vale uma vez, para esta ação e este valor, por 10 minutos).
 */
export function AprovacaoPin({ titulo, onConfirmar, onCancelar, erro, ocupado, remoto }: {
  titulo: string; onConfirmar: (a: AprovacaoDada) => void; onCancelar: () => void; erro?: string | null; ocupado?: boolean; remoto?: PedidoRemoto | null
}) {
  const [lista, setLista] = useState<{ id: string; nome: string }[] | null>(null)
  const [quem, setQuem] = useState<{ id: string; nome: string } | null>(null)
  const [pin, setPin] = useState('')
  const [esperando, setEsperando] = useState<{ id: string; status: string; aprovador?: string | null; motivo?: string | null } | null>(null)
  const [erroRemoto, setErroRemoto] = useState<string | null>(null)
  useEffect(() => {
    void fetch('/api/admin/financeiro/aprovadores', { cache: 'no-store' }).then((r) => r.json()).then((j) => setLista(j.aprovadores ?? [])).catch(() => setLista([]))
  }, [])
  useEffect(() => { if (erro) setPin('') }, [erro])
  useEffect(() => {
    if (!esperando || esperando.status !== 'pendente') return
    const t = setInterval(async () => {
      const r = await fetch(`/api/admin/financeiro/aprovacoes-remotas?id=${esperando.id}`, { cache: 'no-store' }).catch(() => null)
      const j = r?.ok ? await r.json().catch(() => null) : null
      if (!j) return
      if (j.status === 'aprovado') { clearInterval(t); setEsperando({ id: esperando.id, status: 'aprovado', aprovador: j.aprovador_nome }); onConfirmar({ aprovadorId: '', pin: '', remotaId: esperando.id }) }
      else if (j.status !== 'pendente') { clearInterval(t); setEsperando({ id: esperando.id, status: j.status, aprovador: j.aprovador_nome, motivo: j.recusa_motivo }) }
    }, 2500)
    return () => clearInterval(t)
  }, [esperando, onConfirmar])
  async function pedirRemoto() {
    if (!remoto) return
    setErroRemoto(null)
    const r = await fetch('/api/admin/financeiro/aprovacoes-remotas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(remoto) }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) { setErroRemoto(j.error ?? 'Não foi possível pedir.'); return }
    setEsperando({ id: j.id, status: 'pendente' })
  }
  if (esperando) {
    return (
      <div className="rounded-[3px] border border-[#F59E0B] bg-[#FEF3C7] p-[12px]" data-testid="aprovacao-remota">
        <p className="text-[13px] font-semibold text-text-main">{titulo}</p>
        {esperando.status === 'pendente' && <p className="mt-[4px] text-[13px] text-text-main" data-testid="aprovacao-remota-esperando">Pedido enviado. Aguardando o gerente ou o dono aprovar no celular… (vale 10 minutos)</p>}
        {esperando.status === 'aprovado' && <p className="mt-[4px] text-[13px] font-semibold text-[#15803D]">Aprovado por {esperando.aprovador}.</p>}
        {esperando.status === 'recusado' && <p className="mt-[4px] text-[13px] font-semibold text-danger" data-testid="aprovacao-remota-recusada">Recusado por {esperando.aprovador}{esperando.motivo ? `: ${esperando.motivo}` : '.'}</p>}
        {['expirado', 'usado', 'cancelado'].includes(esperando.status) && <p className="mt-[4px] text-[13px] text-danger">O pedido expirou. Peça de novo.</p>}
        {erro && <p className="mt-[4px] text-[12px] text-danger">{erro}</p>}
        <button type="button" onClick={() => setEsperando(null)} className="mt-[8px] text-[11px] font-semibold uppercase tracking-wide text-primary">Aprovar aqui com PIN</button>
        <button type="button" onClick={onCancelar} className="ml-[12px] mt-[8px] text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Cancelar</button>
      </div>
    )
  }
  return (
    <div className="rounded-[3px] border border-[#F59E0B] bg-[#FEF3C7] p-[12px]" data-testid="aprovacao-pin">
      <p className="text-[13px] font-semibold text-text-main">{titulo}</p>
      {!quem ? (
        <>
          <p className="mb-[8px] mt-[2px] text-[12px] text-text-subtle">Chame quem vai aprovar e escolha o nome dele.</p>
          {lista === null ? <p className="text-[12px] text-text-subtle">Carregando…</p>
            : lista.length === 0 ? <p className="text-[12px] text-danger">Ninguém com PIN pode aprovar. O gerente ou o dono precisa criar o PIN em Minha conta.</p>
            : (
              <div className="grid gap-[6px]">
                {lista.map((a) => (
                  <button key={a.id} type="button" data-testid="aprovador" onClick={() => setQuem(a)}
                    className="h-[40px] rounded-[3px] border border-border bg-white px-[10px] text-left text-[13px] font-semibold text-text-main hover:border-primary">{a.nome}</button>
                ))}
              </div>
            )}
        </>
      ) : (
        <div className="mt-[8px] rounded-[3px] bg-white p-[10px]">
          <p className="mb-[8px] text-center text-[13px] text-text-subtle">PIN de <b className="text-text-main">{quem.nome}</b></p>
          <TecladoPin valor={pin} onMudar={setPin} onCompleto={(p) => onConfirmar({ aprovadorId: quem.id, pin: p })} ocupado={ocupado} erro={erro} />
          <button type="button" onClick={() => { setQuem(null); setPin('') }} className="mt-[8px] w-full text-[11px] font-semibold uppercase tracking-wide text-primary">Trocar aprovador</button>
        </div>
      )}
      {remoto && !quem && (
        <button type="button" onClick={() => void pedirRemoto()} data-testid="aprovacao-pedir-celular"
          className="mt-[8px] h-[38px] w-full rounded-[3px] bg-[#0369A1] px-[10px] text-[11px] font-semibold uppercase tracking-wide text-white hover:brightness-110">Pedir pelo celular do gerente/dono</button>
      )}
      {erroRemoto && <p className="mt-[4px] text-[12px] text-danger">{erroRemoto}</p>}
      <button type="button" onClick={onCancelar} className="mt-[8px] text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Cancelar</button>
    </div>
  )
}

/** Janela central padrão do painel (cantos de 3px). */
export function Janela({ titulo, onFechar, children, testid, largura = 440 }: { titulo: string; onFechar: () => void; children: React.ReactNode; testid?: string; largura?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[#111827]/60 p-4" data-testid={testid}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-[3px] border border-border bg-white shadow-xl" style={{ maxWidth: largura }}>
        <div className="flex items-center justify-between border-b border-border px-[16px] py-[12px]">
          <h2 className="text-[15px] font-bold text-text-main">{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="grid h-[32px] w-[32px] place-items-center text-[18px] text-text-subtle hover:text-text-main">×</button>
        </div>
        <div className="px-[16px] py-[14px]">{children}</div>
      </div>
    </div>
  )
}

export const botao = {
  primario: 'h-[38px] rounded-[3px] bg-primary px-[14px] text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark disabled:opacity-60',
  secundario: 'h-[38px] rounded-[3px] border border-border bg-white px-[14px] text-[11px] font-semibold uppercase tracking-wide text-text-main hover:border-primary hover:text-primary disabled:opacity-60',
  perigo: 'h-[38px] rounded-[3px] bg-[#EF4444] px-[14px] text-[11px] font-semibold uppercase tracking-wide text-white hover:opacity-90 disabled:opacity-60',
  sucesso: 'h-[38px] rounded-[3px] bg-[#10B981] px-[14px] text-[11px] font-semibold uppercase tracking-wide text-white hover:opacity-90 disabled:opacity-60',
}
