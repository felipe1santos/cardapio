'use client'

/**
 * Ajustes › Impressão (10/10/2026): a Impressão saiu do menu principal e virou item de Ajustes. Página própria
 * (e não aba do /admin/ajustes) para manter a MESMA permissão de antes — dono e gerente (impressao.configurar,
 * lib/auth/rotas.ts) —, já que o resto dos Ajustes é só do dono. O gerente vê só este item no submenu.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/layout/topbar'
import { SubmenuVertical } from '@/components/admin/submenu-vertical'
import { PainelImpressao } from '@/components/impressao/painel-impressao'
import { abasDoAjustes, type AbaAjustes } from '@/components/admin/ajustes-abas'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { useEstadoSessao } from '@/lib/sessao-cliente'
import { pode } from '@/lib/auth/permissoes'

export default function AjustesImpressaoPage() {
  const router = useRouter()
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const estado = useEstadoSessao()
  const [papel, setPapel] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: u } = await supabase.from('usuarios').select('papel').eq('id', data.user.id).maybeSingle()
      if (vivo && u) setPapel(u.papel as string)
    })
    return () => { vivo = false }
  }, [supabase])

  // Enquanto o papel não chega, só o item Impressão (nunca oferece o que a pessoa não pode abrir).
  const abas = abasDoAjustes({
    podeAjustes: papel !== null && pode(papel, 'ajustes.editar'),
    podeImpressao: true,
    agenteLiberado: !!estado?.modulos?.agente_ia,
    novidades: true,
  })

  // Sem "Novidades em teste" (0178) a Impressão continua sendo a página de sempre.
  const semNovidades = estado !== null && estado.novidades !== true
  useEffect(() => { if (semNovidades) router.replace('/admin/impressao') }, [semNovidades, router])

  function irPara(id: AbaAjustes) {
    if (id === 'impressao') return
    router.push(id === 'loja' ? '/admin/ajustes' : `/admin/ajustes?aba=${id}`)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar title="Ajustes" breadcrumb="Impressão" />
      <div className="ajustes-v2 meta-tema flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <SubmenuVertical itens={abas} ativo="impressao" onSelecionar={irPara} titulo="Seções dos ajustes" />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="ajustes-impressao">
          <PainelImpressao semTopo />
        </div>
      </div>
    </div>
  )
}
