'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ban, KeyRound, PauseCircle, Pencil, PlayCircle, Plus, Search, Trash2, UserRound, X } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { PilhaToasts, useToasts } from '@/components/admin/toasts'
import { ModalUsuario, type SalvarUsuario, type UsuarioEquipe } from '@/components/admin/equipe/modal-usuario'
import type { Papel } from '@/lib/auth/permissoes'
import type { Acessos } from '@/lib/acessos'
import { useEstadoSessao } from '@/lib/sessao-cliente'
import { papelForaDoCargo, sensiveisSemSerGestor,
  COR_CARGO, ROTULO_CARGO, ROTULO_SITUACAO, cargoDoUsuario, contarPermissoes, modeloDoCargo, situacaoDoUsuario,
  type Cargo, type Situacao,
} from '@/lib/equipe-cargos'
import { Dica, Flutuante } from '@/components/ui/flutuante'

/**
 * Equipe do estabelecimento (repaginação 2026-10).
 *
 * Tudo passa por `/api/admin/equipe`: e-mail, autorização e validade não saem para o
 * navegador (grant por coluna na 0062), e criar/desativar conta exige `service_role`.
 * Pausar, bloquear e excluir cortam o acesso na próxima ação (desativado_em, 0128).
 */

interface Funcionario {
  id: string
  nome: string
  usuario: string
  papel: Papel
  ativo: boolean
  ultimoLoginEm: string | null
  criadoEm: string
  acessos: Acessos | null
  cargo: string | null
  situacao: string | null
  telefone: string
  temPin?: boolean
}

interface Linha extends Funcionario {
  cargoVisto: Cargo
  situacaoVista: Situacao
  /** Acessos efetivos para exibir/copiar (nulo = modelo do cargo). */
  acessosVistos: Acessos | null
}

const COR_SITUACAO: Record<Situacao, { fundo: string; cor: string; ponto: string }> = {
  ativo: { fundo: '#DCFCE7', cor: '#15803D', ponto: '#10B981' },
  pausado: { fundo: '#FEF3C7', cor: '#B45309', ponto: '#F59E0B' },
  bloqueado: { fundo: '#FEE2E2', cor: '#B91C1C', ponto: '#EF4444' },
  excluido: { fundo: '#F1F5F9', cor: '#475569', ponto: '#94A3B8' },
}

function quando(iso: string | null): string {
  if (!iso) return 'Nunca entrou'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

type Confirmacao = { tipo: 'pausado' | 'bloqueado' | 'excluido'; f: Linha }

export default function EquipePage() {
  const [equipe, setEquipe] = useState<Funcionario[]>([])
  const estadoSessao = useEstadoSessao()
  const [papeisOferecidos, setPapeisOferecidos] = useState<Papel[]>([])
  const [eu, setEu] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [verExcluidos, setVerExcluidos] = useState(false)
  const [modal, setModal] = useState<{ usuario: Linha | null } | null>(null)
  const [senhaDe, setSenhaDe] = useState<Linha | null>(null)
  const [confirmar, setConfirmar] = useState<Confirmacao | null>(null)
  const [menuDe, setMenuDe] = useState<string | null>(null)
  const toasts = useToasts()

  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/equipe', { cache: 'no-store' })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) {
      setErro(corpo.error ?? 'Não foi possível carregar a equipe.')
    } else {
      setEquipe(corpo.equipe)
      setPapeisOferecidos(corpo.papeisOferecidos)
      setEu(corpo.eu)
      setErro(null)
    }
    setCarregando(false)
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const linhas: Linha[] = useMemo(
    () =>
      equipe.map((f) => {
        const cargoVisto = cargoDoUsuario(f.cargo, f.papel, f.acessos)
        return { ...f, cargoVisto, situacaoVista: situacaoDoUsuario(f.ativo, f.situacao), acessosVistos: f.acessos ?? modeloDoCargo(cargoVisto) }
      }),
    [equipe],
  )
  const souDono = linhas.find((l) => l.id === eu)?.papel === 'dono'
  const excluidos = linhas.filter((l) => l.situacaoVista === 'excluido')
  const termo = busca.trim().toLowerCase()
  const visiveis = linhas
    .filter((l) => (verExcluidos ? l.situacaoVista === 'excluido' : l.situacaoVista !== 'excluido'))
    .filter((l) => !termo || l.nome.toLowerCase().includes(termo) || l.usuario.toLowerCase().includes(termo))

  const administravel = (f: Linha) => f.id !== eu && f.papel !== 'dono' && (papeisOferecidos as string[]).includes(f.papel)

  async function mudarSituacao(f: Linha, situacao: Situacao) {
    const r = await fetch(`/api/admin/equipe/${f.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ situacao }),
    })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) {
      toasts.mostrar('erro', corpo.error ?? 'Não foi possível alterar.')
      return
    }
    const msg: Record<Situacao, string> = {
      ativo: `${f.nome} foi reativado.`,
      pausado: `Acesso de ${f.nome} pausado. Cai na próxima ação.`,
      bloqueado: `${f.nome} foi bloqueado. O acesso cai na próxima ação.`,
      excluido: `${f.nome} foi excluído. O histórico continua guardado.`,
    }
    toasts.mostrar('ok', msg[situacao])
    await carregar()
  }

  async function salvarUsuario(dados: SalvarUsuario, alvo: Linha | null): Promise<string | null> {
    const r = alvo
      ? await fetch(`/api/admin/equipe/${alvo.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome: dados.nome, telefone: dados.telefone, cargo: dados.cargo, acessos: dados.acessos }),
        })
      : await fetch('/api/admin/equipe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dados),
        })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) return corpo.error ?? 'Não foi possível salvar.'
    setModal(null)
    toasts.mostrar('ok', alvo ? `${dados.nome} atualizado. Vale na próxima ação, sem precisar sair.` : `${dados.nome} cadastrado. Já pode entrar com o login e a senha.`)
    await carregar()
    return null
  }

  async function redefinirSenha(f: Linha, senha: string): Promise<string | null> {
    const r = await fetch(`/api/admin/equipe/${f.id}/senha`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha }),
    })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) return corpo.error ?? 'Não foi possível redefinir.'
    return null
  }

  async function apagarPin(f: Linha): Promise<string | null> {
    const r = await fetch(`/api/admin/equipe/${f.id}/pin`, { method: 'DELETE' })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) return corpo.error ?? 'Não foi possível apagar o PIN.'
    await carregar()
    return null
  }

  const outros = (alvo: Linha | null) =>
    linhas
      .filter((l) => l.papel !== 'dono' && l.id !== alvo?.id && l.situacaoVista !== 'excluido' && l.acessosVistos)
      .map((l) => ({ id: l.id, nome: l.nome, acessos: l.acessosVistos! }))

  return (
    <>
      <TopBar title="Equipe" breadcrumb="Usuários e permissões" />

      <div className="flex-1 overflow-y-auto p-4 sm:p-5" onClick={() => setMenuDe(null)}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-[420px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar pelo nome ou login do usuário" className="equipe-busca w-full" data-testid="busca-usuario" />
          </div>
          {!carregando && !erro && (
            <span className="hidden text-[12.5px] text-text-subtle sm:inline">
              {verExcluidos ? `${excluidos.length} excluído(s)` : `${linhas.length - excluidos.length} usuário(s)`}
            </span>
          )}
          {/* Item 58: o botão desceu do topo para a linha da busca, à direita (no celular, embaixo, largura total). */}
          {papeisOferecidos.length > 0 && (
            <Button onClick={() => setModal({ usuario: null })} data-testid="adicionar-usuario" className="w-full sm:ml-auto sm:w-auto">
              <Plus className="mr-1.5 inline h-3.5 w-3.5" />
              Adicionar usuário
            </Button>
          )}
        </div>

        {carregando && <p className="text-[13px] text-text-subtle">Carregando…</p>}
        {erro && <p className="rounded-menuzia border border-danger bg-danger-bg px-4 py-3 text-[13px] text-danger">{erro}</p>}

        {!carregando && !erro && (
          <>
            {visiveis.length === 0 && (
              <div className="flex flex-col items-center rounded-[6px] border border-[#e5e7eb] bg-white px-6 py-12 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#E0F2FE] text-[#0688D4]"><UserRound className="h-6 w-6" /></span>
                <p className="text-[14px] font-semibold text-[#1f2937]">{termo ? 'Nenhum usuário encontrado' : verExcluidos ? 'Nenhum usuário excluído' : 'Nenhum usuário'}</p>
                {termo && <p className="mt-1 text-[12.5px] text-text-subtle">Confira o nome ou o login digitado.</p>}
              </div>
            )}

            {/* Celular e tablet em pé: um cartão por pessoa, ações sempre à vista. */}
            <div className="flex flex-col gap-2 lg:hidden">
              {visiveis.map((f) => (
                <div key={f.id} className="rounded-[6px] border border-[#e5e7eb] bg-white p-3.5" data-testid="usuario-cartao" data-login={f.usuario}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold text-[#1f2937]">
                        {f.nome || '—'}
                        {f.id === eu && <span className="ml-1.5 text-[11px] font-normal text-text-subtle">(você)</span>}
                      </div>
                      <div className="truncate font-mono text-[12px] text-text-subtle">{f.usuario || '—'}</div>
                    </div>
                    <SeloSituacao s={f.situacaoVista} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-text-subtle">
                    <SeloCargo c={f.cargoVisto} />
                    <AvisoCargo f={f} />
                    <Permissoes f={f} />
                    <span>· {quando(f.ultimoLoginEm)}</span>
                  </div>
                  {administravel(f) && (
                    <div className="mt-3 flex items-center justify-end gap-1 border-t border-[#f0f1f3] pt-2">
                      <Acoes f={f} menuAberto={menuDe === f.id} onMenu={(v) => setMenuDe(v ? f.id : null)} onEditar={() => setModal({ usuario: f })} onSenha={() => setSenhaDe(f)}
                        onSituacao={(s) => (s === 'ativo' ? void mudarSituacao(f, 'ativo') : setConfirmar({ tipo: s, f }))} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {visiveis.length > 0 && (
              <div className="hidden overflow-x-auto rounded-[6px] border border-[#e5e7eb] bg-white lg:block">
                <table className="w-full min-w-[860px] text-left text-[13px]">
                  <thead className="border-b border-[#e5e7eb] bg-[#f9fafb] text-[11.5px] font-semibold text-[#5b6472]">
                    <tr>
                      <th className="px-4 py-3">Nome</th>
                      <th className="px-4 py-3">Login</th>
                      <th className="px-4 py-3">Cargo</th>
                      <th className="px-4 py-3">Permissões</th>
                      <th className="px-4 py-3">Situação</th>
                      <th className="px-4 py-3">Último acesso</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((f) => (
                      <tr key={f.id} className="equipe-linha border-b border-[#f0f1f3] last:border-0" data-testid="usuario-linha" data-login={f.usuario}>
                        <td className="px-4 py-3 font-semibold text-[#1f2937]">
                          {f.nome || '—'}
                          {f.id === eu && <span className="ml-1.5 text-[11px] font-normal text-text-subtle">(você)</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-text-subtle">{f.usuario || '—'}</td>
                        <td className="px-4 py-3"><span className="inline-flex flex-wrap items-center gap-1"><SeloCargo c={f.cargoVisto} /><AvisoCargo f={f} /></span></td>
                        <td className="px-4 py-3 text-[12.5px]" data-testid="acessos-resumo"><Permissoes f={f} /></td>
                        <td className="px-4 py-3"><SeloSituacao s={f.situacaoVista} /></td>
                        <td className="px-4 py-3 text-[12px] text-text-subtle">{quando(f.ultimoLoginEm)}</td>
                        <td className="px-4 py-2 text-right">
                          {administravel(f) ? (
                            <div className="flex justify-end gap-0.5">
                              <Acoes f={f} menuAberto={menuDe === f.id} onMenu={(v) => setMenuDe(v ? f.id : null)} onEditar={() => setModal({ usuario: f })} onSenha={() => setSenhaDe(f)}
                                onSituacao={(s) => (s === 'ativo' ? void mudarSituacao(f, 'ativo') : setConfirmar({ tipo: s, f }))} />
                            </div>
                          ) : (
                            <span className="text-[12px] text-[#9ca3af]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-subtle">
              <p>Pausar, bloquear e excluir não apagam nada: o histórico e os pedidos que a pessoa lançou continuam. O acesso cai na ação seguinte.</p>
              {(excluidos.length > 0 || verExcluidos) && (
                <button type="button" className="font-semibold text-[#0688d4] hover:underline" onClick={() => setVerExcluidos((v) => !v)} data-testid="ver-excluidos">
                  {verExcluidos ? 'Voltar para a equipe' : `Ver excluídos (${excluidos.length})`}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {modal && (
        <ModalUsuario
          usuario={modal.usuario ? ({ id: modal.usuario.id, nome: modal.usuario.nome, usuario: modal.usuario.usuario, telefone: modal.usuario.telefone, cargo: modal.usuario.cargoVisto, acessos: modal.usuario.acessosVistos, temPin: modal.usuario.temPin } satisfies UsuarioEquipe) : null}
          outros={outros(modal.usuario)}
          podeEquipe={souDono}
          loginsEmUso={modal.usuario ? [] : linhas.map((l) => l.usuario)}
          onCancelar={() => setModal(null)}
          onSalvar={(d) => salvarUsuario(d, modal.usuario)}
          onRedefinirSenha={(s) => redefinirSenha(modal.usuario!, s)}
          onApagarPin={() => apagarPin(modal.usuario!)}
          financeiroAtivo={!!estadoSessao?.financeiroAtivo}
        />
      )}

      {senhaDe && (
        <JanelaSenha
          f={senhaDe}
          onCancelar={() => setSenhaDe(null)}
          onSalvar={async (s) => {
            const e = await redefinirSenha(senhaDe, s)
            if (!e) { toasts.mostrar('ok', `Senha de ${senhaDe.nome} redefinida.`); setSenhaDe(null) }
            return e
          }}
        />
      )}

      {confirmar && (
        <JanelaConfirmar
          c={confirmar}
          onCancelar={() => setConfirmar(null)}
          onConfirmar={async () => { const c = confirmar; setConfirmar(null); await mudarSituacao(c.f, c.tipo) }}
        />
      )}

      <PilhaToasts itens={toasts.itens} />
    </>
  )
}

function SeloCargo({ c }: { c: Cargo }) {
  const cor = COR_CARGO[c]
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-[4px] px-2 py-[3px] text-[11.5px] font-semibold" style={{ backgroundColor: cor.fundo, color: cor.cor }} data-testid="cargo">
      {ROTULO_CARGO[c]}
    </span>
  )
}

const ROTULO_SENS: Record<string, string> = { financeiro: 'ver valores do financeiro', sangria: 'sangria', estornar: 'estorno', aprovar: 'aprovar com PIN', financeiro_exportar: 'exportar relatórios' }
const ROTULO_PAPEL: Record<string, string> = { gerente: 'Gerente', atendente: 'Atendente', garcom: 'Garçom', logistica: 'Logística', cozinha: 'Cozinha', entregador: 'Entregador', dono: 'Dono' }

/**
 * Aviso (2026-10-04): permissões sensíveis de gestor em quem não é gerente/dono, ou papel diferente do cargo.
 * Âmbar vivo com texto branco; a explicação fica na dica.
 */
function AvisoCargo({ f }: { f: Linha }) {
  const sens = sensiveisSemSerGestor(f.cargoVisto, f.papel, f.acessosVistos)
  const fora = papelForaDoCargo(f.cargoVisto, f.papel)
  if (!sens.length && !fora) return null
  const texto = [
    fora ? `Acessa o sistema como ${ROTULO_PAPEL[f.papel] ?? f.papel}, mais do que o cargo ${ROTULO_CARGO[f.cargoVisto]} prevê.` : null,
    sens.length ? `Tem permissões de gestor: ${sens.map((x) => ROTULO_SENS[x] ?? x).join(', ')}.` : null,
    'Revise em Editar.',
  ].filter(Boolean).join(' ')
  return (
    <Dica texto={texto} alternarNoClique>
      <span tabIndex={0} className="inline-flex cursor-help items-center whitespace-nowrap rounded-[4px] bg-[#B45309] px-2 py-[3px] text-[11.5px] font-semibold text-white" data-testid="aviso-cargo" aria-label={texto}>
        ⚠ {fora ? `Papel de ${ROTULO_PAPEL[f.papel] ?? f.papel}` : 'Permissões de gestor'}
      </span>
    </Dica>
  )
}

function SeloSituacao({ s }: { s: Situacao }) {
  const cor = COR_SITUACAO[s]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold" style={{ backgroundColor: cor.fundo, color: cor.cor }} data-testid="situacao" data-situacao={s}>
      <span className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: cor.ponto }} />
      {ROTULO_SITUACAO[s]}
    </span>
  )
}

function Permissoes({ f }: { f: Linha }) {
  if (f.papel === 'dono') return <span className="font-semibold text-[#1f2937]">Acesso total</span>
  if (!f.acessosVistos) return <span>Padrão do papel</span>
  const n = contarPermissoes(f.acessosVistos)
  return <span className="text-[#374151]">{n === 1 ? '1 permissão' : `${n} permissões`}</span>
}

function Acoes({ f, menuAberto, onMenu, onEditar, onSenha, onSituacao }: {
  f: Linha
  menuAberto: boolean
  onMenu: (aberto: boolean) => void
  onEditar: () => void
  onSenha: () => void
  onSituacao: (s: Situacao) => void
}) {
  const inativo = f.situacaoVista !== 'ativo'
  // Menu no portal (regra 3): dentro da tabela ele ficava cortado pela rolagem. A mesma linha existe
  // na tabela e nos cartões do celular — só a cópia visível abre o menu.
  const botaoMenu = useRef<HTMLButtonElement>(null)
  const fecharMenu = useCallback(() => onMenu(false), [onMenu])
  const visivel = !!botaoMenu.current && botaoMenu.current.offsetParent !== null
  return (
    <>
      <button type="button" className="equipe-acao toque-icone" title="Editar" aria-label={`Editar ${f.nome}`} onClick={onEditar} data-testid="acao-editar"><Pencil className="h-4 w-4" /></button>
      <button type="button" className="equipe-acao toque-icone" title="Redefinir senha" aria-label={`Redefinir senha de ${f.nome}`} onClick={onSenha} data-testid="acao-senha"><KeyRound className="h-4 w-4" /></button>
      {inativo ? (
        <button type="button" className="equipe-acao toque-icone" title="Reativar" aria-label={`Reativar ${f.nome}`} onClick={() => onSituacao('ativo')} data-testid="acao-reativar"><PlayCircle className="h-4 w-4" /></button>
      ) : (
        <span className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="equipe-acao toque-icone" title="Pausar ou bloquear" aria-label={`Pausar ou bloquear ${f.nome}`} aria-expanded={menuAberto} onClick={() => onMenu(!menuAberto)} data-testid="acao-pausar-bloquear" ref={botaoMenu}><PauseCircle className="h-4 w-4" /></button>
          <Flutuante ancora={botaoMenu} aberto={menuAberto && visivel} onFechar={fecharMenu} largura={210} testid="menu-situacao" rotulo={`Situação de ${f.nome}`} className="py-1">
            <span className="flex flex-col text-left" role="menu">
              <button type="button" role="menuitem" className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-[#1f2937] hover:bg-[#f3f4f6]" onClick={() => { onMenu(false); onSituacao('pausado') }} data-testid="menu-pausar">
                <PauseCircle className="h-4 w-4 text-[#B45309]" /> Pausar acesso
              </button>
              <button type="button" role="menuitem" className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-[#1f2937] hover:bg-[#f3f4f6]" onClick={() => { onMenu(false); onSituacao('bloqueado') }} data-testid="menu-bloquear">
                <Ban className="h-4 w-4 text-[#DC2626]" /> Bloquear acesso
              </button>
            </span>
          </Flutuante>
        </span>
      )}
      {f.situacaoVista !== 'excluido' && (
        <button type="button" className="equipe-acao perigo toque-icone" title="Excluir" aria-label={`Excluir ${f.nome}`} onClick={() => onSituacao('excluido')} data-testid="acao-excluir"><Trash2 className="h-4 w-4" /></button>
      )}
    </>
  )
}

function JanelaPequena({ titulo, onFechar, children, rodape }: { titulo: string; onFechar: () => void; children: React.ReactNode; rodape: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4" onMouseDown={onFechar}>
      <div role="dialog" aria-modal="true" className="w-full max-w-[440px] overflow-hidden rounded-[8px] bg-white shadow-[0_24px_64px_rgba(15,23,42,0.28)]" onMouseDown={(e) => e.stopPropagation()} data-testid="janela-pequena">
        <div className="flex h-[54px] items-center justify-between border-b border-[#e5e7eb] px-5">
          <span className="text-[15px] font-semibold text-[#1f2937]">{titulo}</span>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="text-[#6b7280] hover:text-[#1f2937]"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">{children}</div>
        <div className="flex justify-end gap-2 border-t border-[#e5e7eb] px-5 py-3">{rodape}</div>
      </div>
    </div>
  )
}

const BTN_SEC = 'h-10 rounded-[5px] border border-[#d6dae1] px-4 text-[13px] font-semibold text-[#374151] hover:bg-[#f3f4f6]'
const BTN_PRI = 'h-10 rounded-[5px] px-4 text-[13px] font-semibold text-white disabled:opacity-50'

function JanelaSenha({ f, onCancelar, onSalvar }: { f: Linha; onCancelar: () => void; onSalvar: (s: string) => Promise<string | null> }) {
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  async function salvar() {
    if (senha.length < 8) { setErro('Pelo menos 8 caracteres.'); return }
    setSalvando(true)
    const e = await onSalvar(senha)
    setSalvando(false)
    if (e) setErro(e)
  }
  return (
    <JanelaPequena titulo={`Redefinir senha · ${f.nome}`} onFechar={onCancelar}
      rodape={<><button type="button" className={BTN_SEC} onClick={onCancelar}>Cancelar</button><button type="button" className={`${BTN_PRI} bg-[#0688d4] hover:bg-[#0570ae]`} disabled={salvando} onClick={() => void salvar()} data-testid="senha-salvar">{salvando ? 'Salvando…' : 'Redefinir senha'}</button></>}>
      <label className="cf">
        <input ref={ref} type="password" className="cf-campo" placeholder=" " value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" onKeyDown={(e) => { if (e.key === 'Enter') void salvar() }} data-testid="senha-nova" />
        <span className="cf-rotulo">Nova senha</span>
      </label>
      <p className={`mt-1.5 text-[12px] ${erro ? 'font-semibold text-[#b91c1c]' : 'text-[#6b7280]'}`}>{erro ?? 'Mínimo de 8 caracteres. A pessoa continua logada até a próxima entrada.'}</p>
    </JanelaPequena>
  )
}

function JanelaConfirmar({ c, onCancelar, onConfirmar }: { c: Confirmacao; onCancelar: () => void; onConfirmar: () => void }) {
  const t = {
    pausado: { titulo: 'Pausar acesso', texto: `${c.f.nome} não consegue entrar nem usar o painel até ser reativado. Bom para férias ou afastamento.`, botao: 'Pausar', cor: 'bg-[#d97706] hover:bg-[#b45309]' },
    bloqueado: { titulo: 'Bloquear acesso', texto: `${c.f.nome} perde o acesso na próxima ação. Use quando houver suspeita ou desligamento.`, botao: 'Bloquear', cor: 'bg-[#dc2626] hover:bg-[#b91c1c]' },
    excluido: { titulo: 'Excluir usuário', texto: `${c.f.nome} sai da lista da equipe e perde o acesso. Nada é apagado: o histórico e os pedidos continuam, e dá para reativar em "Ver excluídos".`, botao: 'Excluir', cor: 'bg-[#dc2626] hover:bg-[#b91c1c]' },
  }[c.tipo]
  return (
    <JanelaPequena titulo={t.titulo} onFechar={onCancelar}
      rodape={<><button type="button" className={BTN_SEC} onClick={onCancelar} data-testid="confirmar-cancelar">Cancelar</button><button type="button" className={`${BTN_PRI} ${t.cor}`} onClick={onConfirmar} data-testid="confirmar-ok">{t.botao}</button></>}>
      <p className="text-[13.5px] leading-relaxed text-[#374151]">{t.texto}</p>
    </JanelaPequena>
  )
}
