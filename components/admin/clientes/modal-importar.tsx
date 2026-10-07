'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileText, RefreshCw, UploadCloud, XCircle } from 'lucide-react'
import {
  CAMPOS, LIMITE_BYTES, LIMITE_LINHAS, LOTE_IMPORTACAO, MODELO_CABECALHO, MODELO_EXEMPLOS, BOM,
  conferirArquivo, csvDeErros, decodificar, detectarSeparador, gerarCsv, lerCsv, mapearAutomatico, mapeamentoValido,
  modeloCsv, pareceBinario, temCabecalho, type Campo, type LinhaConferida, type Mapeamento,
} from '@/lib/clientes-csv'
import { BTN, ModalCsv, baixarArquivo, tamanhoLegivel } from './csv-comum'

/**
 * Importar clientes em 3 etapas: (1) modelo + arquivo, (2) conferência — nada é gravado
 * antes do botão "Importar" —, (3) gravação em lotes com barra de progresso e resultado.
 */
type Modo = 'ignorar' | 'completar' | 'atualizar'
interface Arquivo { nome: string; tamanho: number; linhas: string[][]; separador: ';' | ','; codificacao: string; cabecalho: boolean }
interface Resultado { criados: number; atualizados: number; ignorados: number; erros: number }

export function ModalImportar({ onFechar, onImportou }: { onFechar: () => void; onImportou: () => void }) {
  const [etapa, setEtapa] = useState<1 | 2 | 3>(1)
  const [arquivo, setArquivo] = useState<Arquivo | null>(null)
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const [mapa, setMapa] = useState<Mapeamento>([])
  const [existentes, setExistentes] = useState<Set<string>>(new Set())
  const [descadastrados, setDescadastrados] = useState<Set<string>>(new Set())
  const [conferindo, setConferindo] = useState(false)
  const [modo, setModo] = useState<Modo>('ignorar')
  const [lgpd, setLgpd] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [erroImportar, setErroImportar] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)
  const chave = useRef<string>('')
  const input = useRef<HTMLInputElement>(null)

  async function lerArquivo(f: File) {
    setErroArquivo(null)
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') { setErroArquivo('Escolha um arquivo .csv (no Excel: Arquivo › Salvar como › CSV).'); return }
    if (f.size > LIMITE_BYTES) { setErroArquivo(`O arquivo tem ${tamanhoLegivel(f.size)}. O limite é 5 MB — divida em arquivos menores.`); return }
    const bytes = new Uint8Array(await f.arrayBuffer())
    if (pareceBinario(bytes)) { setErroArquivo('Esse arquivo não é um CSV de texto (parece uma planilha .xlsx ou outro formato). No Excel, use Salvar como › CSV.'); return }
    const { texto, codificacao } = decodificar(bytes)
    const separador = detectarSeparador(texto)
    const linhas = lerCsv(texto, separador)
    if (!linhas.length) { setErroArquivo('O arquivo está vazio.'); return }
    const cabecalho = temCabecalho(linhas[0])
    const dados = linhas.length - (cabecalho ? 1 : 0)
    if (dados > LIMITE_LINHAS) { setErroArquivo(`O arquivo tem ${dados.toLocaleString('pt-BR')} linhas. O limite é ${LIMITE_LINHAS.toLocaleString('pt-BR')} por importação.`); return }
    if (dados === 0) { setErroArquivo('O arquivo só tem o cabeçalho, sem clientes.'); return }
    setArquivo({ nome: f.name, tamanho: f.size, linhas, separador, codificacao, cabecalho })
    setMapa(mapearAutomatico(linhas[0], cabecalho))
  }

  const dados = useMemo(() => (arquivo ? arquivo.linhas.slice(arquivo.cabecalho ? 1 : 0) : []), [arquivo])
  const largura = useMemo(() => Math.max(0, ...(arquivo?.linhas.slice(0, 50).map((l) => l.length) ?? [0])), [arquivo])
  const mapaCompleto = useMemo(() => Array.from({ length: largura }, (_, i) => mapa[i] ?? null), [mapa, largura])
  const conferidas: LinhaConferida[] = useMemo(() => (arquivo && !mapeamentoValido(mapaCompleto) ? conferirArquivo(dados, mapaCompleto, arquivo.cabecalho ? 2 : 1) : []), [arquivo, dados, mapaCompleto])
  const validas = conferidas.filter((l) => l.dados)
  const comErro = conferidas.filter((l) => !l.dados)
  const jaExistem = validas.filter((l) => existentes.has(l.dados!.telefone))
  const novos = validas.length - jaExistem.length
  const saiu = validas.filter((l) => descadastrados.has(l.dados!.telefone)).length

  // Conferência no servidor (nada é gravado): quem já existe e quem pediu para sair.
  const telsChave = validas.map((l) => l.dados!.telefone).join(',')
  useEffect(() => {
    if (etapa !== 2 || !telsChave) return
    let vivo = true
    setConferindo(true)
    const t = setTimeout(async () => {
      const r = await fetch('/api/admin/clientes/importar/conferir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telefones: telsChave.split(',') }) })
      const j = await r.json().catch(() => null)
      if (!vivo) return
      setConferindo(false)
      if (r.ok) { setExistentes(new Set(j.existentes)); setDescadastrados(new Set(j.descadastrados)) }
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [etapa, telsChave])

  const aEnviar = modo === 'ignorar' ? novos : validas.length

  async function importar() {
    if (importando || !arquivo) return
    setImportando(true)
    setErroImportar(null)
    setEtapa(3)
    if (!chave.current) chave.current = crypto.randomUUID()
    const linhas = validas.map((l) => l.dados!)
    const lotes = Math.max(1, Math.ceil(linhas.length / LOTE_IMPORTACAO))
    const total: Resultado = { criados: 0, atualizados: 0, ignorados: 0, erros: 0 }
    for (let i = 0; i < lotes; i++) {
      const corpo = { acao: 'lote', chave: chave.current, arquivoNome: arquivo.nome, modo, totalLinhas: dados.length, errosArquivo: comErro.length, lote: i, linhas: linhas.slice(i * LOTE_IMPORTACAO, (i + 1) * LOTE_IMPORTACAO) }
      let ok = false
      // Internet caiu: tenta de novo o MESMO lote (o servidor não grava duas vezes).
      for (let tentativa = 0; tentativa < 4 && !ok; tentativa++) {
        try {
          const r = await fetch('/api/admin/clientes/importar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
          const j = await r.json().catch(() => null)
          if (r.ok) { total.criados += j.criados; total.atualizados += j.atualizados; total.ignorados += j.ignorados; total.erros += j.erros; ok = true }
          else if (r.status < 500) { setErroImportar(j?.error ?? 'Não foi possível importar.'); setImportando(false); return }
        } catch { /* rede */ }
        if (!ok) await new Promise((res) => setTimeout(res, 800 * (tentativa + 1)))
      }
      if (!ok) { setErroImportar('A conexão caiu. Clique em "Tentar de novo": o que já foi gravado não se repete.'); setImportando(false); return }
      setProgresso(Math.round(((i + 1) / lotes) * 100))
    }
    const r = await fetch('/api/admin/clientes/importar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'concluir', chave: chave.current }) })
    const j = await r.json().catch(() => null)
    const imp = j?.importacao
    setResultado(imp ? { criados: imp.criados, atualizados: imp.atualizados, ignorados: imp.ignorados, erros: imp.erros } : { ...total, erros: total.erros + comErro.length })
    setImportando(false)
    onImportou()
  }

  function relatorio() {
    if (!resultado || !arquivo) return
    const resumo = gerarCsv([['resumo', 'quantidade'], ['criados', resultado.criados], ['atualizados', resultado.atualizados], ['ignorados', resultado.ignorados], ['com erro', resultado.erros]])
    const erros = comErro.length ? '\r\n\r\n' + csvDeErros(arquivo.cabecalho ? arquivo.linhas[0] : null, conferidas).replace(BOM, '') : ''
    baixarArquivo(BOM + resumo + erros, `relatorio-importacao-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  const nomesColunas = arquivo ? (arquivo.cabecalho ? arquivo.linhas[0] : Array.from({ length: largura }, (_, i) => `Coluna ${i + 1}`)) : []

  // ── Etapa 1 ──
  if (etapa === 1) return (
    <ModalCsv titulo="Importar clientes" subtitulo="Etapa 1 de 3 · Modelo e arquivo" onFechar={onFechar} testid="modal-importar" largura={860}
      rodape={<>
        <button type="button" className={BTN.sec} onClick={onFechar}>Cancelar</button>
        <button type="button" className={BTN.pri} disabled={!arquivo} onClick={() => setEtapa(2)} data-testid="importar-continuar">Continuar</button>
      </>}>
      <p className="text-[13px] leading-relaxed text-[#374151]">Monte uma planilha com uma linha por cliente, como no modelo abaixo, e salve como <b>CSV</b>. Campos com * são obrigatórios. Clientes importados entram com 0 pedidos e não mexem nas métricas de compra.</p>
      <div className="mt-3 overflow-x-auto rounded-[6px] border border-[#e5e7eb]" data-testid="modelo-tabela">
        <table className="w-full min-w-[900px] text-left text-[12px]">
          <thead className="bg-[#f9fafb] text-[#374151]"><tr>{MODELO_CABECALHO.map((c) => <th key={c} className="whitespace-nowrap px-2.5 py-2 font-semibold">{c}{c === 'nome' || c === 'telefone' ? '*' : ''}</th>)}</tr></thead>
          <tbody>{MODELO_EXEMPLOS.map((l, i) => <tr key={i} className="border-t border-[#f0f1f3]">{l.map((v, j) => <td key={j} className="whitespace-nowrap px-2.5 py-1.5 text-[#4b5563]">{v || '—'}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <ul className="mt-2.5 list-disc space-y-0.5 pl-5 text-[12.5px] text-[#4b5563]">
        <li>Telefone com DDD — aceita com ou sem +55, espaços, traços e parênteses.</li>
        <li>Data no formato DD/MM/AAAA. Separador ponto e vírgula ou vírgula; o sistema descobre sozinho.</li>
        <li>Limite: 5 MB ou {LIMITE_LINHAS.toLocaleString('pt-BR')} linhas por arquivo.</li>
      </ul>
      <button type="button" className={`${BTN.sec} mt-3`} onClick={() => baixarArquivo(modeloCsv(), 'modelo-clientes.csv')} data-testid="baixar-modelo"><Download className="h-4 w-4" /> Baixar modelo CSV</button>

      <input ref={input} type="file" accept=".csv,text/csv" className="hidden" data-testid="importar-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void lerArquivo(f) }} />
      {!arquivo ? (
        <div role="button" tabIndex={0} data-testid="importar-area"
          onClick={() => input.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
          onDragEnter={(e) => { e.preventDefault(); setArrastando(true) }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); const f = e.dataTransfer.files?.[0]; if (f) void lerArquivo(f) }}
          data-arrastando={arrastando ? 'sim' : 'nao'}
          className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-[8px] border-2 border-dashed px-6 py-10 text-center transition-colors ${arrastando ? 'border-[#0688d4] bg-[#eef6fc]' : 'border-[#c9d2dc] bg-[#fafbfc] hover:border-[#0688d4] hover:bg-[#f5fbff]'}`}>
          <UploadCloud className={`h-11 w-11 ${arrastando ? 'text-[#0688d4]' : 'text-[#9ca3af]'}`} />
          <p className="mt-2 text-[14px] font-semibold text-[#1f2937]">Arraste o arquivo CSV aqui ou clique para selecionar</p>
          <p className="mt-0.5 text-[12px] text-[#6b7280]">Somente .csv · até 5 MB</p>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3 rounded-[8px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3" data-testid="importar-arquivo">
          <FileText className="h-8 w-8 flex-shrink-0 text-[#15803d]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-[#1f2937]">{arquivo.nome}</div>
            <div className="text-[12px] text-[#4b5563]">{tamanhoLegivel(arquivo.tamanho)} · {dados.length.toLocaleString('pt-BR')} linhas</div>
          </div>
          <button type="button" className={BTN.link} onClick={() => { setArquivo(null); input.current?.click() }} data-testid="trocar-arquivo">Trocar arquivo</button>
        </div>
      )}
      {erroArquivo && <p className="mt-2 flex items-start gap-1.5 text-[12.5px] font-semibold text-[#b91c1c]" data-testid="importar-erro-arquivo"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />{erroArquivo}</p>}
    </ModalCsv>
  )

  // ── Etapa 2 ──
  if (etapa === 2 && arquivo) {
    const problemaMapa = mapeamentoValido(mapaCompleto)
    return (
      <ModalCsv titulo="Importar clientes" subtitulo={`Etapa 2 de 3 · Conferência de ${arquivo.nome}`} onFechar={onFechar} testid="modal-importar" largura={980}
        rodape={<>
          <button type="button" className={`${BTN.sec} mr-auto`} onClick={() => setEtapa(1)}>Voltar</button>
          <button type="button" className={BTN.pri} disabled={!!problemaMapa || !lgpd || aEnviar === 0 || conferindo || importando} onClick={() => void importar()} data-testid="importar-confirmar">
            Importar {aEnviar.toLocaleString('pt-BR')} {aEnviar === 1 ? 'cliente' : 'clientes'}
          </button>
        </>}>
        <p className="text-[12.5px] text-[#4b5563]" data-testid="importar-deteccao">
          Separador <b>{arquivo.separador === ';' ? 'ponto e vírgula' : 'vírgula'}</b> · codificação <b>{arquivo.codificacao}</b> ·{' '}
          <label className="inline-flex cursor-pointer items-center gap-1"><input type="checkbox" className="h-3.5 w-3.5 accent-[#0688d4]" checked={arquivo.cabecalho}
            onChange={(e) => { const c = e.target.checked; setArquivo({ ...arquivo, cabecalho: c }); setMapa(mapearAutomatico(arquivo.linhas[0], c)) }} data-testid="tem-cabecalho" /> primeira linha é cabeçalho</label>
        </p>

        <h3 className="mb-2 mt-4 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#5b6472]">Colunas do arquivo → campos</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="mapeamento">
          {nomesColunas.map((nome, i) => (
            <label key={i} className="flex items-center gap-2 rounded-[6px] border border-[#e5e7eb] px-2.5 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-[#1f2937]" title={nome}>{nome || `Coluna ${i + 1}`}</span>
                <span className="block truncate text-[11.5px] text-[#6b7280]">ex.: {dados[0]?.[i] || '—'}</span>
              </span>
              <select className="campanha-filtro !h-9 !min-h-9 max-w-[150px]" value={mapaCompleto[i] ?? ''} data-testid={`mapa-${i}`}
                onChange={(e) => { const v = (e.target.value || null) as Campo | null; setMapa(mapaCompleto.map((m, j) => (j === i ? v : m === v && v ? null : m))) }}>
                <option value="">Ignorar coluna</option>
                {CAMPOS.map((c) => <option key={c.chave} value={c.chave}>{c.rotulo}{c.obrigatorio ? ' *' : ''}</option>)}
              </select>
            </label>
          ))}
        </div>
        {problemaMapa && <p className="mt-2 text-[12.5px] font-semibold text-[#b91c1c]" data-testid="erro-mapeamento">{problemaMapa}</p>}

        {!problemaMapa && (
          <>
            <div className="mt-4 grid gap-2 sm:grid-cols-3" data-testid="importar-resumo">
              <Resumo icone={CheckCircle2} cor="#15803d" fundo="#f0fdf4" valor={novos} rotulo="válidos (novos)" testid="resumo-novos" />
              <Resumo icone={RefreshCw} cor="#0369a1" fundo="#f0f9ff" valor={jaExistem.length} rotulo="já existem na base (mesmo telefone)" testid="resumo-existentes" />
              <Resumo icone={XCircle} cor="#b91c1c" fundo="#fef2f2" valor={comErro.length} rotulo="com erro" testid="resumo-erros" />
            </div>
            {saiu > 0 && <p className="mt-2 text-[12.5px] text-[#92400e]" data-testid="resumo-descadastrados">{saiu} {saiu === 1 ? 'pediu' : 'pediram'} para não receber campanhas e continua{saiu === 1 ? '' : 'm'} fora delas.</p>}

            {jaExistem.length > 0 && (
              <div className="mt-3 rounded-[6px] border border-[#e5e7eb] px-3 py-2.5">
                <div className="mb-1.5 text-[12.5px] font-semibold text-[#1f2937]">Para os {jaExistem.length} que já existem:</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
                  {([['ignorar', 'Ignorar'], ['completar', 'Completar só os dados vazios'], ['atualizar', 'Atualizar com os dados do arquivo']] as const).map(([v, r]) => (
                    <label key={v} className="flex cursor-pointer items-center gap-2"><input type="radio" name="modo" className="h-4 w-4 accent-[#0688d4]" checked={modo === v} onChange={() => setModo(v)} data-testid={`modo-${v}`} />{r}</label>
                  ))}
                </div>
              </div>
            )}

            {comErro.length > 0 && (
              <div className="mt-3 rounded-[6px] border border-[#fecaca]" data-testid="lista-erros">
                <div className="flex items-center justify-between border-b border-[#fecaca] bg-[#fef2f2] px-3 py-2">
                  <span className="text-[12.5px] font-semibold text-[#b91c1c]">Linhas com erro (não serão importadas)</span>
                  <button type="button" className={BTN.link} onClick={() => baixarArquivo(csvDeErros(arquivo.cabecalho ? arquivo.linhas[0] : null, conferidas), 'linhas-com-erro.csv')} data-testid="baixar-erros">Baixar linhas com erro (CSV)</button>
                </div>
                <ul className="max-h-[150px] divide-y divide-[#fdecec] overflow-y-auto text-[12.5px]">
                  {comErro.slice(0, 100).map((l) => <li key={l.linha} className="px-3 py-1.5"><b>Linha {l.linha}:</b> {l.erros.join('; ')}</li>)}
                </ul>
              </div>
            )}

            <h3 className="mb-2 mt-4 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#5b6472]">Prévia (primeiras 10 linhas)</h3>
            <div className="overflow-x-auto rounded-[6px] border border-[#e5e7eb]" data-testid="previa">
              <table className="w-full min-w-[760px] text-left text-[12px]">
                <thead className="bg-[#f9fafb] text-[#374151]"><tr>{['Linha', 'Nome', 'Telefone', 'E-mail', 'Nascimento', 'Endereço', 'Situação'].map((h) => <th key={h} className="px-2.5 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {conferidas.slice(0, 10).map((l) => {
                    const d = l.dados
                    const sit = !d ? <span className="text-[#b91c1c]">{l.erros[0]}</span> : existentes.has(d.telefone) ? <span className="text-[#0369a1]">Já existe</span> : <span className="text-[#15803d]">Novo</span>
                    return (
                      <tr key={l.linha} className="border-t border-[#f0f1f3]" data-testid="previa-linha">
                        <td className="px-2.5 py-1.5 text-[#6b7280]">{l.linha}</td>
                        <td className="px-2.5 py-1.5 font-medium">{d?.nome ?? '—'}</td>
                        <td className="px-2.5 py-1.5 tabular-nums">{d?.telefone ?? l.original[mapaCompleto.indexOf('telefone')] ?? '—'}</td>
                        <td className="px-2.5 py-1.5">{d?.email ?? '—'}</td>
                        <td className="px-2.5 py-1.5">{d?.data_nascimento ? d.data_nascimento.split('-').reverse().join('/') : '—'}</td>
                        <td className="max-w-[220px] truncate px-2.5 py-1.5">{d ? [d.rua, d.numero, d.bairro, d.cidade, d.uf].filter(Boolean).join(', ') || '—' : '—'}</td>
                        <td className="px-2.5 py-1.5">{sit}{l.avisos.length > 0 && <span className="ml-1 text-[#92400e]" title={l.avisos.join('; ')}>· {l.avisos.length} aviso{l.avisos.length > 1 ? 's' : ''}</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-[6px] border border-[#fcd34d] bg-[#fffbeb] px-3 py-2.5 text-[13px] text-[#78350f]" data-testid="lgpd">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#0688d4]" checked={lgpd} onChange={(e) => setLgpd(e.target.checked)} data-testid="lgpd-check" />
              <span><b>Declaro que estes clientes autorizaram o contato da minha loja.</b> (LGPD) Quem já pediu para não receber campanhas continua fora.</span>
            </label>
          </>
        )}
      </ModalCsv>
    )
  }

  // ── Etapa 3 ──
  return (
    <ModalCsv titulo="Importar clientes" subtitulo="Etapa 3 de 3 · Importação" onFechar={importando ? () => {} : onFechar} testid="modal-importar"
      rodape={importando ? undefined : erroImportar ? <>
        <button type="button" className={BTN.sec} onClick={onFechar}>Fechar</button>
        <button type="button" className={BTN.pri} onClick={() => void importar()} data-testid="importar-tentar">Tentar de novo</button>
      </> : <>
        <button type="button" className={BTN.sec} onClick={relatorio} data-testid="baixar-relatorio"><Download className="h-4 w-4" /> Baixar relatório</button>
        <button type="button" className={BTN.pri} onClick={onFechar} data-testid="importar-fechar">Concluir</button>
      </>}>
      {!resultado ? (
        <div className="py-6" data-testid="importar-progresso">
          <p className="text-[13.5px] font-semibold text-[#1f2937]">{importando ? 'Importando… pode continuar usando a tela.' : 'Importação interrompida'}</p>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-[#e5e7eb]"><div className="h-full rounded-full bg-[#0688d4] transition-[width] duration-300" style={{ width: `${progresso}%` }} /></div>
          <p className="mt-1.5 text-[12px] text-[#6b7280]" data-testid="progresso-pct">{progresso}%</p>
          {erroImportar && <p className="mt-3 text-[12.5px] font-semibold text-[#b91c1c]" data-testid="importar-falhou">{erroImportar}</p>}
        </div>
      ) : (
        <div data-testid="importar-resultado">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-[#15803d]"><CheckCircle2 className="h-5 w-5" /> Importação concluída</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Resumo icone={CheckCircle2} cor="#15803d" fundo="#f0fdf4" valor={resultado.criados} rotulo="criados" testid="res-criados" />
            <Resumo icone={RefreshCw} cor="#0369a1" fundo="#f0f9ff" valor={resultado.atualizados} rotulo="atualizados" testid="res-atualizados" />
            <Resumo icone={FileText} cor="#475569" fundo="#f8fafc" valor={resultado.ignorados} rotulo="ignorados" testid="res-ignorados" />
            <Resumo icone={XCircle} cor="#b91c1c" fundo="#fef2f2" valor={resultado.erros} rotulo="com erro" testid="res-erros" />
          </div>
          <p className="mt-3 text-[12.5px] text-[#4b5563]">Os clientes novos aparecem na lista com 0 pedidos e a marca &quot;Importado&quot;. Dá para desfazer em até 7 dias em CSV › Histórico de importações.</p>
        </div>
      )}
    </ModalCsv>
  )
}

function Resumo({ icone: Icone, cor, fundo, valor, rotulo, testid }: { icone: typeof CheckCircle2; cor: string; fundo: string; valor: number; rotulo: string; testid: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[6px] px-3 py-2.5" style={{ backgroundColor: fundo }} data-testid={testid}>
      <Icone className="h-5 w-5 flex-shrink-0" style={{ color: cor }} />
      <span><span className="block text-[18px] font-semibold tabular-nums" style={{ color: cor }} data-valor>{valor.toLocaleString('pt-BR')}</span><span className="block text-[11.5px] leading-tight text-[#374151]">{rotulo}</span></span>
    </div>
  )
}
