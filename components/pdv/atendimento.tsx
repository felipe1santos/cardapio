'use client'

import { useRef, useState } from 'react'
import { chamar, horaCurta, mascararTelefone, novaChave } from './util'
import { NomeClienteComSugestoes } from './nome-cliente-sugestoes'
import { ICONES_PDV, TelaPdv } from './tela-pdv'

/**
 * Identificação do atendimento (0094) e mesa em limpeza (0095): três modais pequenos,
 * usados pelo PDV e pelo painel do garçom.
 *
 *  · AbrirMesaModal     — mesa livre só abre com o nome do cliente (telefone opcional);
 *  · IdentificarModal   — corrigir nome/telefone, ou completar conta antiga sem nome;
 *  · LimpezaModal       — mesa laranja: último cliente, quando e quem fechou, liberar.
 */

const CAMPO =
  'w-full rounded-menuzia border border-border px-3 py-2.5 text-[15px] text-text-main placeholder:text-text-subtle/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
const ROTULO = 'mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle'

function Casca({ titulo, rotulo, onFechar, children, rodape, onSubmit }: {
  titulo: string
  rotulo: string
  onFechar: () => void
  children: React.ReactNode
  rodape: React.ReactNode
  onSubmit?: (e: React.FormEvent) => void
}) {
  // Tela da pilha do PDV (2026-10-01): cobre a de trás, Voltar/Esc/voltar do navegador.
  return (
    <TelaPdv titulo={titulo} onVoltar={onFechar} comoFormulario={onSubmit ?? ((e) => e.preventDefault())} larguraMax={720}
      rodape={<div className="flex gap-2 [&>button]:min-h-[56px] [&>button]:text-[15px]">{rodape}</div>}>
      <div className="space-y-4 px-5 py-5 [&_input]:min-h-[52px] [&_input]:text-[16px]" aria-label={rotulo}>{children}</div>
    </TelaPdv>
  )
}

function CamposCliente({ nome, setNome, telefone, setTelefone, prefixo }: {
  nome: string
  setNome: (v: string) => void
  telefone: string
  setTelefone: (v: string) => void
  prefixo: string
}) {
  return (
    <>
      <label className="block">
        <span className={ROTULO}>
          Nome do cliente <span className="text-danger">*</span>
        </span>
        <NomeClienteComSugestoes nome={nome} setNome={setNome} setTelefone={setTelefone} testid={`${prefixo}-nome`} className={CAMPO} />
      </label>
      <label className="block">
        <span className={ROTULO}>Telefone (opcional)</span>
        <input
          value={telefone}
          inputMode="tel"
          onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
          placeholder="(27) 99999-8888"
          data-testid={`${prefixo}-telefone`}
          className={CAMPO}
        />
      </label>
    </>
  )
}

const BOTAO_SEC = 'flex flex-1 items-center justify-center gap-2 rounded-menuzia border border-border py-3 text-[13px] font-semibold text-text-subtle hover:text-text-main'
const BOTAO_OK = 'flex flex-[2] items-center justify-center gap-2 rounded-menuzia bg-status-ready py-3 text-[14px] font-bold text-white transition-all hover:brightness-95 disabled:opacity-50'

function Erro({ texto, id }: { texto: string | null; id: string }) {
  if (!texto) return null
  return (
    <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger" data-testid={id}>
      {texto}
    </p>
  )
}

/** Mesa livre → atendimento aberto com nome. Dois operadores: o segundo cai na conta do primeiro. */
export function AbrirMesaModal({ mesa, onFechar, onAberta, onOcupada }: {
  mesa: { id: string; nome: string }
  onFechar: () => void
  onAberta: (comandaId: string, nome: string) => void
  /** Outro operador abriu antes: mostra a conta dele. */
  onOcupada: (comandaId: string | null) => void
}) {
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const chave = useRef(novaChave())

  async function abrir(e: React.FormEvent) {
    e.preventDefault()
    if (enviando) return
    if (!nome.trim()) return setErro('Informe o nome do cliente.')
    setEnviando(true)
    setErro(null)
    const r = await chamar<{ comandaId: string }>(`/api/admin/mesas/${mesa.id}/atendimento`, {
      method: 'POST',
      body: JSON.stringify({ acao: 'abrir', nome, telefone: telefone || undefined, chave: chave.current }),
    })
    setEnviando(false)
    if (r.ok && r.dados) return onAberta(r.dados.comandaId, nome.trim())
    if (r.codigo === 'mesa_ocupada') return onOcupada((r.corpo?.comandaId as string | undefined) ?? null)
    setErro(r.erro)
  }

  return (
    <Casca
      titulo={`Abrir ${mesa.nome}`}
      rotulo={`Abrir ${mesa.nome}`}
      onFechar={onFechar}
      onSubmit={abrir}
      rodape={
        <>
          <button type="button" onClick={onFechar} className={BOTAO_SEC}><svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden><path d={ICONES_PDV.voltar} /></svg>Cancelar</button>
          <button type="submit" disabled={enviando} data-testid="mesa-abrir" className={BOTAO_OK}>
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden><path d={ICONES_PDV.mais} /></svg>
            {enviando ? 'Abrindo…' : 'Abrir mesa'}
          </button>
        </>
      }
    >
      <CamposCliente nome={nome} setNome={setNome} telefone={telefone} setTelefone={setTelefone} prefixo="mesa" />
      <p className="text-[12px] text-text-subtle">Os próximos pedidos desta mesa usam este nome. Dá para corrigir depois na conta.</p>
      <Erro texto={erro} id="mesa-erro" />
    </Casca>
  )
}

/** Corrigir (ou completar) nome e telefone do atendimento. Fica na auditoria. */
export function IdentificarModal({ comandaId, titulo, nomeAtual, telefoneAtual, aviso, onFechar, onSalvo }: {
  comandaId: string
  titulo: string
  nomeAtual: string | null
  telefoneAtual: string | null
  aviso?: string
  onFechar: () => void
  onSalvo: (nome: string) => void
}) {
  const [nome, setNome] = useState(nomeAtual ?? '')
  const tel = (telefoneAtual ?? '').replace(/^55(?=\d{10,11}$)/, '')
  const [telefone, setTelefone] = useState(tel ? mascararTelefone(tel) : '')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (enviando) return
    if (!nome.trim()) return setErro('Informe o nome do cliente.')
    setEnviando(true)
    setErro(null)
    const r = await chamar(`/api/admin/comandas/${comandaId}`, {
      method: 'POST',
      body: JSON.stringify({ acao: 'identificar', nome, telefone: telefone || '' }),
    })
    setEnviando(false)
    if (!r.ok) return setErro(r.erro)
    onSalvo(nome.trim())
  }

  return (
    <Casca
      titulo={titulo}
      rotulo={titulo}
      onFechar={onFechar}
      onSubmit={salvar}
      rodape={
        <>
          <button type="button" onClick={onFechar} className={BOTAO_SEC}><svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden><path d={ICONES_PDV.voltar} /></svg>Cancelar</button>
          <button type="submit" disabled={enviando} data-testid="identificar-salvar" className={BOTAO_OK}>
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden><path d={ICONES_PDV.salvar} /></svg>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      {aviso && <p className="rounded-menuzia bg-warn-bg px-3 py-2 text-[12px] font-semibold text-text-main">{aviso}</p>}
      <CamposCliente nome={nome} setNome={setNome} telefone={telefone} setTelefone={setTelefone} prefixo="identificar" />
      <Erro texto={erro} id="identificar-erro" />
    </Casca>
  )
}

/** Mesa laranja: quem estava, quando fechou, quem fechou — e liberar. */
export function LimpezaModal({ mesa, podeLiberar, onFechar, onLiberada }: {
  mesa: { id: string; nome: string; limpeza: { desde: string; clienteNome: string | null; fechadaPorNome: string | null } | null }
  podeLiberar: boolean
  onFechar: () => void
  onLiberada: () => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function liberar() {
    if (enviando) return
    setEnviando(true)
    setErro(null)
    const r = await chamar(`/api/admin/mesas/${mesa.id}/atendimento`, { method: 'POST', body: JSON.stringify({ acao: 'liberar' }) })
    setEnviando(false)
    if (!r.ok) return setErro(r.erro)
    onLiberada()
  }

  const l = mesa.limpeza
  return (
    <Casca
      titulo={mesa.nome}
      rotulo={`${mesa.nome} em limpeza`}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" onClick={onFechar} className={BOTAO_SEC}><svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden><path d={ICONES_PDV.voltar} /></svg>Voltar</button>
          {podeLiberar && (
            <button type="button" onClick={liberar} disabled={enviando} data-testid="mesa-liberar" className={BOTAO_OK}>
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden><path d={ICONES_PDV.check} /></svg>
              {enviando ? 'Liberando…' : 'Tornar mesa disponível'}
            </button>
          )}
        </>
      }
    >
      <span className="inline-block rounded-menuzia bg-status-pending px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white" data-testid="limpeza-badge">
        Em limpeza
      </span>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]" data-testid="limpeza-detalhe">
        <dt className="text-text-subtle">Último cliente</dt>
        <dd className="font-semibold text-text-main">{l?.clienteNome || '—'}</dd>
        <dt className="text-text-subtle">Conta fechada às</dt>
        <dd className="font-semibold text-text-main">{l ? horaCurta(l.desde) : '—'}</dd>
        <dt className="text-text-subtle">Responsável pelo fechamento</dt>
        <dd className="font-semibold text-text-main">{l?.fechadaPorNome || '—'}</dd>
      </dl>
      <p className="text-[12px] text-text-subtle">
        Enquanto estiver em limpeza, a mesa não abre atendimento e o QR avisa que ela ficará disponível em breve.
      </p>
      <Erro texto={erro} id="limpeza-erro" />
    </Casca>
  )
}
