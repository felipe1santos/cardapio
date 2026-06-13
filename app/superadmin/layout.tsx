import { redirect } from 'next/navigation'
import { getServerSupabase } from '@/lib/supabase/server'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getServerSupabase()
  const { data } = await supabase.auth.getUser()

  if (!isSuperAdminEmail(data.user?.email)) {
    redirect('/login')
  }

  return <div className="min-h-dvh bg-page">{children}</div>
}
