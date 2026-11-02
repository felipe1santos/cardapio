/**
 * Validação do formulário de /assinar (puro, testável). O que passa daqui vira usuário + cobrança (lib/assinatura/fluxo.ts).
 */
import { normalizarUsuario } from '@/lib/queries/lojistas'
import { planoValido, type Plano } from './planos'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface DadosAssinar {
  plano: Plano
  nome: string
  nomeLoja: string
  email: string
  telefone: string
  documento: string
  usuario: string
  senha: string
}

export type ValidacaoAssinar = { ok: true; dados: DadosAssinar } | { ok: false; erro: string }

/** Só dígitos; CPF (11) ou CNPJ (14) com dígitos verificadores corretos. */
export function documentoValido(bruto: string): boolean {
  const d = bruto.replace(/\D/g, '')
  if (d.length === 11) return cpfValido(d)
  if (d.length === 14) return cnpjValido(d)
  return false
}

function cpfValido(d: string): boolean {
  if (/^(\d)\1{10}$/.test(d)) return false
  const dv = (fatia: string, peso: number) => {
    let soma = 0
    for (const c of fatia) soma += Number(c) * peso--
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10])
}

function cnpjValido(d: string): boolean {
  if (/^(\d)\1{13}$/.test(d)) return false
  const dv = (fatia: string) => {
    const pesos = fatia.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = [...fatia].reduce((acc, c, i) => acc + Number(c) * pesos[i], 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13])
}

export function validarAssinar(form: Record<string, unknown>, confirmarSenha: unknown): ValidacaoAssinar {
  const t = (k: string) => String(form[k] ?? '').trim()
  const plano = t('plano')
  if (!planoValido(plano)) return { ok: false, erro: 'Escolha um plano.' }
  const nome = t('nome').slice(0, 80)
  const nomeLoja = t('nomeLoja').slice(0, 80)
  const email = t('email').toLowerCase()
  const telefone = t('telefone').replace(/\D/g, '')
  const documento = t('documento').replace(/\D/g, '')
  const senha = String(form.senha ?? '')
  if (!nome || !nomeLoja || !email || !telefone || !documento || !t('usuario')) return { ok: false, erro: 'Preencha todos os campos.' }
  if (!EMAIL_REGEX.test(email) || email.length > 254) return { ok: false, erro: 'E-mail inválido.' }
  if (telefone.length < 10 || telefone.length > 13) return { ok: false, erro: 'Celular inválido. Use DDD + número.' }
  if (!documentoValido(documento)) return { ok: false, erro: 'CPF ou CNPJ inválido.' }
  const usuario = normalizarUsuario(t('usuario'))
  if (!usuario) return { ok: false, erro: 'Nome de usuário inválido. Use de 3 a 30 caracteres: letras, números, ponto, hífen ou underline.' }
  if (senha.length < 6) return { ok: false, erro: 'A senha deve ter no mínimo 6 caracteres.' }
  if (senha !== String(confirmarSenha ?? '')) return { ok: false, erro: 'As senhas não coincidem.' }
  return { ok: true, dados: { plano, nome, nomeLoja, email, telefone, documento, usuario, senha } }
}
