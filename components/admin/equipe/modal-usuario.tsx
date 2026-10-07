'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, KeyRound, Search, ShieldCheck, X } from 'lucide-react'
import { ToggleSwitch } from '@/components/admin/campos-ajustes'
import type { Acessos } from '@/lib/acessos'
import {
  CARGOS, GRUPOS_PERMISSOES, ROTULO_CARGO, alternarPermissao, contarPermissoes, mesmosAcessos, modeloDoCargo, temPermissao,
  type Cargo, type ItemPermissao,
} from '@/lib/equipe-cargos'

/**
 * Modal de usuário da Equipe (repaginação 2026-10): duas colunas — Informações à esquerda,
 * Permissões em cartões com toggle à direita — e rodapé fixo. No celular vira tela cheia,
 * uma coluna embaixo da outra.
 */

export interface UsuarioEquipe {
  id: string
  nome: string
  usuario: string
  telefone: string
  cargo: Cargo
  acessos: Acessos | null
  temPin?: boolean
}

export interface SalvarUsuario {
  nome: string
  usuario: string
  senha: string
  telefone: string
  cargo: Cargo
  acessos: Acessos
}

const SENHA_MINIMA = 8

function formatarTelefone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function ModalUsuario({
  usuario,
  outros,
  podeEquipe,
  loginsEmUso,
  onCancelar,
  onSalvar,
  onRedefinirSenha,
  onApagarPin,
  financeiroAtivo = false,
}: {
  /** Null = adicionar. */
  usuario: UsuarioEquipe | null
  /** Outros usuários (para "Copiar permissões"). */
  outros: { id: string; nome: string; acessos: Acessos }[]
  /** Só o dono libera a área Equipe. */
  podeEquipe: boolean
  loginsEmUso: string[]
  onCancelar: () => void
  /** Devolve a mensagem de erro, ou null quando salvou. */
  onSalvar: (dados: SalvarUsuario) => Promise<string | null>
  onRedefinirSenha: (senha: string) => Promise<string | null>
  /** Apaga o PIN do funcionário (ele cria outro com a senha). */
  onApagarPin?: () => Promise<string | null>
  /** Loja com o módulo financeiro (0132): mostra o grupo Financeiro e o "Apagar PIN". */
  financeiroAtivo?: boolean
}) {
  const editando = !!usuario
  const cargoInicial: Cargo = usuario?.cargo ?? 'garcom'
  const acessosIniciais: Acessos = usuario?.acessos ?? modeloDoCargo(cargoInicial) ?? { areas: [], sensiveis: [] }
  const [nome, setNome] = useState(usuario?.nome ?? '')
  const [login, setLogin] = useState(usuario?.usuario ?? '')
  const [senha, setSenha] = useState('')
  const [telefone, setTelefone] = useState(formatarTelefone(usuario?.telefone ?? ''))
  const [cargo, setCargo] = useState<Cargo>(cargoInicial)
  const [acessos, setAcessos] = useState<Acessos>({ areas: [...acessosIniciais.areas], sensiveis: [...acessosIniciais.sensiveis] })
  const [busca, setBusca] = useState('')
  const [trocaPendente, setTrocaPendente] = useState<Cargo | null>(null)
  const [senhaAberta, setSenhaAberta] = useState(false)
  const [novaSenha, setNovaSenha] = useState('')
  const [senhaMsg, setSenhaMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [temPin, setTemPin] = useState(!!usuario?.temPin)
  const [tentou, setTentou] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const primeiro = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Só no cadastro: no celular, focar ao editar abriria o teclado por cima das permissões.
    if (!editando) primeiro.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onCancelar, editando])

  const total = contarPermissoes(acessos)
  const loginLimpo = login.trim().toLowerCase()
  const erros = {
    nome: nome.trim().length < 2 ? 'Informe o nome (mínimo 2 letras).' : null,
    login: editando ? null
      : !/^[a-z0-9._-]{3,30}$/.test(loginLimpo) ? 'De 3 a 30 caracteres: letras, números, ponto, hífen ou sublinhado.'
      : loginsEmUso.includes(loginLimpo) ? 'Esse login já está em uso.' : null,
    senha: editando ? null : senha.length < SENHA_MINIMA ? `Pelo menos ${SENHA_MINIMA} caracteres.` : null,
    permissoes: total === 0 ? 'Marque pelo menos uma permissão.' : null,
  }
  const valido = !Object.values(erros).some(Boolean)

  const mudou = !editando || nome !== usuario!.nome || telefone.replace(/\D/g, '') !== (usuario!.telefone ?? '') || cargo !== usuario!.cargo || !mesmosAcessos(acessos, acessosIniciais)

  function escolherCargo(novo: Cargo) {
    const modelo = modeloDoCargo(novo)
    if (!modelo) { setCargo(novo); return }
    const ajustado = { areas: modelo.areas.filter((a) => podeEquipe || a !== 'equipe'), sensiveis: modelo.sensiveis }
    // Já tem permissões diferentes do modelo: pergunta antes de substituir.
    if (total > 0 && !mesmosAcessos(acessos, ajustado)) { setTrocaPendente(novo); return }
    setCargo(novo)
    setAcessos(ajustado)
  }

  function confirmarTroca(substituir: boolean) {
    const novo = trocaPendente!
    setCargo(novo)
    if (substituir) {
      const m = modeloDoCargo(novo)!
      setAcessos({ areas: m.areas.filter((a) => podeEquipe || a !== 'equipe'), sensiveis: m.sensiveis })
    }
    setTrocaPendente(null)
  }

  async function salvar() {
    setTentou(true)
    if (!valido || salvando) return
    setSalvando(true)
    setErro(null)
    const e = await onSalvar({ nome: nome.trim(), usuario: loginLimpo, senha, telefone: telefone.replace(/\D/g, ''), cargo, acessos })
    setSalvando(false)
    if (e) setErro(e)
  }

  async function redefinir() {
    if (novaSenha.length < SENHA_MINIMA) { setSenhaMsg({ ok: false, texto: `Pelo menos ${SENHA_MINIMA} caracteres.` }); return }
    const e = await onRedefinirSenha(novaSenha)
    if (e) setSenhaMsg({ ok: false, texto: e })
    else { setSenhaMsg({ ok: true, texto: 'Senha redefinida. Passe a nova senha para a pessoa.' }); setNovaSenha(''); setSenhaAberta(false) }
  }

  const termo = busca.trim().toLowerCase()
  const grupos = useMemo(
    () => GRUPOS_PERMISSOES.filter((g) => !g.soComFinanceiro || financeiroAtivo).map((g) => ({ ...g, itens: g.itens.filter((i) => !termo || `${i.rotulo} ${i.descricao} ${g.titulo}`.toLowerCase().includes(termo)) })).filter((g) => g.itens.length),
    [termo, financeiroAtivo],
  )

  const marcarGrupo = (itens: ItemPermissao[], ligar: boolean) => {
    let a = acessos
    for (const i of itens) if (!(i.tipo === 'area' && i.chave === 'equipe' && !podeEquipe)) a = alternarPermissao(a, i, ligar)
    setAcessos(a)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/45 sm:items-center sm:p-4" onMouseDown={onCancelar} data-testid="modal-usuario">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-usuario-titulo"
        className="flex h-full w-full flex-col overflow-hidden bg-white sm:h-[min(860px,94vh)] sm:max-w-[1080px] sm:rounded-[8px] sm:shadow-[0_24px_64px_rgba(15,23,42,0.28)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-[#e5e7eb] px-5">
          <h2 id="modal-usuario-titulo" className="text-[17px] font-semibold text-[#1f2937]">{editando ? 'Editar usuário' : 'Adicionar usuário'}</h2>
          <button type="button" onClick={onCancelar} aria-label="Fechar" className="flex h-9 w-9 items-center justify-center rounded-[5px] text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#1f2937]">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* ── Coluna esquerda: informações ── */}
          <section className="flex-shrink-0 border-b border-[#e5e7eb] p-5 lg:w-[360px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <h3 className="mb-4 text-[14px] font-semibold text-[#1f2937]">Informações do usuário</h3>
            <div className="space-y-4">
              <Campo rotulo="Nome" erro={tentou ? erros.nome : null}>
                <input ref={primeiro} className="cf-campo" placeholder=" " value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} aria-invalid={tentou && !!erros.nome} data-testid="usuario-nome" />
              </Campo>
              <Campo rotulo="Login" erro={tentou || loginsEmUso.includes(loginLimpo) ? erros.login : null} dica={editando ? 'O login não muda depois de criado.' : 'É com ele que a pessoa entra no painel.'}>
                <input className="cf-campo font-mono" placeholder="joao.silva" value={login} disabled={editando} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  onChange={(e) => setLogin(e.target.value.toLowerCase().replace(/\s/g, ''))} aria-invalid={!!erros.login && (tentou || loginsEmUso.includes(loginLimpo))} data-testid="usuario-login" />
              </Campo>
              {!editando ? (
                <Campo rotulo="Senha" erro={tentou ? erros.senha : null} dica={`Mínimo de ${SENHA_MINIMA} caracteres. Passe para a pessoa pessoalmente.`}>
                  <input type="password" className="cf-campo" placeholder=" " value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" aria-invalid={tentou && !!erros.senha} data-testid="usuario-senha" />
                </Campo>
              ) : (
                <div>
                  {!senhaAberta ? (
                    <button type="button" onClick={() => { setSenhaAberta(true); setSenhaMsg(null) }} data-testid="usuario-redefinir-senha"
                      className="inline-flex h-10 items-center gap-2 rounded-[5px] border border-[#d6dae1] px-3 text-[13px] font-semibold text-[#374151] transition-colors hover:border-[#0688d4] hover:text-[#0688d4]">
                      <KeyRound className="h-4 w-4" /> Redefinir senha
                    </button>
                  ) : (
                    <div className="space-y-2 rounded-[6px] border border-[#e5e7eb] bg-[#f9fafb] p-3">
                      <Campo rotulo="Nova senha">
                        <input type="password" autoFocus className="cf-campo" placeholder=" " value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} autoComplete="new-password" data-testid="usuario-nova-senha" />
                      </Campo>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setSenhaAberta(false); setNovaSenha('') }} className="h-9 flex-1 rounded-[5px] border border-[#d6dae1] text-[13px] font-semibold text-[#374151] hover:bg-white">Cancelar</button>
                        <button type="button" onClick={() => void redefinir()} className="h-9 flex-1 rounded-[5px] bg-[#0688d4] text-[13px] font-semibold text-white hover:bg-[#0570ae]" data-testid="usuario-confirmar-senha">Redefinir</button>
                      </div>
                    </div>
                  )}
                  {financeiroAtivo && temPin && onApagarPin && (
                    <button type="button" data-testid="usuario-apagar-pin"
                      onClick={async () => { const e = await onApagarPin(); if (e) setSenhaMsg({ ok: false, texto: e }); else { setTemPin(false); setSenhaMsg({ ok: true, texto: 'PIN apagado. A pessoa cria outro em Minha conta → Meu PIN.' }) } }}
                      className="ml-2 inline-flex h-10 items-center gap-2 rounded-[5px] border border-[#d6dae1] px-3 text-[13px] font-semibold text-[#374151] transition-colors hover:border-[#ef4444] hover:text-[#ef4444]">
                      Apagar PIN
                    </button>
                  )}
                  {senhaMsg && <p className={`mt-1.5 text-[12px] ${senhaMsg.ok ? 'text-[#15803d]' : 'text-[#b91c1c]'}`} data-testid="usuario-senha-msg">{senhaMsg.texto}</p>}
                </div>
              )}
              <Campo rotulo="Telefone (opcional)">
                <input inputMode="tel" className="cf-campo" placeholder="(27) 99999-9999" value={telefone} onChange={(e) => setTelefone(formatarTelefone(e.target.value))} data-testid="usuario-telefone" />
              </Campo>
              <Campo rotulo="Cargo" dica="O cargo preenche um modelo de permissões. Dá para ajustar caixa por caixa ao lado.">
                <select className="cf-campo" value={cargo} onChange={(e) => escolherCargo(e.target.value as Cargo)} data-testid="usuario-cargo">
                  {CARGOS.filter((c) => c !== 'dono').map((c) => <option key={c} value={c}>{ROTULO_CARGO[c]}</option>)}
                </select>
              </Campo>
              {trocaPendente && (
                <div className="rounded-[6px] border border-[#fcd34d] bg-[#fffbeb] p-3 text-[12.5px] text-[#78350f]" role="alertdialog" data-testid="troca-cargo">
                  <p>Trocar as permissões atuais pelo modelo de <strong>{ROTULO_CARGO[trocaPendente]}</strong>?</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="h-9 flex-1 rounded-[5px] border border-[#d6dae1] bg-white text-[12.5px] font-semibold text-[#374151]" onClick={() => confirmarTroca(false)} data-testid="troca-manter">Manter as atuais</button>
                    <button type="button" className="h-9 flex-1 rounded-[5px] bg-[#0688d4] text-[12.5px] font-semibold text-white" onClick={() => confirmarTroca(true)} data-testid="troca-substituir">Substituir</button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── Coluna direita: permissões ── */}
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="flex-shrink-0 border-b border-[#e5e7eb] px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-[14px] font-semibold text-[#1f2937]">Permissões</h3>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-[#5b6472]" data-testid="permissoes-total">
                    <ShieldCheck className="h-4 w-4 text-[#0688d4]" />
                    {total === 1 ? '1 permissão concedida' : `${total} permissões concedidas`}
                  </p>
                </div>
                {outros.length > 0 && (
                  <label className="relative flex items-center">
                    <Copy className="pointer-events-none absolute left-2.5 h-4 w-4 text-[#6b7280]" />
                    <select
                      value=""
                      onChange={(e) => {
                        const o = outros.find((x) => x.id === e.target.value)
                        if (o) { setAcessos({ areas: o.acessos.areas.filter((a) => podeEquipe || a !== 'equipe'), sensiveis: [...o.acessos.sensiveis] }); setCargo('personalizado') }
                      }}
                      className="h-9 min-w-[200px] cursor-pointer appearance-none rounded-[5px] border border-[#d6dae1] bg-white pl-8 pr-3 text-[12.5px] font-semibold text-[#374151] hover:border-[#0688d4]"
                      aria-label="Copiar permissões de outro usuário"
                      data-testid="copiar-permissoes"
                    >
                      <option value="">Copiar permissões de…</option>
                      {outros.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar permissão" className="equipe-busca-permissao w-full" data-testid="busca-permissao" />
              </div>
              {tentou && erros.permissoes && <p className="mt-2 text-[12px] font-semibold text-[#b91c1c]" data-testid="erro-permissoes">{erros.permissoes}</p>}
            </div>
            <div className="min-h-0 flex-1 space-y-5 bg-[#fafbfc] px-5 py-4 lg:overflow-y-auto">
              {grupos.length === 0 && <p className="py-8 text-center text-[13px] text-[#6b7280]">Nenhuma permissão encontrada para “{busca}”.</p>}
              {grupos.map((g) => {
                const marcados = g.itens.filter((i) => temPermissao(acessos, i)).length
                return (
                  <div key={g.titulo}>
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#5b6472]">{g.titulo} <span className="font-semibold text-[#9ca3af]">· {marcados}/{g.itens.length}</span></h4>
                      <button type="button" className="text-[12px] font-semibold text-[#0688d4] hover:underline" onClick={() => marcarGrupo(g.itens, marcados < g.itens.length)}>
                        {marcados < g.itens.length ? 'Marcar todas' : 'Desmarcar todas'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                      {g.itens.map((i) => {
                        const bloqueada = i.tipo === 'area' && i.chave === 'equipe' && !podeEquipe
                        const on = temPermissao(acessos, i)
                        return (
                          <div key={`${i.tipo}-${i.chave}`}
                            className={['equipe-cartao-permissao flex items-center gap-3 rounded-[6px] border bg-white px-3.5 py-3', on ? 'border-[#9fd3f2]' : 'border-[#e5e7eb]', bloqueada ? 'opacity-55' : ''].join(' ')}
                            data-testid={`perm-${i.tipo}-${i.chave}`} data-on={on ? 'sim' : 'nao'}>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13.5px] font-semibold text-[#1f2937]">{i.rotulo}</div>
                              <div className="mt-0.5 text-[12px] leading-snug text-[#6b7280]">{bloqueada ? 'Só o dono libera.' : i.descricao}</div>
                            </div>
                            <ToggleSwitch checked={on} disabled={bloqueada} rotulo={i.rotulo} onChange={(v) => setAcessos(alternarPermissao(acessos, i, v))} />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        <footer className="flex flex-shrink-0 items-center gap-3 border-t border-[#e5e7eb] bg-white px-5 py-3">
          {erro ? <p className="min-w-0 flex-1 text-[12.5px] font-semibold text-[#b91c1c]" role="alert" data-testid="usuario-erro">{erro}</p> : <span className="flex-1" />}
          <button type="button" onClick={onCancelar} disabled={salvando} className="h-10 rounded-[5px] border border-[#d6dae1] px-5 text-[13px] font-semibold text-[#374151] hover:bg-[#f3f4f6]" data-testid="usuario-cancelar">Cancelar</button>
          <button type="button" onClick={() => void salvar()} disabled={salvando || (editando && !mudou)}
            className="h-10 min-w-[110px] rounded-[5px] bg-[#0688d4] px-5 text-[13px] font-semibold text-white hover:bg-[#0570ae] disabled:cursor-not-allowed disabled:opacity-50" data-testid="usuario-salvar">
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function Campo({ rotulo, erro, dica, children }: { rotulo: string; erro?: string | null; dica?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="cf">
        {children}
        <span className="cf-rotulo">{rotulo}</span>
      </label>
      {erro ? <p className="mt-1 text-[11.5px] font-semibold text-[#b91c1c]">{erro}</p> : dica ? <p className="mt-1 text-[11.5px] text-[#6b7280]">{dica}</p> : null}
    </div>
  )
}
