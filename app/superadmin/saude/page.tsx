import { redirect } from 'next/navigation'

/** A Saúde do sistema entrou na Visão geral (30/10/2026); endereço antigo continua funcionando. */
export default function SaudePage() {
  redirect('/superadmin')
}
