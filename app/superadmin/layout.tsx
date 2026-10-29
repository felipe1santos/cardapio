import { redirect } from 'next/navigation'
import { getServerSupabase } from '@/lib/supabase/server'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getServerSupabase()
  const { data } = await supabase.auth.getUser()

  if (!isSuperAdminEmail(data.user?.email)) {
    redirect('/login')
  }

  // .sa-hp (29/10): paleta e fonte da "Visão geral" da Hostinger só no Super Admin (app/globals.css).
  return <div className="sa-hp min-h-dvh bg-page">{children}</div>
}
