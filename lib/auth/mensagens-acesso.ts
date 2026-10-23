/**
 * Mensagens de login e recuperação de senha (10/10/2026): iguais exista ou não a conta — quem tenta adivinhar e-mails
 * ou logins não descobre nada pela resposta. O único caso distinto é o limite de tentativas (vale para qualquer e-mail).
 */
export const MSG_LOGIN_INVALIDO = 'Login ou senha inválidos.'
export const MSG_RECUPERACAO_ENVIADA = 'Se existir uma conta com esse e-mail, enviamos as instruções.'
export const MSG_MUITAS_TENTATIVAS = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
export const MSG_INSTABILIDADE = 'Não foi possível entrar agora. Tente de novo em instantes.'

/**
 * O limite de tentativas freia senha errada, não queda nossa (23/10/2026: o Supabase travou 33 min e as tentativas das
 * lojas viraram "muitas tentativas"). Só a credencial recusada (400) conta; rede, tempo esgotado e 5xx não.
 */
export function falhaDeCredencial(erro: { status?: number }): boolean {
  return erro.status === 400
}

/** O que fazer com o retorno do pedido de troca de senha: mostrar "enviamos" ou o aviso de limite. */
export function resultadoRecuperacao(erro: { status?: number } | null): 'enviado' | 'limite' {
  return erro?.status === 429 ? 'limite' : 'enviado'
}
