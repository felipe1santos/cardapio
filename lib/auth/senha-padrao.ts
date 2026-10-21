/**
 * Senha padrão do reset pelo Super Admin (20/10/2026): o suporte define 123456 para quem não consegue entrar e manda
 * ao cliente. A marca fica no `app_metadata` do usuário do Supabase Auth (só a chave de serviço grava ali — o próprio
 * usuário não consegue se desmarcar sem trocar a senha). Com a marca, o painel mostra a faixa amarela até a troca.
 */
export const SENHA_PADRAO = '123456'

/** Login da equipe é sintético (`usuario.loja@equipe.menuzia.local`, lib/queries/equipe.ts): ninguém digita esse e-mail. */
const DOMINIO_EQUIPE = '@equipe.menuzia.local'

type ComMetadata = { app_metadata?: Record<string, unknown> | null } | null | undefined

export function estaComSenhaPadrao(user: ComMetadata): boolean {
  return user?.app_metadata?.senha_padrao === true
}

/** Como a pessoa entra: e-mail de verdade, ou o nome de usuário quando o e-mail é o sintético da equipe. */
export function loginParaMostrar(c: { email: string | null; usuario: string | null }): { rotulo: 'E-mail' | 'Usuário'; valor: string } {
  const email = (c.email ?? '').trim()
  if (email && !email.toLowerCase().endsWith(DOMINIO_EQUIPE)) return { rotulo: 'E-mail', valor: email }
  return { rotulo: 'Usuário', valor: (c.usuario ?? '').trim() || email }
}

/** O texto do botão "Copiar", pronto para colar no WhatsApp do cliente. */
export function textoDoReset(login: { rotulo: string; valor: string }): string {
  return `${login.rotulo}: ${login.valor} · Senha: ${SENHA_PADRAO}`
}

/** Tem login com o Google ligado a esta conta (identidade `google` no Supabase Auth). */
export function temGoogleVinculado(user: { identities?: { provider?: string }[] | null } | null | undefined): boolean {
  return (user?.identities ?? []).some((i) => i.provider === 'google')
}
