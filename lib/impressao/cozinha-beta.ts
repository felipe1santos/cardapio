import QRCode from 'qrcode'
import type { SupabaseClient } from '@supabase/supabase-js'
import { urlDaRota } from '@/lib/motoboy/qr-rota'

/**
 * Dados que SÓ o Assistente Beta recebe junto da ficha da cozinha (modelo novo da
 * comanda, 2026-09-28). O Assistente antigo continua recebendo exatamente o que recebia:
 * isto entra apenas no ramo "Cozinha e Caixa", para o computador dono da Cozinha.
 *
 * QR no fim da comanda: o Instagram da loja (Ajustes › Perfil da loja). Sem Instagram,
 * o QR do cardápio da loja — assim a comanda sai sempre igual ao modelo, e o QR leva a
 * um lugar que é da loja e que sempre existe. O servidor calcula a matriz; o Beta só
 * desenha os quadrados (o agente não precisa de biblioteca de QR).
 */

export interface QrCozinha {
  /** 'rota' (item 59): o QR da comanda de ENTREGA — o motoboy lê no app e pega a entrega. */
  origem: 'instagram' | 'cardapio' | 'rota'
  url: string
  /**
   * Legenda embaixo do QR (item 59, Assistente beta.10+). Sem ela, o Assistente escolhe pela
   * URL como sempre (Instagram → "Siga a gente…", senão "Peça de novo pelo nosso cardápio").
   */
  frase?: string
  /** Lado da matriz em módulos. */
  tamanho: number
  /** Uma string por linha, '1' = módulo preto. */
  linhas: string[]
}

const cacheQr = new Map<string, QrCozinha>()

function montar(origem: QrCozinha['origem'], url: string, frase?: string): QrCozinha {
  const chave = `${origem}|${url}|${frase ?? ''}`
  const pronto = cacheQr.get(chave)
  if (pronto) return pronto
  // Instagram leva o ícone no meio (como o modelo): correção alta para o miolo coberto
  // continuar legível. Cardápio e rota sem ícone: média, módulos maiores no mesmo espaço.
  const qr = QRCode.create(url, { errorCorrectionLevel: origem === 'instagram' ? 'H' : 'M' })
  const n = qr.modules.size
  const linhas: string[] = []
  for (let y = 0; y < n; y++) {
    let s = ''
    for (let x = 0; x < n; x++) s += qr.modules.get(y, x) ? '1' : '0'
    linhas.push(s)
  }
  const r: QrCozinha = { origem, url, tamanho: n, linhas, ...(frase ? { frase } : {}) }
  if (cacheQr.size > 200) cacheQr.clear()
  cacheQr.set(chave, r)
  return r
}

/**
 * Item 61 (2026-10-08): só dois QRs no papel, NUNCA o do cardápio.
 *   · PRÉ-CONTA: o Instagram da loja (Perfil da loja). Sem Instagram: sem QR. A legenda fica com o
 *     Assistente: "Siga a gente no Instagram @perfil".
 *   · COZINHA de ENTREGA: o QR da rota ("ROTA DE ENTREGA"). Retirada, balcão e mesa: sem QR.
 */
export function qrDaPreConta(instagramUrl: string | null | undefined): QrCozinha | null {
  const url = String(instagramUrl ?? '').trim()
  return url ? montar('instagram', url) : null
}

/** Comanda de ENTREGA — link assinado da rota (abre o app do motoboy), sem dado pessoal. */
export function qrDaRotaImpressa(pedidoId: string): QrCozinha {
  return montar('rota', urlDaRota(pedidoId), 'ROTA DE ENTREGA')
}

export interface ExtrasCozinhaBeta {
  desconto: number
  aceitoEm: string | null
  prontoEm: string | null
  comandaNumero: number | null
  atendente: string | null
  /** Alfa 1: quantos pedidos este cliente (pelo telefone) já fez na loja, contando este. */
  qtdPedidosCliente?: number | null
}

/** Desconto, horários, comanda e atendente dos pedidos da rodada (leitura, escopada à loja). */
export async function extrasDaCozinhaBeta(
  admin: SupabaseClient,
  restauranteId: string,
  ids: string[],
): Promise<Record<string, ExtrasCozinhaBeta>> {
  if (ids.length === 0) return {}
  const { data, error } = await admin
    .from('pedidos')
    .select('id, desconto, preparando_em, pronto_em, criado_por_nome, cliente_telefone, comandas ( numero, responsavel_nome )')
    .eq('restaurante_id', restauranteId)
    .in('id', ids)
  if (error) throw error
  // Alfa 1: 'Qtd de pedidos' do cliente — contagem pelo telefone (só dígitos), sem os cancelados.
  const fones = [...new Set(((data ?? []) as { cliente_telefone?: string | null }[]).map((p) => p.cliente_telefone).filter((t): t is string => !!t && t.replace(/D/g, '').length >= 8))]
  const porFone = new Map<string, number>()
  if (fones.length) {
    const { data: hist } = await admin.from('pedidos').select('cliente_telefone').eq('restaurante_id', restauranteId).in('cliente_telefone', fones).neq('status', 'cancelado').limit(20000)
    for (const h of (hist ?? []) as { cliente_telefone: string }[]) porFone.set(h.cliente_telefone, (porFone.get(h.cliente_telefone) ?? 0) + 1)
  }
  const out: Record<string, ExtrasCozinhaBeta> = {}
  for (const p of (data ?? []) as unknown as {
    id: string; desconto: number | null; preparando_em: string | null; pronto_em: string | null; criado_por_nome: string | null; cliente_telefone: string | null
    comandas: { numero: number | null; responsavel_nome: string | null } | { numero: number | null; responsavel_nome: string | null }[] | null
  }[]) {
    const c = Array.isArray(p.comandas) ? p.comandas[0] : p.comandas
    out[p.id] = {
      desconto: Number(p.desconto ?? 0),
      aceitoEm: p.preparando_em,
      prontoEm: p.pronto_em,
      comandaNumero: c?.numero ?? null,
      atendente: (p.criado_por_nome || c?.responsavel_nome || '').trim() || null,
      qtdPedidosCliente: p.cliente_telefone ? porFone.get(p.cliente_telefone) ?? null : null,
    }
  }
  return out
}

export async function lojaDaCozinhaBeta(admin: SupabaseClient, restauranteId: string): Promise<{ slug: string; instagramUrl: string | null }> {
  const { data, error } = await admin.from('restaurantes').select('slug, instagram_url').eq('id', restauranteId).maybeSingle()
  if (error) throw error
  return { slug: (data?.slug as string) ?? '', instagramUrl: (data?.instagram_url as string | null) ?? null }
}

/** Nome, telefone e endereço da LOJA como saem no rodapé da comanda e da pré-conta do Beta. */
export interface LojaImpressao {
  nome: string
  telefone: string
  /** Endereço completo numa linha (Assistente 0.2.0-beta.6 e anteriores). */
  endereco: string
  /** "Rua, número" — linha 1 do rodapé da comanda padrão (0.2.0-beta.7+). */
  linha1: string
  /** "Cidade/UF" — linha 2 do rodapé da comanda padrão (0.2.0-beta.7+). */
  cidade: string
}

/** Colunas de restaurantes usadas por dadosLojaImpressao (selecione todas). */
export const COLUNAS_LOJA_IMPRESSAO = 'nome, telefone, endereco, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado'

/** "(27) 99999-0000" (DDD + número; tira o 55 do país). Outro formato: como veio. */
export function telefoneImpressao(v: string | null | undefined): string {
  let d = String(v ?? '').replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return String(v ?? '').trim()
}

/**
 * Dados da loja para o papel. Endereço: o estruturado ("rua, nº - complemento - bairro,
 * cidade/UF") ou, sem ele, o texto livre do cadastro. " - " separa as partes: o desenho
 * quebra a linha nelas primeiro.
 */
export function dadosLojaImpressao(r: Record<string, unknown> | null | undefined): LojaImpressao {
  const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  if (!r) return { nome: '', telefone: '', endereco: '', linha1: '', cidade: '' }
  const rua = t(r.endereco_rua)
  let endereco = ''
  let linha1 = ''
  let cidade = ''
  if (rua) {
    cidade = [t(r.endereco_cidade), t(r.endereco_estado)].filter(Boolean).join('/')
    const bairroCidade = [t(r.endereco_bairro), cidade].filter(Boolean).join(', ')
    linha1 = [rua, t(r.endereco_numero)].filter(Boolean).join(', ')
    endereco = [linha1, t(r.endereco_complemento), bairroCidade].filter(Boolean).join(' - ')
  } else {
    endereco = t(r.endereco)
    linha1 = endereco
  }
  return { nome: t(r.nome), telefone: telefoneImpressao(t(r.telefone)), endereco, linha1, cidade }
}

export async function lojaImpressao(admin: SupabaseClient, restauranteId: string): Promise<LojaImpressao> {
  const { data, error } = await admin.from('restaurantes').select(COLUNAS_LOJA_IMPRESSAO).eq('id', restauranteId).maybeSingle()
  if (error) throw error
  return dadosLojaImpressao(data as Record<string, unknown> | null)
}
