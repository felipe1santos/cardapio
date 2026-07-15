import { redirect } from 'next/navigation'

/** Nexta é a única integração com página própria hoje — outras entram como abas ao lado. */
export default function IntegracoesPage() {
  redirect('/admin/integracoes/nexta')
}
