'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { DispositivoVisao } from '@/lib/impressao/servico'
import {
  avisoDriver, ehIpv4, envioDiretoSugerido, LARGURAS_PONTOS, ROTULO_ENVIO, ROTULO_INTENSIDADE, ROTULO_MODO,
  type Envio, type Intensidade, type ModoImpressao,
} from '@/lib/impressao/regras-calibracao'

type Agir = (url: string, metodo: string, corpo: unknown, sucesso: string) => Promise<{ ok: boolean } | null>

/**
 * Calibrar impressora › "Como a impressora recebe" (0109 / Assistente 0.2.0-beta.7):
 * largura em pontos, intensidade, envio (driver, fila RAW, rede IP) e modo (imagem/texto),
 * salvos POR IMPRESSORA. Padrões = como sempre foi. Mostra o aviso quando o driver do
 * Windows está numa largura diferente (ex.: driver de 58 mm numa impressora de 80 mm).
 */
export function EnvioImpressora({ d, ocupado, agir, onImprimirTeste }: { d: DispositivoVisao; ocupado: boolean; agir: Agir; onImprimirTeste: () => void }) {
  const url = `/api/admin/impressao/dispositivos/${d.id}`
  const [ip, setIp] = useState(d.redeIp ?? '')
  const [porta, setPorta] = useState(String(d.redePorta ?? 9100))
  const [querRede, setQuerRede] = useState(d.envio === 'raw_rede')
  useEffect(() => { setQuerRede(d.envio === 'raw_rede') }, [d.envio])
  const larguraAtual = d.larguraPontos ?? (d.larguraMm === 58 ? 384 : 576)
  const aviso = avisoDriver(d)
  // "Tentar envio direto" em UM clique: liga o direto (rede se já tem IP, senão fila USB)
  // e já manda o teste de largura para conferir no papel. Voltar ao driver é um clique.
  const direto = envioDiretoSugerido(d)
  const tentarDireto = async () => {
    const r = await agir(url, 'PATCH', { envio: direto }, `${ROTULO_ENVIO[direto].replace(/ — recomendado$/, '')} ligado. Imprimindo o teste de largura…`)
    if (r?.ok) onImprimirTeste()
  }
  const opcao = (ativo: boolean) =>
    ['rounded-menuzia border-2 px-2 py-2 text-[12.5px] font-semibold disabled:opacity-40', ativo ? 'border-primary bg-alert-bg/50 text-primary' : 'border-border text-text-main hover:border-primary'].join(' ')

  return (
    <div className="space-y-3 rounded-menuzia border border-border p-3" data-testid="calibrar-envio">
      <p className="text-[13px] font-semibold">Como a impressora recebe</p>

      {aviso && (
        <div className="space-y-2 rounded-menuzia border border-warn/40 bg-warn-bg px-3 py-2 text-[12.5px] text-[#92400E]" data-testid="calibrar-aviso-driver" role="alert">
          <p className="flex items-start gap-1.5 font-semibold"><AlertTriangle className="mt-[1px] h-4 w-4 flex-shrink-0" /> {aviso}</p>
          <p>Ajuste o papel do driver para 80 mm (guia abaixo) ou use o envio direto: aí quem manda na largura é o sistema.</p>
          <div className="flex flex-wrap gap-2">
            <a href="/guia-impressora-80mm.html" target="_blank" rel="noopener noreferrer" className="rounded-menuzia border border-[#92400E]/40 bg-white px-2.5 py-1.5 font-semibold">Como resolver</a>
            <button type="button" disabled={ocupado} onClick={() => void tentarDireto()} data-testid="calibrar-usar-direto" className="rounded-menuzia bg-[#92400E] px-2.5 py-1.5 font-semibold text-white disabled:opacity-40">
              Tentar envio direto
            </button>
          </div>
        </div>
      )}

      {!aviso && d.envio === 'driver' && (
        <div className="space-y-2 rounded-menuzia border border-primary/30 bg-alert-bg/40 px-3 py-2 text-[12.5px] text-[#075985]" data-testid="calibrar-recomenda-direto">
          <p><b>Recomendado para impressora térmica (ESC/POS): envio direto.</b> O sistema manda a comanda pronta, na largura certa, sem depender do driver do Windows.</p>
          <button type="button" disabled={ocupado} onClick={() => void tentarDireto()} data-testid="calibrar-tentar-direto" className="rounded-menuzia bg-[#0570AE] px-2.5 py-1.5 font-semibold text-white disabled:opacity-40">
            Tentar envio direto
          </button>
        </div>
      )}

      <div>
        <p className="mb-1 text-[12px] text-text-subtle">Largura (pontos) — papel {d.larguraMm} mm</p>
        <div className="grid grid-cols-3 gap-2">
          {LARGURAS_PONTOS.map((n) => (
            <button key={n} type="button" disabled={ocupado} aria-pressed={larguraAtual === n} data-testid={`calibrar-largura-${n}`}
              onClick={() => void agir(url, 'PATCH', { larguraPontos: n === (d.larguraMm === 58 ? 384 : 576) ? null : n, deslocamentoPontos: d.deslocamentoPontos ?? 0 }, `Largura: ${n} pontos.`)}
              className={opcao(larguraAtual === n)}>
              {n}{n === (d.larguraMm === 58 ? 384 : 576) ? ' (padrão)' : ''}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11.5px] text-text-subtle">384 = 58 mm · 512 = 80 mm com área menor · 576 = 80 mm</p>
      </div>

      <div>
        <p className="mb-1 text-[12px] text-text-subtle">Intensidade</p>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(ROTULO_INTENSIDADE) as Intensidade[]).map((v) => (
            <button key={v} type="button" disabled={ocupado} aria-pressed={d.intensidade === v} data-testid={`calibrar-intensidade-${v}`}
              onClick={() => void agir(url, 'PATCH', { intensidade: v }, `Intensidade: ${ROTULO_INTENSIDADE[v].toLowerCase()}.`)} className={opcao(d.intensidade === v)}>
              {ROTULO_INTENSIDADE[v]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[12px] text-text-subtle">Envio</p>
        <div className="grid gap-2">
          {(Object.keys(ROTULO_ENVIO) as Envio[]).map((v) => (
            <button key={v} type="button" disabled={ocupado} aria-pressed={d.envio === v || (v === 'raw_rede' && querRede)} data-testid={`calibrar-envio-${v}`}
              onClick={() => { if (v === 'raw_rede') setQuerRede(true); else { setQuerRede(false); void agir(url, 'PATCH', { envio: v }, `Envio: ${ROTULO_ENVIO[v]}.`) } }}
              className={[opcao(d.envio === v || (v === 'raw_rede' && querRede)), 'text-left'].join(' ')}>
              {ROTULO_ENVIO[v]}
            </button>
          ))}
        </div>
        {querRede && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-[12px]">
              IP da impressora
              <input value={ip} onChange={(e) => setIp(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="192.168.0.50" data-testid="calibrar-ip" className="mt-1 w-full rounded-menuzia border border-border px-3 py-2 text-[13px]" />
            </label>
            <label className="w-[90px] text-[12px]">
              Porta
              <input value={porta} onChange={(e) => setPorta(e.target.value.replace(/\D/g, ''))} inputMode="numeric" data-testid="calibrar-porta" className="mt-1 w-full rounded-menuzia border border-border px-3 py-2 text-[13px]" />
            </label>
            <button type="button" disabled={ocupado || !ehIpv4(ip)} onClick={() => void agir(url, 'PATCH', { envio: 'raw_rede', redeIp: ip.trim(), redePorta: Number(porta) || 9100 }, `Envio pela rede: ${ip}:${Number(porta) || 9100}.`)} data-testid="calibrar-salvar-rede" className="rounded-menuzia bg-primary px-3 py-2 text-[12px] font-bold text-white disabled:opacity-40">
              Salvar
            </button>
            <p className="w-full text-[11.5px] text-text-subtle">O IP aparece no autoteste da impressora (segure o FEED ao ligar). Porta padrão: 9100.</p>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 text-[12px] text-text-subtle">Modo de impressão</p>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(ROTULO_MODO) as ModoImpressao[]).map((v) => (
            <button key={v} type="button" disabled={ocupado} aria-pressed={d.modoImpressao === v} data-testid={`calibrar-modo-${v}`}
              onClick={() => void agir(url, 'PATCH', { modoImpressao: v }, `Modo: ${ROTULO_MODO[v].toLowerCase()}.`)} className={opcao(d.modoImpressao === v)}>
              {ROTULO_MODO[v]}
            </button>
          ))}
        </div>
        {d.modoImpressao === 'texto' && <p className="mt-1 text-[11.5px] text-text-subtle">Texto usa as letras da própria impressora (sem logo), com os acentos na página WPC1252 (o teste de largura imprime &quot;ÇÃÉÕ&quot; para conferir), e vai sempre direto, sem o driver.</p>}
      </div>

      <button type="button" disabled={ocupado} onClick={onImprimirTeste} data-testid="imprimir-teste-largura" className="w-full rounded-menuzia border-2 border-primary py-2.5 text-[13px] font-bold text-primary disabled:opacity-40">
        Imprimir teste de largura
      </button>
      <p className="text-[11.5px] text-text-subtle">Precisa do Assistente Menuzia Beta 0.2.0-beta.7 ou mais novo no computador da impressora.</p>
    </div>
  )
}
