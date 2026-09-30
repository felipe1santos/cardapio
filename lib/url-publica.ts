/**
 * Endereço público do app. Links que saem por e-mail/WhatsApp usam este valor fixo, nunca
 * o `Origin`/`Host` da requisição: esses cabeçalhos vêm de quem chama e deixavam montar
 * o link de recuperação de senha apontando para outro domínio (B15).
 */
export function urlPublica(): string {
  return (process.env.MENUZIA_URL_PUBLICA ?? 'https://app.menuzia.com.br').replace(/\/$/, '')
}
