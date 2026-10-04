'use client'

import { useCallback, useEffect, useState } from 'react'
import { CampoDinheiro, Janela, botao, brl } from './apoio'

/**
 * Financeiro › Acerto de Motoboys e Conferir Pix (Fase 3). A tela pede; o servidor calcula e decide.
 * Acerto às cegas: quem só faz o acerto conta o dinheiro antes de ver quanto era esperado.
 */
interface Moto {
  entregadorId: string; nome: string; desativado: boolean
  saldoCentavos?: number; temDinheiro?: boolean
  pedidos: { pedidoId: string; numero: number | null; saldoCentavos?: number }[]
  semPedidoCentavos?: number; trocoLevadoCentavos?: number; recebidoCentavos?: number; trocoDadoCentavos?: number
}
interface SemRegistro { pedidoId: string; numero: number; totalCentavos: number; forma: string; trocoPara: number | null; cliente: string; entregador: string | null; nexta: boolean }
interface Estado {
  modo: { modo: 'pedido' | 'fundo'; proximo: 'pedido' | 'fundo' | null; fundoPadraoCentavos: number }
  veValores: boolean; papel: string; motoboys: Moto[]; semRegistro: SemRegistro[]
  nexta: { id: number; valorCentavos: number; numero: number | null; em: string }[]
}
/** Tem dinheiro para acertar (com ou sem permissão de ver o valor). Esses vêm primeiro na lista. */
const temDin = (m: Moto) => (m.saldoCentavos ?? 0) !== 0 || !!m.temDinheiro
const post = async (url: string, corpo: Record<string, unknown>) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  return { s: r.status, j: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const ROTULO: Record<string, string> = { dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix' }

export function SecaoMotoboys() {
  const [e, setE] = useState<Estado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [acertando, setAcertando] = useState<Moto | null>(null)
  const [troco, setTroco] = useState<{ m: Moto; motivo: 'fundo' | 'complemento' } | null>(null)
  const [registrando, setRegistrando] = useState<SemRegistro | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/financeiro/motoboys', { cache: 'no-store' }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) { setErro(j.error ?? 'Não foi possível carregar.'); return }
    setErro(null); setE(j)
  }, [])
  useEffect(() => { void carregar() }, [carregar])
  const pronto = (msg?: string) => { setAcertando(null); setTroco(null); setRegistrando(null); if (msg) setAviso(msg); void carregar(); window.dispatchEvent(new Event('menuzia:caixa-mudou')) }

  if (erro) return <p className="text-[13px] text-danger">{erro}</p>
  if (!e) return <p className="text-[13px] text-text-subtle">Carregando…</p>
  const cartao = 'fin-card'
  const gestor = e.papel === 'dono' || e.papel === 'gerente'

  return (
    <>
      {aviso && <p className="fin-card border-l-[3px] !border-l-[#4DBBA6] px-4 py-2.5 text-[14px] font-semibold text-[#006B4E]" data-testid="motoboys-aviso">{aviso}</p>}
      <section className={cartao} data-testid="motoboys-modo">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-[13px] font-bold text-text-main">Troco do motoboy: {e.modo.modo === 'pedido' ? 'por pedido' : `fundo fixo (${brl(e.modo.fundoPadraoCentavos)})`}</p>
            <p className="text-[12px] text-text-subtle">{e.modo.modo === 'pedido' ? 'No despacho de um pedido em dinheiro, o troco sai da gaveta para o motoboy (valor editável).' : 'No início do turno, o motoboy recebe o fundo; complemente quando faltar.'}
              {e.modo.proximo && <b className="text-[#8A4B00]"> Muda para {e.modo.proximo === 'pedido' ? '"por pedido"' : '"fundo fixo"'} no próximo caixa.</b>}</p>
          </div>
          {gestor && (
            <div className="flex gap-2">
              {(['pedido', 'fundo'] as const).map((m) => (
                <button key={m} type="button" className={e.modo.modo === m ? botao.primario : botao.secundario} data-testid={`modo-${m}`}
                  onClick={async () => { const r = await post('/api/admin/financeiro/motoboys', { acao: 'modo', modo: m }); setAviso(r.s === 200 ? (r.j.imediato ? 'Modo trocado.' : 'Vale a partir do próximo caixa (há motoboy com dinheiro).') : String(r.j.error)); void carregar() }}>
                  {m === 'pedido' ? 'Por pedido' : 'Fundo fixo'}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className={cartao} data-testid="motoboys-lista">
        <h2 className="border-b border-border px-4 py-3 text-[13px] font-bold text-text-main">Motoboys</h2>
        {e.motoboys.length === 0 ? <p className="px-4 py-3 text-[13px] text-text-subtle">Nenhum motoboy cadastrado.</p> : (
          <ul className="divide-y divide-border">
            {[...e.motoboys].sort((a, b) => Number(temDin(b)) - Number(temDin(a))).map((m) => (
              <li key={m.entregadorId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="motoboy-linha">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-text-main">{m.nome}{m.desativado && <span className="ml-1 text-[11px] text-danger">(desativado)</span>}</p>
                  <p className="text-[12px] text-text-subtle">
                    {m.pedidos.length} entrega(s) a acertar
                    {e.veValores && m.saldoCentavos !== undefined && <> · com ele: <b className="text-text-main">{brl(m.saldoCentavos)}</b> (troco {brl(m.trocoLevadoCentavos ?? 0)}, recebeu {brl(m.recebidoCentavos ?? 0)}, deu de troco {brl(m.trocoDadoCentavos ?? 0)})</>}
                    {!e.veValores && (m.temDinheiro ? ' · tem dinheiro para acertar' : ' · sem dinheiro')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {e.modo.modo === 'fundo' && <button type="button" className={botao.secundario} onClick={() => setTroco({ m, motivo: 'fundo' })} data-testid="mb-fundo">Entregar fundo</button>}
                  <button type="button" className={botao.secundario} onClick={() => setTroco({ m, motivo: 'complemento' })} data-testid="mb-complemento">Complementar troco</button>
                  <button type="button" className={botao.primario} onClick={() => setAcertando(m)} data-testid="mb-acertar" disabled={!(m.temDinheiro ?? (m.saldoCentavos !== 0))}>Acertar</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cartao} data-testid="sem-registro">
        <h2 className="border-b border-border px-4 py-3 text-[13px] font-bold text-text-main">Entregas sem pagamento registrado (sem app, sem motoboy, Nexta)</h2>
        {e.semRegistro.length === 0 ? <p className="px-4 py-3 text-[13px] text-text-subtle">Nada pendente.</p> : (
          <ul className="divide-y divide-border">
            {e.semRegistro.map((p) => (
              <li key={p.pedidoId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]" data-testid="sem-registro-linha">
                <span>#{p.numero} · {p.cliente} · {brl(p.totalCentavos)} · {ROTULO[p.forma] ?? p.forma}{p.nexta ? ' · Nexta' : p.entregador ? ` · ${p.entregador}` : ' · sem motoboy'}</span>
                <button type="button" className={botao.secundario} onClick={() => setRegistrando(p)} data-testid="registrar-entrega">Registrar recebimento</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {e.nexta.length > 0 && (
        <section className={cartao} data-testid="nexta-a-receber">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-bold text-text-main">Nexta: a receber ({e.nexta.length})</h2>
            <button type="button" className={botao.sucesso} data-testid="repasse-nexta"
              onClick={async () => { const r = await post('/api/admin/financeiro/motoboys', { acao: 'repasse_nexta', lancamentoIds: e.nexta.map((n) => n.id), chave: crypto.randomUUID() }); pronto(r.s === 200 ? 'Repasse da Nexta registrado na gaveta.' : String(r.j.error)) }}>
              Repasse recebido
            </button>
          </div>
          <ul className="divide-y divide-border text-[13px]">{e.nexta.map((n) => <li key={n.id} className="px-4 py-2">#{n.numero ?? '—'} · {brl(n.valorCentavos)}</li>)}</ul>
        </section>
      )}

      {acertando && <JanelaAcerto m={acertando} dono={e.papel === 'dono'} onFechar={() => setAcertando(null)} onPronto={pronto} />}
      {troco && <JanelaTroco m={troco.m} motivo={troco.motivo} padrao={troco.motivo === 'fundo' ? e.modo.fundoPadraoCentavos : 0} onFechar={() => setTroco(null)} onPronto={pronto} />}
      {registrando && <JanelaRegistro p={registrando} onFechar={() => setRegistrando(null)} onPronto={pronto} />}
    </>
  )
}

function JanelaAcerto({ m, dono, onFechar, onPronto }: { m: Moto; dono: boolean; onFechar: () => void; onPronto: (msg?: string) => void }) {
  const [txt, setTxt] = useState(''); const [c, setC] = useState<number | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [res, setRes] = useState<{ esperado_centavos: number; contado_centavos: number; diferenca_centavos: number } | null>(null)
  const [erro, setErro] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false)
  const [baixa, setBaixa] = useState(''); const [chave] = useState(() => crypto.randomUUID())
  async function acertar() {
    if (c === null) return setErro('Informe o dinheiro contado (pode ser 0).')
    setOcupado(true)
    const r = await post('/api/admin/financeiro/motoboys', { acao: 'acertar', entregadorId: m.entregadorId, contadoCentavos: c, pedidoIds: sel.length ? sel : null, chave })
    setOcupado(false)
    if (r.s !== 200) return setErro(String(r.j.error ?? 'Não foi possível acertar.'))
    setRes(r.j as never)
  }
  return (
    <Janela titulo={`Acerto — ${m.nome}`} onFechar={onFechar} testid="janela-acerto" largura={480}>
      {!res ? (
        <>
          <p className="mb-[10px] text-[13px] text-text-subtle">Conte o dinheiro que o motoboy entregou. O sistema só mostra quanto era esperado <b>depois</b>.</p>
          {m.pedidos.length > 1 && (
            <div className="mb-[10px]">
              <p className="mb-1 text-[12.5px] font-semibold text-text-subtle">Acertar só algumas entregas (opcional)</p>
              <div className="flex flex-wrap gap-1.5">
                {m.pedidos.map((p) => (
                  <button key={p.pedidoId} type="button" onClick={() => setSel((s) => s.includes(p.pedidoId) ? s.filter((x) => x !== p.pedidoId) : [...s, p.pedidoId])}
                    className={`h-[32px] rounded-[3px] border px-2 text-[12px] font-semibold ${sel.includes(p.pedidoId) ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>#{p.numero}</button>
                ))}
              </div>
            </div>
          )}
          <CampoDinheiro rotulo="Dinheiro contado" valor={txt} onMudar={(t, v) => { setTxt(t); setC(v) }} testid="acerto-contado" autoFocus />
          {erro && <p className="mt-2 text-[12px] font-medium text-danger">{erro}</p>}
          <div className="mt-[14px] flex justify-end gap-2">
            <button type="button" className={botao.secundario} onClick={onFechar}>Cancelar</button>
            <button type="button" className={botao.primario} disabled={ocupado} onClick={() => void acertar()} data-testid="acerto-confirmar">Conferir</button>
          </div>
        </>
      ) : (
        <div data-testid="acerto-resultado">
          <p className={`text-[15px] font-bold ${res.diferenca_centavos === 0 ? 'text-[#006B4E]' : 'text-[#D93616]'}`}>
            {res.diferenca_centavos === 0 ? 'Acerto concluído: bateu.' : `${res.diferenca_centavos < 0 ? 'Faltou' : 'Sobrou'} ${brl(Math.abs(res.diferenca_centavos))} — ficou como pendência do motoboy.`}
          </p>
          <p className="mt-1 text-[13px] text-text-subtle">Esperado {brl(res.esperado_centavos)} · contado {brl(res.contado_centavos)}</p>
          {res.diferenca_centavos !== 0 && dono && (
            <div className="mt-3 rounded-[3px] border border-border p-2">
              <p className="text-[12px] font-semibold">Dar baixa (só o dono, com motivo)</p>
              <textarea className="mt-1 min-h-[60px] w-full rounded-[3px] border border-border p-2 text-[13px]" value={baixa} onChange={(ev) => setBaixa(ev.target.value.slice(0, 300))} data-testid="baixa-motivo" />
              <button type="button" className={`${botao.perigo} mt-2`} disabled={baixa.trim().length < 10} data-testid="baixa-confirmar"
                onClick={async () => { const r = await post('/api/admin/financeiro/motoboys', { acao: 'baixar', entregadorId: m.entregadorId, motivo: baixa, chave: crypto.randomUUID() }); onPronto(r.s === 200 ? 'Baixa registrada.' : String(r.j.error)) }}>Dar baixa</button>
            </div>
          )}
          <div className="mt-[14px] flex justify-end"><button type="button" className={botao.primario} onClick={() => onPronto()} data-testid="acerto-ok">OK</button></div>
        </div>
      )}
    </Janela>
  )
}

function JanelaTroco({ m, motivo, padrao, onFechar, onPronto }: { m: Moto; motivo: 'fundo' | 'complemento'; padrao: number; onFechar: () => void; onPronto: (msg?: string) => void }) {
  const [txt, setTxt] = useState(padrao ? (padrao / 100).toFixed(2).replace('.', ',') : ''); const [c, setC] = useState<number | null>(padrao || null)
  const [erro, setErro] = useState<string | null>(null); const [chave] = useState(() => crypto.randomUUID())
  return (
    <Janela titulo={motivo === 'fundo' ? `Fundo de troco — ${m.nome}` : `Complementar troco — ${m.nome}`} onFechar={onFechar} testid="janela-troco">
      <p className="mb-[10px] text-[13px] text-text-subtle">O valor sai da gaveta e fica com o motoboy até o acerto.</p>
      <CampoDinheiro rotulo="Valor" valor={txt} onMudar={(t, v) => { setTxt(t); setC(v) }} testid="troco-valor" autoFocus />
      {erro && <p className="mt-2 text-[12px] font-medium text-danger">{erro}</p>}
      <div className="mt-[14px] flex justify-end gap-2">
        <button type="button" className={botao.secundario} onClick={onFechar}>Cancelar</button>
        <button type="button" className={botao.primario} data-testid="troco-confirmar"
          onClick={async () => { if (!c) return setErro('Informe o valor.'); const r = await post('/api/admin/financeiro/motoboys', { acao: 'troco', entregadorId: m.entregadorId, valorCentavos: c, motivo, chave }); if (r.s !== 200) return setErro(String(r.j.error)); onPronto('Troco entregue ao motoboy.') }}>Entregar</button>
      </div>
    </Janela>
  )
}

function JanelaRegistro({ p, onFechar, onPronto }: { p: SemRegistro; onFechar: () => void; onPronto: (msg?: string) => void }) {
  const [forma, setForma] = useState<string>(p.forma === 'cartao' ? 'cartao' : p.forma === 'pix' ? 'pix' : 'dinheiro')
  const [txt, setTxt] = useState((p.trocoPara ?? p.totalCentavos / 100).toFixed(2).replace('.', ',')); const [c, setC] = useState<number | null>(Math.round((p.trocoPara ?? p.totalCentavos / 100) * 100))
  const [nsu, setNsu] = useState(''); const [motivo, setMotivo] = useState(''); const [erro, setErro] = useState<string | null>(null)
  const [chave] = useState(() => crypto.randomUUID())
  return (
    <Janela titulo={`Registrar recebimento — #${p.numero}`} onFechar={onFechar} testid="janela-registro">
      <p className="mb-2 text-[13px] text-text-subtle">Total {brl(p.totalCentavos)}{p.nexta ? ' · entregue pela Nexta (dinheiro fica a receber até o repasse)' : ''}</p>
      <div className="mb-2 grid grid-cols-2 gap-2">
        {[['dinheiro', 'Dinheiro'], ['cartao', 'Cartão'], ['pix', 'Pix (a conferir)'], ['nao_pago', 'Não pagou']].map(([f, r]) => (
          <button key={f} type="button" aria-pressed={forma === f} onClick={() => setForma(f)} data-testid={`reg-${f}`}
            className={`h-[40px] rounded-[3px] border text-[13px] font-semibold ${forma === f ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>{r}</button>
        ))}
      </div>
      {forma === 'dinheiro' && <CampoDinheiro rotulo="Cliente pagou com" valor={txt} onMudar={(t, v) => { setTxt(t); setC(v) }} testid="reg-recebido" />}
      {forma === 'cartao' && <input placeholder="NSU (se tiver)" value={nsu} onChange={(ev) => setNsu(ev.target.value.slice(0, 40))} className="h-[40px] w-full rounded-[3px] border border-border px-2 text-[13px]" />}
      {forma === 'nao_pago' && <textarea placeholder="Motivo" value={motivo} onChange={(ev) => setMotivo(ev.target.value.slice(0, 300))} className="min-h-[60px] w-full rounded-[3px] border border-border p-2 text-[13px]" />}
      {erro && <p className="mt-2 text-[12px] font-medium text-danger">{erro}</p>}
      <div className="mt-[14px] flex justify-end gap-2">
        <button type="button" className={botao.secundario} onClick={onFechar}>Cancelar</button>
        <button type="button" className={botao.primario} data-testid="reg-confirmar"
          onClick={async () => { const r = await post('/api/admin/financeiro/motoboys', { acao: 'registrar', pedidoId: p.pedidoId, forma, recebidoCentavos: forma === 'dinheiro' ? c : null, nsu, motivo, chave }); if (r.s !== 200) return setErro(String(r.j.error)); onPronto('Recebimento registrado.') }}>Registrar</button>
      </div>
    </Janela>
  )
}

export function SecaoPix() {
  const [lista, setLista] = useState<{ id: number; valorCentavos: number; numero: number | null; origem: string; registradoPor: string; em: string }[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [motivo, setMotivo] = useState<Record<number, string>>({})
  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/financeiro/pix', { cache: 'no-store' }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) { setErro(j.error ?? 'Não foi possível carregar.'); return }
    setErro(null); setLista(j.pix)
  }, [])
  useEffect(() => { void carregar() }, [carregar])
  if (erro) return <p className="text-[13px] text-danger">{erro}</p>
  if (!lista) return <p className="text-[13px] text-text-subtle">Carregando…</p>
  return (
    <section className="fin-card" data-testid="pix-lista">
      <h2 className="border-b border-border px-4 py-3 text-[13px] font-bold text-text-main">Pix a conferir — confira no banco antes de confirmar</h2>
      {lista.length === 0 ? <p className="px-4 py-3 text-[13px] text-text-subtle">Nenhum Pix esperando conferência.</p> : (
        <ul className="divide-y divide-border">
          {lista.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]" data-testid="pix-linha">
              <span><b>{brl(p.valorCentavos)}</b> · {p.numero ? `#${p.numero} · ` : ''}{p.origem} · registrado por {p.registradoPor} · {new Date(p.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              <span className="flex flex-wrap items-center gap-2">
                <input placeholder="motivo se não caiu" value={motivo[p.id] ?? ''} onChange={(ev) => setMotivo((m) => ({ ...m, [p.id]: ev.target.value.slice(0, 200) }))} className="h-[32px] w-[150px] rounded-[3px] border border-border px-2 text-[12px]" />
                <button type="button" className={botao.secundario} data-testid="pix-nao-caiu" onClick={async () => { await post('/api/admin/financeiro/pix', { lancamentoId: p.id, caiu: false, motivo: motivo[p.id] ?? '' }); void carregar() }}>Não caiu</button>
                <button type="button" className={botao.sucesso} data-testid="pix-caiu" onClick={async () => { await post('/api/admin/financeiro/pix', { lancamentoId: p.id, caiu: true }); void carregar() }}>Caiu</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
