'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Plus, UserCheck, UserX, X } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { Papel } from '@/lib/auth/permissoes'

/**
 * Equipe do estabelecimento.
 *
 * Tudo passa por `/api/admin/equipe`: e-mail, autorização e validade não saem mais para o
 * navegador (grant por coluna na 0062), e criar/desativar conta exige `service_role`.
 */

interface Funcionario {
  id: string
  nome: string
  usuario: string
  papel: Papel
  ativo: boolean
  ultimoLoginEm: string | null
  criadoEm: string
}

const ROTULO_PAPEL: Record<string, string> = {
  dono: 'Dono',
  gerente: 'Gerente',
  garcom: 'Garçom',
  atendente: 'Atendente',
  cozinha: 'Cozinha',
  logistica: 'Logística',
  entregador: 'Entregador',
}

const DESCRICAO_PAPEL: Record<string, string> = {
  gerente: 'Opera a loja inteira e gerencia garçons e atendentes. Não mexe em Ajustes nem Integrações.',
  garcom: 'Abre mesas, lança pedidos e envia para a cozinha. Não vê delivery, clientes nem faturamento.',
  atendente: 'Atende o delivery e o balcão. Não opera mesas.',
}

function quando(iso: string | null): string {
  if (!iso) return 'nunca entrou'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function EquipePage() {
  const [equipe, setEquipe] = useState<Funcionario[]>([])
  const [papeisOferecidos, setPapeisOferecidos] = useState<Papel[]>([])
  const [eu, setEu] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [novoAberto, setNovoAberto] = useState(false)
  const [senhaDe, setSenhaDe] = useState<Funcionario | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/equipe', { cache: 'no-store' })
    const corpo = await r.json()
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

  async function alternarAtivo(f: Funcionario) {
    setAviso(null)
    const r = await fetch(`/api/admin/equipe/${f.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: !f.ativo }),
    })
    const corpo = await r.json()
    if (!r.ok) {
      setAviso(corpo.error ?? 'Não foi possível alterar.')
      return
    }
    setAviso(f.ativo ? `${f.nome} foi desativado e perde o acesso na próxima ação.` : `${f.nome} foi reativado.`)
    await carregar()
  }

  return (
    <>
      <TopBar
        title="Equipe"
        breadcrumb="Funcionários e acessos"
        right={
          papeisOferecidos.length > 0 ? (
            <Button onClick={() => setNovoAberto(true)}>
              <Plus className="mr-1.5 inline h-3.5 w-3.5" />
              Novo funcionário
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-5">
        {aviso && (
          <p className="mb-3 rounded-menuzia border border-border bg-alert-bg px-4 py-2.5 text-[13px] text-alert-text">{aviso}</p>
        )}
        {carregando && <p className="text-[13px] text-text-subtle">Carregando…</p>}
        {erro && (
          <p className="rounded-menuzia border border-danger bg-danger-bg px-4 py-3 text-[13px] text-danger">{erro}</p>
        )}

        {!carregando && !erro && (
          <div className="overflow-x-auto rounded-menuzia border border-border bg-main">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-border bg-bg-page text-[11px] uppercase tracking-wide text-text-subtle">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Nome</th>
                  <th className="px-4 py-2.5 font-semibold">Login</th>
                  <th className="px-4 py-2.5 font-semibold">Papel</th>
                  <th className="px-4 py-2.5 font-semibold">Situação</th>
                  <th className="px-4 py-2.5 font-semibold">Último acesso</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {equipe.map((f) => {
                  // Só oferece ação sobre quem o próprio usuário pode administrar. O
                  // servidor confere de novo — isto só evita botão que vai dar erro.
                  const administravel = f.id !== eu && (papeisOferecidos as string[]).includes(f.papel)
                  return (
                    <tr key={f.id} className={`border-b border-border last:border-0 ${f.ativo ? '' : 'opacity-60'}`}>
                      <td className="px-4 py-3 font-semibold text-text-main">
                        {f.nome || '—'}
                        {f.id === eu && <span className="ml-1.5 text-[11px] font-normal text-text-subtle">(você)</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-text-subtle">{f.usuario || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge tone={f.papel === 'dono' ? 'highlight' : f.papel === 'garcom' ? 'preparing' : 'alert'}>
                          {ROTULO_PAPEL[f.papel] ?? f.papel}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={f.ativo ? 'ok' : 'danger'}>{f.ativo ? 'Ativo' : 'Desativado'}</Badge>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-text-subtle">{quando(f.ultimoLoginEm)}</td>
                      <td className="px-4 py-3 text-right">
                        {administravel && (
                          <div className="flex justify-end gap-1.5">
                            <Button variant="outline" className="!px-2" onClick={() => setSenhaDe(f)} title="Redefinir senha">
                              <KeyRound className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="outline" className="!px-2.5" onClick={() => alternarAtivo(f)}>
                              {f.ativo ? (
                                <>
                                  <UserX className="mr-1 inline h-3.5 w-3.5" />
                                  Desativar
                                </>
                              ) : (
                                <>
                                  <UserCheck className="mr-1 inline h-3.5 w-3.5" />
                                  Reativar
                                </>
                              )}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[12px] text-text-subtle">
          Desativar não apaga: o histórico e os pedidos que a pessoa lançou continuam. O acesso cai na ação seguinte,
          mesmo que ela esteja com a tela aberta.
        </p>
      </div>

      {novoAberto && (
        <NovoFuncionario
          papeis={papeisOferecidos}
          onCancelar={() => setNovoAberto(false)}
          onCriado={async (nome) => {
            setNovoAberto(false)
            setAviso(`${nome} foi cadastrado e já pode entrar com o login e a senha definidos.`)
            await carregar()
          }}
        />
      )}

      {senhaDe && (
        <RedefinirSenha
          funcionario={senhaDe}
          onCancelar={() => setSenhaDe(null)}
          onFeito={() => {
            setAviso(`Senha de ${senhaDe.nome} redefinida.`)
            setSenhaDe(null)
          }}
        />
      )}
    </>
  )
}

function Gaveta({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onFechar}>
      <aside className="flex h-full w-full max-w-md flex-col bg-main shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-border px-5">
          <span className="text-[15px] font-semibold text-text-main">{titulo}</span>
          <button onClick={onFechar} className="text-text-subtle hover:text-text-main" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </aside>
    </div>
  )
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-text-subtle">{hint}</span>}
    </label>
  )
}

const INPUT = 'h-10 w-full rounded-menuzia border border-border px-3 text-[13px] outline-none focus:border-primary'

function NovoFuncionario({
  papeis,
  onCancelar,
  onCriado,
}: {
  papeis: Papel[]
  onCancelar: () => void
  onCriado: (nome: string) => void
}) {
  const [nome, setNome] = useState('')
  const [usuario, setUsuario] = useState('')
  const [papel, setPapel] = useState<Papel>(papeis.includes('garcom') ? 'garcom' : papeis[0])
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    setSalvando(true)
    setErro(null)
    const r = await fetch('/api/admin/equipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, usuario, papel, senha }),
    })
    const corpo = await r.json()
    setSalvando(false)
    if (!r.ok) {
      setErro(corpo.error ?? 'Não foi possível cadastrar.')
      return
    }
    onCriado(corpo.funcionario.nome)
  }

  return (
    <Gaveta titulo="Novo funcionário" onFechar={onCancelar}>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <Campo label="Nome">
          <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} className={INPUT} placeholder="Ex.: João Silva" />
        </Campo>
        <Campo label="Login" hint="É com ele que a pessoa entra. Letras minúsculas, números, ponto, hífen ou sublinhado.">
          <input
            value={usuario}
            onChange={(e) => setUsuario(e.target.value.toLowerCase().replace(/\s/g, ''))}
            className={`${INPUT} font-mono`}
            placeholder="joao.silva"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </Campo>
        <Campo label="Papel">
          <select value={papel} onChange={(e) => setPapel(e.target.value as Papel)} className={INPUT}>
            {papeis.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PAPEL[p]}
              </option>
            ))}
          </select>
          {DESCRICAO_PAPEL[papel] && <span className="mt-1 block text-[11px] text-text-subtle">{DESCRICAO_PAPEL[papel]}</span>}
        </Campo>
        <Campo label="Senha inicial" hint="Pelo menos 8 caracteres. Passe para a pessoa pessoalmente.">
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className={INPUT} autoComplete="new-password" />
        </Campo>
        {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{erro}</p>}
      </div>
      <div className="flex gap-2 border-t border-border p-5">
        <Button variant="outline" className="flex-1" onClick={onCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={salvar} disabled={salvando}>
          {salvando ? 'Cadastrando…' : 'Cadastrar'}
        </Button>
      </div>
    </Gaveta>
  )
}

function RedefinirSenha({
  funcionario,
  onCancelar,
  onFeito,
}: {
  funcionario: Funcionario
  onCancelar: () => void
  onFeito: () => void
}) {
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    setSalvando(true)
    setErro(null)
    const r = await fetch(`/api/admin/equipe/${funcionario.id}/senha`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha }),
    })
    const corpo = await r.json()
    setSalvando(false)
    if (!r.ok) {
      setErro(corpo.error ?? 'Não foi possível redefinir.')
      return
    }
    onFeito()
  }

  return (
    <Gaveta titulo={`Nova senha · ${funcionario.nome}`} onFechar={onCancelar}>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <Campo label="Nova senha" hint="Pelo menos 8 caracteres.">
          <input
            autoFocus
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className={INPUT}
            autoComplete="new-password"
          />
        </Campo>
        {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{erro}</p>}
      </div>
      <div className="flex gap-2 border-t border-border p-5">
        <Button variant="outline" className="flex-1" onClick={onCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={salvar} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Redefinir senha'}
        </Button>
      </div>
    </Gaveta>
  )
}
