/**
 * Clientes ⇄ CSV (2026-10-01). Regras puras, usadas no navegador (conferência) e no servidor
 * (que valida tudo de novo antes de gravar).
 *
 * Importação: detecta codificação (UTF-8 ou Windows-1252, a do Excel em português),
 * separador (; ou ,) e cabeçalho; liga as colunas aos campos pelos nomes mais comuns;
 * normaliza o telefone no MESMO formato do sistema (55 + DDD + número, lib/telefone-br).
 * Exportação: "Planilha completa" em ; com BOM e formato brasileiro; o formato do Meta Ads
 * continua o de antes (gerarCsvMetaAds).
 */
import { motivoTelefoneInvalido, telefoneWhatsapp } from '@/lib/telefone-br'

export const LIMITE_BYTES = 5 * 1024 * 1024
export const LIMITE_LINHAS = 20_000
export const LOTE_IMPORTACAO = 500

export const CAMPOS = [
  { chave: 'nome', rotulo: 'Nome', obrigatorio: true, apelidos: ['nome', 'cliente', 'nome do cliente', 'nome completo', 'name', 'razao social'] },
  { chave: 'telefone', rotulo: 'Telefone', obrigatorio: true, apelidos: ['telefone', 'celular', 'whatsapp', 'whats', 'fone', 'phone', 'tel', 'telefone celular', 'contato', 'numero de telefone', 'telefone 1'] },
  { chave: 'email', rotulo: 'E-mail', obrigatorio: false, apelidos: ['email', 'e-mail', 'e mail', 'mail'] },
  { chave: 'data_nascimento', rotulo: 'Data de nascimento', obrigatorio: false, apelidos: ['data_nascimento', 'data de nascimento', 'nascimento', 'aniversario', 'data nascimento', 'birthday', 'dt nascimento'] },
  { chave: 'cep', rotulo: 'CEP', obrigatorio: false, apelidos: ['cep', 'codigo postal', 'zip'] },
  { chave: 'rua', rotulo: 'Rua', obrigatorio: false, apelidos: ['rua', 'endereco', 'logradouro', 'avenida', 'endereco rua'] },
  { chave: 'numero', rotulo: 'Número', obrigatorio: false, apelidos: ['numero', 'n', 'no', 'num', 'nro', 'numero da casa'] },
  { chave: 'complemento', rotulo: 'Complemento', obrigatorio: false, apelidos: ['complemento', 'compl', 'apto', 'apartamento'] },
  { chave: 'bairro', rotulo: 'Bairro', obrigatorio: false, apelidos: ['bairro', 'distrito'] },
  { chave: 'cidade', rotulo: 'Cidade', obrigatorio: false, apelidos: ['cidade', 'municipio', 'city'] },
  { chave: 'uf', rotulo: 'UF', obrigatorio: false, apelidos: ['uf', 'estado', 'state'] },
  { chave: 'observacoes', rotulo: 'Observações', obrigatorio: false, apelidos: ['observacoes', 'observacao', 'obs', 'notas', 'nota', 'anotacoes'] },
] as const

export type Campo = (typeof CAMPOS)[number]['chave']
/** Coluna do arquivo → campo do sistema (null = ignorar a coluna). */
export type Mapeamento = (Campo | null)[]

export const MODELO_CABECALHO: Campo[] = ['nome', 'telefone', 'email', 'data_nascimento', 'cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'observacoes']
export const MODELO_EXEMPLOS: string[][] = [
  ['Maria da Silva', '(27) 99999-8888', 'maria@email.com', '15/03/1990', '29100-000', 'Rua das Flores', '120', 'Apto 302', 'Centro', 'Vila Velha', 'ES', 'Prefere sem cebola'],
  ['João Souza', '+55 27 98888-7777', '', '02/11/1985', '', 'Av. Brasil', '45', '', 'Praia da Costa', 'Vila Velha', 'ES', ''],
]

// ── Leitura do arquivo ──────────────────────────────────────────────────────

/** UTF-8 quando decodifica sem erro; senão Windows-1252 (Latin-1 do Excel). Sem o BOM. */
export function decodificar(bytes: Uint8Array): { texto: string; codificacao: 'UTF-8' | 'Windows-1252' } {
  let texto: string
  let codificacao: 'UTF-8' | 'Windows-1252' = 'UTF-8'
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    texto = new TextDecoder('windows-1252').decode(bytes)
    codificacao = 'Windows-1252'
  }
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1)
  return { texto, codificacao }
}

/** Arquivo binário (planilha .xlsx, imagem…) disfarçado de CSV. */
export function pareceBinario(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 2048)
  if (n >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return true // ZIP (xlsx)
  let nulos = 0
  for (let i = 0; i < n; i++) if (bytes[i] === 0) nulos++
  return nulos > 0
}

/** ; ou , — o que mais aparece na primeira linha, fora de aspas. */
export function detectarSeparador(texto: string): ';' | ',' {
  let pv = 0, v = 0, aspas = false
  for (const ch of texto.slice(0, 5000)) {
    if (ch === '"') aspas = !aspas
    else if (!aspas && (ch === '\n' || ch === '\r')) break
    else if (!aspas && ch === ';') pv++
    else if (!aspas && ch === ',') v++
  }
  return pv >= v && pv > 0 ? ';' : v > 0 ? ',' : ';'
}

/** CSV com aspas, aspas dobradas e quebra de linha dentro de aspas. Linhas vazias saem. */
export function lerCsv(texto: string, sep: string): string[][] {
  const linhas: string[][] = []
  let campo = '', linha: string[] = [], aspas = false
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++ } else aspas = false
      } else campo += ch
    } else if (ch === '"' && campo === '') aspas = true
    else if (ch === sep) { linha.push(campo); campo = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++
      linha.push(campo); campo = ''
      if (linha.some((c) => c.trim() !== '')) linhas.push(linha)
      linha = []
    } else campo += ch
  }
  linha.push(campo)
  if (linha.some((c) => c.trim() !== '')) linhas.push(linha)
  return linhas
}

export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-.º°]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Campo que um nome de coluna representa, pelos apelidos. */
export function campoDoNome(nome: string): Campo | null {
  const n = semAcento(nome)
  if (!n) return null
  for (const c of CAMPOS) if (c.apelidos.some((a) => semAcento(a) === n)) return c.chave
  for (const c of CAMPOS) if (c.apelidos.some((a) => a.length > 3 && n.includes(semAcento(a)))) return c.chave
  return null
}

/** A primeira linha é cabeçalho quando algum campo dela é um nome conhecido e nenhum é telefone. */
export function temCabecalho(primeira: string[]): boolean {
  return primeira.some((c) => campoDoNome(c) !== null) && !primeira.some((c) => telefoneWhatsapp(c) !== null)
}

/** Mapeamento automático: pelo cabeçalho; sem cabeçalho, na ordem do modelo. Cada campo uma vez só. */
export function mapearAutomatico(primeira: string[], cabecalho: boolean): Mapeamento {
  const usados = new Set<Campo>()
  return primeira.map((c, i) => {
    const campo = cabecalho ? campoDoNome(c) : (MODELO_CABECALHO[i] ?? null)
    if (!campo || usados.has(campo)) return null
    usados.add(campo)
    return campo
  })
}

// ── Validação ───────────────────────────────────────────────────────────────

export interface ClienteImportado {
  nome: string
  telefone: string
  email: string | null
  data_nascimento: string | null // AAAA-MM-DD
  cep: string | null
  rua: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  observacoes: string | null
}

export interface LinhaConferida {
  /** Linha no arquivo (1 = primeira linha de dados, contando o cabeçalho se houver). */
  linha: number
  original: string[]
  dados: ClienteImportado | null
  erros: string[]
  avisos: string[]
}

/** DD/MM/AAAA (ou AAAA-MM-DD) → AAAA-MM-DD; null se não for data válida. */
export function dataBr(valor: string): string | null {
  const v = valor.trim()
  let d: number, m: number, a: number
  const br = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (br) { d = +br[1]; m = +br[2]; a = +br[3]; if (a < 100) a += a > 30 ? 1900 : 2000 }
  else if (iso) { a = +iso[1]; m = +iso[2]; d = +iso[3] }
  else return null
  const dt = new Date(Date.UTC(a, m - 1, d))
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  if (a < 1900 || dt.getTime() > Date.now()) return null
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const limpa = (v: string | undefined, max = 200) => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  return t || null
}

/** Interpreta uma linha. Erros barram a linha; avisos só descartam o campo ruim. */
export function conferirLinha(cols: string[], mapa: Mapeamento, linha: number): LinhaConferida {
  const v: Partial<Record<Campo, string>> = {}
  mapa.forEach((campo, i) => { if (campo) v[campo] = cols[i] ?? '' })
  const erros: string[] = []
  const avisos: string[] = []
  const nome = limpa(v.nome, 120)
  if (!nome) erros.push('Nome vazio')
  const telBruto = (v.telefone ?? '').trim()
  const telefone = telefoneWhatsapp(telBruto)
  if (!telBruto) erros.push('Telefone vazio')
  else if (!telefone) erros.push(`Telefone inválido (${motivoTelefoneInvalido(telBruto) ?? 'formato'})`)
  let email = limpa(v.email, 160)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { avisos.push('E-mail inválido (ignorado)'); email = null }
  let nasc: string | null = null
  if (v.data_nascimento?.trim()) {
    nasc = dataBr(v.data_nascimento)
    if (!nasc) avisos.push('Data de nascimento inválida (use DD/MM/AAAA; ignorada)')
  }
  let cep = limpa(v.cep, 12)
  if (cep) {
    const d = cep.replace(/\D/g, '')
    if (d.length === 8) cep = `${d.slice(0, 5)}-${d.slice(5)}`
    else { avisos.push('CEP inválido (ignorado)'); cep = null }
  }
  let uf = limpa(v.uf, 30)?.toUpperCase() ?? null
  if (uf && !/^[A-Z]{2}$/.test(uf)) { avisos.push('UF inválida (ignorada)'); uf = null }
  return {
    linha,
    original: cols,
    erros,
    avisos,
    dados: erros.length ? null : {
      nome: nome!, telefone: telefone!, email, data_nascimento: nasc, cep,
      rua: limpa(v.rua), numero: limpa(v.numero, 20), complemento: limpa(v.complemento, 120), bairro: limpa(v.bairro, 120),
      cidade: limpa(v.cidade, 120), uf, observacoes: limpa(v.observacoes, 500),
    },
  }
}

/** Confere todas as linhas e marca telefone repetido no próprio arquivo (fica a primeira). */
export function conferirArquivo(dados: string[][], mapa: Mapeamento, primeiraLinha: number): LinhaConferida[] {
  const vistos = new Map<string, number>()
  return dados.map((cols, i) => {
    const r = conferirLinha(cols, mapa, primeiraLinha + i)
    if (r.dados) {
      const antes = vistos.get(r.dados.telefone)
      if (antes !== undefined) { r.erros.push(`Telefone repetido no arquivo (igual à linha ${antes})`); r.dados = null }
      else vistos.set(r.dados.telefone, r.linha)
    }
    return r
  })
}

export function mapeamentoValido(mapa: Mapeamento): string | null {
  if (!mapa.includes('nome')) return 'Escolha qual coluna é o Nome.'
  if (!mapa.includes('telefone')) return 'Escolha qual coluna é o Telefone.'
  return null
}

// ── Geração de CSV ──────────────────────────────────────────────────────────

export const BOM = '﻿'

function celula(v: string | number | null | undefined, sep: string): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s
}

export function gerarCsv(linhas: (string | number | null | undefined)[][], sep = ';'): string {
  return linhas.map((l) => l.map((c) => celula(c, sep)).join(sep)).join('\r\n')
}

export function modeloCsv(): string {
  return BOM + gerarCsv([MODELO_CABECALHO, ...MODELO_EXEMPLOS])
}

/** Arquivo com as linhas que deram erro e o motivo, no mesmo separador. */
export function csvDeErros(cabecalho: string[] | null, linhas: LinhaConferida[]): string {
  const ruins = linhas.filter((l) => l.erros.length)
  const largura = Math.max(cabecalho?.length ?? 0, ...ruins.map((l) => l.original.length))
  const cab = [...(cabecalho ?? Array.from({ length: largura }, (_, i) => `coluna_${i + 1}`)), 'linha', 'motivo']
  return BOM + gerarCsv([cab, ...ruins.map((l) => [...l.original, ...Array(largura - l.original.length).fill(''), l.linha, l.erros.join('; ')])])
}

// ── Exportação ──────────────────────────────────────────────────────────────

export type BaseDoPeriodo = 'compra' | 'cadastro'
export interface FiltroExportacao {
  de: string | null // AAAA-MM-DD (inclusive), null = sem limite
  ate: string | null
  base: BaseDoPeriodo
  recorrentes?: boolean
  umaVez?: boolean
  comTelefone?: boolean
}

export interface ClienteExportavel {
  nome: string
  telefone: string
  totalPedidos: number
  ultimaCompraEm: string | null
  /** Primeira compra ou, para importado sem pedido, o cadastro. */
  cadastradoEm: string | null
}

/** Dia (AAAA-MM-DD) no horário de São Paulo. */
export function diaSP(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

export function filtrarExportacao<T extends ClienteExportavel>(clientes: T[], f: FiltroExportacao): T[] {
  return clientes.filter((c) => {
    const ref = f.base === 'compra' ? c.ultimaCompraEm : c.cadastradoEm
    if (f.de || f.ate) {
      if (!ref) return false
      const d = diaSP(ref)
      if (f.de && d < f.de) return false
      if (f.ate && d > f.ate) return false
    }
    if (f.recorrentes && c.totalPedidos < 2) return false
    if (f.umaVez && c.totalPedidos !== 1) return false
    if (f.comTelefone && !telefoneWhatsapp(c.telefone)) return false
    return true
  })
}

export function nomeArquivoExportacao(slug: string, de: string | null, ate: string | null, hoje: string): string {
  const s = (slug || 'loja').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'loja'
  return `clientes-${s}-${de ?? 'inicio'}_${ate ?? hoje}.csv`
}

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const reais = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dataHoraBr = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

export interface ClientePlanilha extends ClienteExportavel {
  endereco: { rua: string; numero: string; complemento: string; bairro: string; cep: string; cidade: string }
  valorTotal: number
  ticketMedio: number
  pedidosPorSemana: number
  diaSemanaPreferido: number | null
  gastoSemanalMedio: number
}

export function enderecoTexto(e: ClientePlanilha['endereco']): string {
  const l1 = [e.rua, e.numero].filter(Boolean).join(', ')
  return [l1, e.complemento, e.bairro, e.cidade, e.cep ? `CEP ${e.cep}` : ''].filter(Boolean).join(' - ')
}

/** "Planilha completa (Excel)": as colunas da tabela, ; e BOM, formato brasileiro. */
export function planilhaCompleta(clientes: ClientePlanilha[]): string {
  const cab = ['Nome', 'Telefone', 'Endereço', 'Pedidos', 'Última compra', 'Total gasto (R$)', 'Ticket médio (R$)', 'Recorrência (pedidos/semana)', 'Dia preferido', 'Gasto por semana (R$)']
  return BOM + gerarCsv([cab, ...clientes.map((c) => [
    c.nome, c.telefone, enderecoTexto(c.endereco), c.totalPedidos, dataHoraBr(c.ultimaCompraEm),
    reais(c.valorTotal), reais(c.ticketMedio), c.pedidosPorSemana.toLocaleString('pt-BR', { maximumFractionDigits: 1 }),
    c.diaSemanaPreferido !== null ? DIAS[c.diaSemanaPreferido] : '', reais(c.gastoSemanalMedio),
  ])])
}
