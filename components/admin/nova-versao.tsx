'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { versaoMudou } from '@/lib/versao-app'

/**
 * Versão nova do Menuzia publicada (20/10/2026): aba do painel aberta há horas continua com o JavaScript antigo — o
 * dono via "tudo igual" depois do deploy. Ao abrir, guarda a versão do servidor (/api/versao = .next/BUILD_ID); confere
 * de novo a cada 5 min e ao voltar para a aba. Mudou:
 *   - faixa azul no topo com "Atualizar agora";
 *   - a PRÓXIMA navegação dentro do painel vira carregamento completo (pega a versão nova sem ninguém limpar nada);
 *   - aba escondida e fora do Painel de Pedidos recarrega sozinha (não mexe no Kanban, que depende do som liberado).
 */
export function NovaVersao() {
  const [nova, setNova] = useState(false)
  const base = useRef<string | null>(null)
  const pathname = usePathname()
  const primeiro = useRef(pathname)

  useEffect(() => {
    let vivo = true
    const conferir = () => fetch('/api/versao', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { versao?: string } | null) => {
        const v = j?.versao ?? ''
        if (!vivo || !v) return
        if (base.current === null) { base.current = v; return }
        if (!versaoMudou(base.current, v)) return
        setNova(true)
        if (document.hidden && !window.location.pathname.startsWith('/admin/pedidos')) window.location.reload()
      })
      .catch(() => {})
    void conferir()
    const aoVoltar = () => { if (document.visibilityState === 'visible') void conferir() }
    const t = setInterval(conferir, 5 * 60_000)
    document.addEventListener('visibilitychange', aoVoltar)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', aoVoltar) }
  }, [])

  // Navegou dentro do painel com versão nova pendente: carrega a página inteira (o roteador do Next manteria o JS velho).
  useEffect(() => {
    if (nova && pathname !== primeiro.current) window.location.reload()
    primeiro.current = pathname
  }, [nova, pathname])

  if (!nova) return null
  return (
    <div role="status" data-testid="nova-versao" className="flex min-h-[40px] flex-shrink-0 items-center gap-3 bg-[#0688D4] px-3 py-1.5 text-white sm:px-5">
      <RefreshCw className="h-4 w-4 flex-shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px] leading-[18px]"><strong className="font-semibold">Nova versão do Menuzia disponível.</strong> <span className="max-sm:hidden">Atualize para ver as novidades.</span></p>
      <button type="button" onClick={() => window.location.reload()} data-testid="nova-versao-atualizar"
        className="inline-flex flex-shrink-0 items-center whitespace-nowrap rounded-[6px] bg-white px-3 py-1 text-[13px] font-semibold text-[#0570AE] hover:bg-[#E0F2FE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
        Atualizar agora
      </button>
    </div>
  )
}
