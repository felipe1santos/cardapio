const SUPERADMIN_EMAILS = (process.env.SUPERADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

/** True quando o e-mail consta na lista de administradores da plataforma (env SUPERADMIN_EMAILS). */
export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return SUPERADMIN_EMAILS.includes(email.trim().toLowerCase())
}
