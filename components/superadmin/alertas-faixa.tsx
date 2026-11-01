'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { lerTextoAlerta } from '@/lib/saude/texto-alerta'
import { agruparAlertas, type GrupoAlerta } from '@/lib/saude/historico-alertas'

/**
 * Alertas do sistema no Super Admin (30/10/2026): faixa vermelha que leva ao histórico e histórico com UMA LINHA por
 * ASSUNTO (01/11: quantas vezes saiu, se ainda está ativo ou já resolveu); tocar abre o que aconteceu, por quê (quanto),
 * o que fazer e por onde o aviso saiu. Resumo e teste ficam escondidos por padrão. Só exibição.
 */
export interface AlertaTela { id?: number | string; assunto?: string; criado_em: string; nivel: string; texto: string; canal?: string | null; enviado?: boolean; erro?: string | null; resolvido_em?: string | null }

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const NIVEL: Record<string, [string, string]> = {
  vermelho: ['Crítico', 'bg-[#B3122D] text-white'], amarelo: ['Atenção', 'bg-[#FFF8E2] text-[#8A6100]'],
  resumo: ['Resumo', 'bg-[#EBE4FF] text-[#673DE6]'], teste: ['Teste', 'bg-[#F2F3F6] text-[#58585E]'],
}
const SITUACAO: Record<'ativo' | 'resolvido', [string, string]> = { ativo: ['Ativo', 'bg-[#FDE7EA] text-[#B3122D]'], resolvido: ['Resolvido', 'bg-[#E3F5E9] text-[#1E7A3C]'] }
const POR_PAGINA = 10
const avulso = (nivel: string) => nivel === 'resumo' || nivel === 'teste'

/** Por onde o aviso saiu, em português. Push = notificação no celular/computador com o painel da Menuzia instalado. */
function textoEnvio(a: AlertaTela) {
  if (a.enviado === false || a.canal === 'nenhum') return 'Não foi entregue por nenhum canal.'
  if (a.canal === 'whatsapp') return 'Enviado por WhatsApp.'
  if (a.canal === 'push') return 'Enviado por notificação do painel (push), porque o WhatsApp de alertas não conseguiu enviar.'
  return a.canal ? `Enviado por ${a.canal}.` : null
}

/** Uma linha por assunto; aberta, mostra o último alerta inteiro. */
function ItemAlerta({ g, aberto, onAlternar }: { g: GrupoAlerta; aberto: boolean; onAlternar: () => void }) {
  const a = g.ultimo as AlertaTela
  const p = lerTextoAlerta(a.texto)
  const [rotulo, cor] = NIVEL[a.nivel] ?? NIVEL.teste
  const envio = textoEnvio(a)
  const sit = g.situacao ? SITUACAO[g.situacao] : null
  const repeticao = g.vezes > 1 ? `${g.vezes}× desde ${quando(g.primeiro.criado_em)}` : null
  return (
    <li className="border-b-[0.8px] border-[rgba(0,0,0,0.08)] last:border-0" data-testid="detalhe-alerta">
      <button type="button" onClick={onAlternar} aria-expanded={aberto}
        className="flex min-h-[48px] w-full items-center gap-[8px] px-[12px] py-[8px] text-left hover:bg-[#F7F5FF] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#673DE6] sm:gap-[12px] sm:px-[24px]">
        <span className={`flex-shrink-0 rounded-[8px] px-[8px] py-[2px] text-[12px] font-semibold leading-[20px] ${cor}`}>{rotulo}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium leading-[20px] text-[#18181A] first-letter:uppercase">{p.titulo}</span>
          {repeticao && <span className="block truncate text-[12px] leading-[16px] text-[#58585E]" data-testid="alerta-vezes">{repeticao}</span>}
        </span>
        {sit && <span className={`flex-shrink-0 rounded-[8px] px-[8px] py-[2px] text-[12px] font-semibold leading-[20px] max-sm:hidden ${sit[1]}`} data-testid="alerta-situacao">{sit[0]}</span>}
        <span className="flex-shrink-0 whitespace-nowrap text-[12px] leading-[16px] tabular-nums text-[#58585E]">{quando(a.criado_em)}</span>
        <ChevronDown className={`h-[16px] w-[16px] flex-shrink-0 text-[#58585E] transition-transform duration-150 ${aberto ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {aberto && (
        <div className="bg-[#FAFAFB] px-[12px] pb-[12px] pt-[8px] sm:px-[24px]" data-testid="alerta-aberto">
          <dl className="m-0 grid gap-[8px] text-[14px] leading-[20px] sm:max-w-[760px]">
            {p.oQue && <div><dt className="text-[12px] font-semibold text-[#58585E]">O que aconteceu</dt><dd className="m-0 text-[#18181A]">{p.oQue}</dd></div>}
            {p.quanto && <div><dt className="text-[12px] font-semibold text-[#58585E]">Por quê (o número)</dt><dd className="m-0 font-semibold text-[#18181A]">{p.quanto}</dd></div>}
            {p.fazer && <div><dt className="text-[12px] font-semibold text-[#58585E]">O que fazer</dt><dd className="m-0 text-[#18181A]">{p.fazer}</dd></div>}
            {sit && <div><dt className="text-[12px] font-semibold text-[#58585E]">Situação</dt><dd className="m-0 text-[#18181A]">{g.situacao === 'resolvido' ? `Resolvido sozinho em ${quando(a.resolvido_em as string)}.` : 'Ainda acontecendo na última verificação.'}{repeticao ? ` Saiu ${repeticao}.` : ''}</dd></div>}
            {envio && <div><dt className="text-[12px] font-semibold text-[#58585E]">Como foi avisado</dt><dd className="m-0 text-[#18181A]">{envio}</dd></div>}
          </dl>
          {a.erro && <p className="mt-[8px] break-words text-[12px] leading-[16px] text-[#B3122D]">Detalhe técnico: {a.erro}</p>}
        </div>
      )}
    </li>
  )
}

/**
 * Lista de alertas: uma linha por assunto, um aberto por vez e 10 de cada vez. Por padrão só Crítico e Atenção;
 * `comFiltro` mostra o botão que traz resumos e testes.
 */
export function ListaAlertas({ alertas, vazio, comFiltro = false }: { alertas: AlertaTela[]; vazio: string; comFiltro?: boolean }) {
  const [aberto, setAberto] = useState<string | null>(null)
  const [limite, setLimite] = useState(POR_PAGINA)
  const [tudo, setTudo] = useState(false)
  const visiveis = comFiltro && !tudo ? alertas.filter((a) => !avulso(a.nivel)) : alertas
  const grupos = agruparAlertas(visiveis.map((a) => ({ ...a, id: a.id ?? a.criado_em, assunto: a.assunto ?? String(a.id ?? a.criado_em) })))
  const escondidos = alertas.length - visiveis.length
  if (!grupos.length && !escondidos) return <p className="px-[16px] pb-[16px] text-[14px] leading-[20px] text-[#58585E] sm:px-[24px]">{vazio}</p>
  return (
    <>
      {grupos.length > 0 && (
        <ul className="m-0 list-none border-t-[0.8px] border-[rgba(0,0,0,0.08)] p-0">
          {grupos.slice(0, limite).map((g) => {
            const chave = `${g.assunto}:${g.ultimo.id}`
            return <ItemAlerta key={chave} g={g} aberto={aberto === chave} onAlternar={() => setAberto((x) => (x === chave ? null : chave))} />
          })}
        </ul>
      )}
      {grupos.length === 0 && <p className="px-[16px] pb-[8px] text-[14px] leading-[20px] text-[#58585E] sm:px-[24px]">{vazio}</p>}
      {grupos.length > limite && (
        <button type="button" onClick={() => setLimite((l) => l + POR_PAGINA)} data-testid="alertas-mais"
          className="flex min-h-[44px] w-full items-center justify-center border-t-[0.8px] border-[rgba(0,0,0,0.08)] text-[14px] font-semibold text-[#673DE6] hover:bg-[#F7F5FF]">
          Ver mais ({grupos.length - limite})
        </button>
      )}
      {comFiltro && (escondidos > 0 || tudo) && (
        <button type="button" onClick={() => setTudo((t) => !t)} data-testid="alertas-filtro"
          className="flex min-h-[44px] w-full items-center justify-center border-t-[0.8px] border-[rgba(0,0,0,0.08)] text-[13px] font-semibold text-[#58585E] hover:bg-[#F7F5FF]">
          {tudo ? 'Esconder resumos e testes' : `Mostrar resumos e testes (${escondidos})`}
        </button>
      )}
    </>
  )
}

export function AlertasFaixa({ alertas }: { alertas: AlertaTela[] }) {
  if (!alertas.length) return null
  const p = lerTextoAlerta(alertas[0].texto)
  return (
    <a href="#alertas" data-testid="faixa-alertas"
      className="flex min-h-[48px] w-full items-center gap-[10px] rounded-[16px] bg-[#B3122D] px-[14px] py-[10px] text-left text-white shadow-[0_6px_18px_rgba(179,18,45,0.25)] hover:bg-[#9A0F27] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B3122D]">
      <AlertTriangle className="h-[20px] w-[20px] flex-shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold leading-[20px]">{alertas.length} alerta(s) nas últimas 6 h</span>
        <span className="block truncate text-[13px] leading-[18px] text-white/90 first-letter:uppercase">{p.titulo}{p.quanto ? ` — ${p.quanto}` : ''}</span>
      </span>
      <span className="flex flex-shrink-0 items-center gap-[2px] text-[13px] font-semibold">Ver <ChevronRight className="h-[16px] w-[16px]" aria-hidden /></span>
    </a>
  )
}
