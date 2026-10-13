import { redirect } from 'next/navigation'

/** Menu antigo "Cozinha" (removido em 13/10/2026, 0195): a tela da cozinha é o KDS. */
export default function CozinhaAntigaAdmin() {
  redirect('/admin/kds')
}
