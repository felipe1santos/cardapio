/**
 * Mensagens de login e recuperação de senha (10/10/2026): iguais exista ou não a conta — quem tenta adivinhar e-mails
 * ou logins não descobre nada pela resposta. O único caso distinto é o limite de tentativas (vale para qualquer e-mail).
 */
export const MSG_LOGIN_INVALIDO = 'Login ou senha inválidos.'
export const MSG_RECUPERACAO_ENVIADA = 'Se existir uma conta com esse e-mail, enviamos as instruções.'
export const MSG_MUITAS_TENTATIVAS = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'

/** O que fazer com o retorno do pedido de troca de senha: mostrar "enviamos" ou o aviso de limite. */
export function resultadoRecuperacao(erro: { status?: number } | null): 'enviado' | 'limite' {
  return erro?.status === 429 ? 'limite' : 'enviado'
}
