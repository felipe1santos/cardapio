'use client'

import { useEffect, useState } from 'react'
import { paraCentavos, formatarCentavos } from '@/lib/financeiro/centavos'
import { TecladoPin } from '@/components/admin/teclado-pin'
import { FIN_BTN, FIN_COR } from '@/components/graficos/kit-meta'

/** Campo de dinheiro: a pessoa digita "150" ou "150,50"; a tela devolve centavos (ou null). */
export function CampoDinheiro({ valor, onMudar, rotulo, testid, autoFocus }: {
  valor: string; onMudar: (texto: string, centavos: number | null) => void; rotulo: string; testid?: string; autoFocus?: boolean
}) {
  const c = valor.trim() ? paraCentavos(valor) : null
  return (
    <label className="block">
      <span className="mb-[6px] block text-[13px] font-semibold" style={{ color: FIN_COR.texto }}>{rotulo}</span>
      <div className="flex h-[40px] items-center rounded-[6px] border border-[#CBD2D9] bg-white px-[12px] transition-[border-color,box-shadow] duration-150 hover:border-[#9AA6B1] focus-within:border-[#0A78BE] focus-within:shadow-[0_0_0_1px_#0A78BE]">
        <span className="mr-[6px] text-[14px]" style={{ color: FIN_COR.texto2 }}>R$</span>
        <input inputMode="decimal" autoFocus={autoFocus} className="h-full w-full bg-transparent text-[15px] font-semibold text-text-main outline-none focus-visible:!shadow-none" placeholder="0,00"
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
      <div className="fin-card border-l-[3px] p-[14px]" style={{ borderLeftColor: '#D47B04' }} data-testid="aprovacao-remota">
        <p className="text-[14px] font-semibold" style={{ color: FIN_COR.texto }}>{titulo}</p>
        {esperando.status === 'pendente' && <p className="mt-[4px] text-[13px] text-text-main" data-testid="aprovacao-remota-esperando">Pedido enviado. Aguardando o gerente ou o dono aprovar no celular… (vale 10 minutos)</p>}
        {esperando.status === 'aprovado' && <p className="mt-[4px] text-[13px] font-semibold" style={{ color: FIN_COR.verde }}>Aprovado por {esperando.aprovador}.</p>}
        {esperando.status === 'recusado' && <p className="mt-[4px] text-[13px] font-semibold text-danger" data-testid="aprovacao-remota-recusada">Recusado por {esperando.aprovador}{esperando.motivo ? `: ${esperando.motivo}` : '.'}</p>}
        {['expirado', 'usado', 'cancelado'].includes(esperando.status) && <p className="mt-[4px] text-[13px] text-danger">O pedido expirou. Peça de novo.</p>}
        {erro && <p className="mt-[4px] text-[12px] text-danger">{erro}</p>}
        <div className="mt-[10px] flex flex-wrap gap-2">
          <button type="button" onClick={() => setEsperando(null)} className={FIN_BTN.contorno}>Aprovar aqui com PIN</button>
          <button type="button" onClick={onCancelar} className={FIN_BTN.texto}>Cancelar</button>
        </div>
      </div>
    )
  }
  return (
    <div className="fin-card border-l-[3px] p-[14px]" style={{ borderLeftColor: '#D47B04' }} data-testid="aprovacao-pin">
      <p className="text-[14px] font-semibold" style={{ color: FIN_COR.texto }}>{titulo}</p>
      {!quem ? (
        <>
          <p className="mb-[8px] mt-[2px] text-[12px] text-text-subtle">Chame quem vai aprovar e escolha o nome dele.</p>
          {lista === null ? <p className="text-[12px] text-text-subtle">Carregando…</p>
            : lista.length === 0 ? <p className="text-[12px] text-danger">Ninguém com PIN pode aprovar. O gerente ou o dono precisa criar o PIN em Minha conta.</p>
            : (
              <div className="grid gap-[6px]">
                {lista.map((a) => (
                  <button key={a.id} type="button" data-testid="aprovador" onClick={() => setQuem(a)}
                    className="h-[40px] rounded-[6px] border border-[#CBD2D9] bg-white px-[12px] text-left text-[14px] font-semibold text-text-main hover:bg-[#F5F6F7] active:bg-[#E4E7EA]">{a.nome}</button>
                ))}
              </div>
            )}
        </>
      ) : (
        <div className="mt-[8px] rounded-[6px] bg-[#F5F7F9] p-[12px]">
          <p className="mb-[8px] text-center text-[13px] text-text-subtle">PIN de <b className="text-text-main">{quem.nome}</b></p>
          <TecladoPin valor={pin} onMudar={setPin} onCompleto={(p) => onConfirmar({ aprovadorId: quem.id, pin: p })} ocupado={ocupado} erro={erro} />
          <button type="button" onClick={() => { setQuem(null); setPin('') }} className={`${FIN_BTN.texto} mt-[8px] w-full`}>Trocar aprovador</button>
        </div>
      )}
      {remoto && !quem && (
        <button type="button" onClick={() => void pedirRemoto()} data-testid="aprovacao-pedir-celular"
          className={`${FIN_BTN.primario} mt-[10px] w-full`}>Pedir pelo celular do gerente/dono</button>
      )}
      {erroRemoto && <p className="mt-[4px] text-[12px] text-danger">{erroRemoto}</p>}
      <button type="button" onClick={onCancelar} className={`${FIN_BTN.texto} mt-[8px]`}>Cancelar</button>
    </div>
  )
}

/** Janela central do Financeiro no estilo Meta (cantos de 8px, sombra, título forte). Leva o tema .fin-meta junto. */
export function Janela({ titulo, onFechar, children, testid, largura = 440 }: { titulo: string; onFechar: () => void; children: React.ReactNode; testid?: string; largura?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])
  return (
    <div className="fin-meta fixed inset-0 z-[95] flex items-center justify-center !bg-[rgba(28,43,51,0.55)] p-4" data-testid={testid}>
      <div role="dialog" aria-modal="true" aria-label={titulo} className="max-h-[92vh] w-full overflow-y-auto rounded-[8px] bg-white shadow-[0_8px_28px_rgba(28,43,51,0.28)]" style={{ maxWidth: largura }}>
        <div className="flex items-center justify-between gap-3 border-b border-[#E4E7EA] px-[20px] py-[14px]">
          <h2 className="text-[18px] font-semibold" style={{ color: FIN_COR.texto }}>{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="grid h-[32px] w-[32px] place-items-center rounded-[6px] text-[20px] hover:bg-[#F5F6F7] active:bg-[#E4E7EA]" style={{ color: FIN_COR.texto2 }}>×</button>
        </div>
        <div className="px-[20px] py-[16px]">{children}</div>
      </div>
    </div>
  )
}

/** Botões do Financeiro = os do kit Meta (components/financeiro/ui/meta.tsx). */
export const botao = {
  primario: FIN_BTN.primario,
  secundario: FIN_BTN.contorno,
  perigo: FIN_BTN.perigo,
  /** "Abrir caixa", "Confirmar": o verde de ação da Meta (#006B4E). */
  sucesso: FIN_BTN.acao,
}
