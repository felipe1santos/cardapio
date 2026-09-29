import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarWhatsapp, formatarTelefoneWhatsapp } from '@/lib/whatsapp'
import { lerTodas } from './ler-todas'

export interface EnderecoCliente {
  rua: string
  numero: string
  complemento: string
  bairro: string
  cep: string
  cidade: string
  /** Ponto de referência pro entregador achar a casa. Opcional. */
  referencia: string
}

export interface ClientePerfil {
  telefone: string
  token: string
  nome: string
  endereco: EnderecoCliente
}

interface ClienteRow {
  telefone: string
  token: string
  nome: string
  endereco_rua: string
  endereco_numero: string
  endereco_complemento: string
  endereco_bairro: string
  endereco_cep: string
  endereco_cidade: string | null
  endereco_referencia: string | null
}

function mapCliente(row: ClienteRow): ClientePerfil {
  return {
    telefone: row.telefone,
    token: row.token,
    nome: row.nome,
    endereco: {
      rua: row.endereco_rua,
      numero: row.endereco_numero,
      complemento: row.endereco_complemento,
      bairro: row.endereco_bairro,
      cep: row.endereco_cep,
      cidade: row.endereco_cidade ?? '',
      referencia: row.endereco_referencia ?? '',
    },
  }
}

const CLIENTE_SELECT = 'telefone, token, nome, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep, endereco_cidade, endereco_referencia'

/** Resolve o id do restaurante a partir do slug da vitrine. */
export async function buscarRestauranteIdPorSlug(admin: SupabaseClient, slug: string): Promise<string | null> {
  const { data, error } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

// `podeFallback` indica que o telefone é válido mas o WhatsApp da loja não pôde
// enviar o código (instância offline ou loja sem WhatsApp) — o checkout então
// deixa o cliente seguir sem confirmar (ver `criarSessaoNaoVerificada`).
type ResultadoOtp = { ok: true } | { ok: false; error: string; podeFallback: boolean; aguarde?: true }
type ResultadoVerificacao = { ok: true; cliente: ClientePerfil } | { ok: false; error: string }

const OTP_VALIDADE_MS = 5 * 60 * 1000
const OTP_MAX_TENTATIVAS = 5
/**
 * Intervalo mínimo entre dois códigos para o mesmo telefone. Sem ele, qualquer um
 * disparava WhatsApp do número da loja para qualquer número (risco de banimento, e aí
 * param os avisos de pedido), e cada reenvio zerava as 5 tentativas.
 */
export const OTP_INTERVALO_MS = 60 * 1000

/** Gera um código de 6 dígitos e envia pelo WhatsApp conectado da loja. */
export async function enviarCodigoVerificacao(admin: SupabaseClient, restauranteId: string, telefoneInformado: string): Promise<ResultadoOtp> {
  const telefone = formatarTelefoneWhatsapp(telefoneInformado)
  if (!telefone) return { ok: false, error: 'Informe um telefone válido com DDD.', podeFallback: false }

  const { data: loja, error: lojaError } = await admin
    .from('restaurantes')
    .select('nome, evolution_instance')
    .eq('id', restauranteId)
    .maybeSingle()
  if (lojaError) throw lojaError
  if (!loja?.evolution_instance) return { ok: false, error: 'Esta loja ainda não habilitou o cadastro por WhatsApp.', podeFallback: true }

  const { data: anterior } = await admin
    .from('cliente_codigos')
    .select('criado_em')
    .eq('restaurante_id', restauranteId)
    .eq('telefone', telefone)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  const desde = anterior?.criado_em ? Date.now() - new Date(anterior.criado_em).getTime() : Infinity
  if (desde < OTP_INTERVALO_MS) {
    const faltam = Math.max(1, Math.ceil((OTP_INTERVALO_MS - desde) / 1000))
    return { ok: false, error: `Já enviamos um código agora há pouco. Confira o WhatsApp ou peça outro em ${faltam} s.`, podeFallback: false, aguarde: true }
  }

  // 100000–999999 com gerador criptográfico (Math.random é previsível).
  const codigo = String(100000 + (globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
  const expiraEm = new Date(Date.now() + OTP_VALIDADE_MS).toISOString()

  await admin.from('cliente_codigos').delete().eq('restaurante_id', restauranteId).eq('telefone', telefone)
  const { data: novo, error: insertError } = await admin
    .from('cliente_codigos')
    .insert({ restaurante_id: restauranteId, telefone, codigo, expira_em: expiraEm })
    .select('id')
    .single()
  if (insertError) throw insertError

  const texto = `🔐 Seu código de verificação${loja.nome ? ` para *${loja.nome}*` : ''} é *${codigo}*.\nEle expira em 5 minutos.`
  // No histórico da central de atendimento o código NÃO aparece (o eco é reconhecido pelo hash).
  const enviado = await enviarWhatsapp(telefone, texto, loja.evolution_instance, { admin, origem: 'automatico', restauranteId, textoExibido: '🔐 Código de verificação do cardápio enviado.' })
  if (!enviado) {
    // O código não chegou a ninguém: não segura o próximo pedido no intervalo.
    await admin.from('cliente_codigos').delete().eq('id', novo.id)
    return { ok: false, error: 'Não foi possível enviar o código pelo WhatsApp agora. Tente novamente em instantes.', podeFallback: true }
  }

  return { ok: true }
}

/**
 * Cria (ou recupera) a sessão do cliente SEM verificação por OTP. Usado como
 * fallback quando o WhatsApp da loja está offline e o código não pôde ser
 * enviado — assim o cliente nunca fica travado no checkout. Um cliente já
 * verificado antes mantém `verificado_em`; um cliente novo entra sem verificação.
 */
export async function criarSessaoNaoVerificada(admin: SupabaseClient, restauranteId: string, telefoneInformado: string): Promise<ResultadoVerificacao> {
  const telefone = formatarTelefoneWhatsapp(telefoneInformado)
  if (!telefone) return { ok: false, error: 'Informe um telefone válido com DDD.' }

  const { data: existente, error: existenteError } = await admin
    .from('clientes')
    .select(CLIENTE_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('telefone', telefone)
    .maybeSingle()
  if (existenteError) throw existenteError
  if (existente) return { ok: true, cliente: mapCliente(existente as ClienteRow) }

  const { data, error } = await admin
    .from('clientes')
    .insert({ restaurante_id: restauranteId, telefone })
    .select(CLIENTE_SELECT)
    .single()
  if (error) throw error
  return { ok: true, cliente: mapCliente(data as ClienteRow) }
}

/** Confirma o código enviado e cria/recupera o cadastro do cliente, retornando seu perfil + token de sessão. */
export async function verificarCodigo(admin: SupabaseClient, restauranteId: string, telefoneInformado: string, codigoInformado: string): Promise<ResultadoVerificacao> {
  const telefone = formatarTelefoneWhatsapp(telefoneInformado)
  if (!telefone) return { ok: false, error: 'Informe um telefone válido com DDD.' }

  const codigo = codigoInformado.trim()

  const { data: registro, error: registroError } = await admin
    .from('cliente_codigos')
    .select('id, codigo, expira_em, tentativas')
    .eq('restaurante_id', restauranteId)
    .eq('telefone', telefone)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (registroError) throw registroError
  if (!registro) return { ok: false, error: 'Solicite um novo código.' }
  if (new Date(registro.expira_em).getTime() < Date.now()) return { ok: false, error: 'Código expirado. Solicite um novo.' }
  if (registro.tentativas >= OTP_MAX_TENTATIVAS) return { ok: false, error: 'Muitas tentativas. Solicite um novo código.' }

  // Conta a tentativa ANTES de comparar, com compare-and-set: requisições em paralelo
  // leem o mesmo número e só uma avança — as outras não chegam a testar o código.
  const { data: contada } = await admin
    .from('cliente_codigos')
    .update({ tentativas: registro.tentativas + 1 })
    .eq('id', registro.id)
    .eq('tentativas', registro.tentativas)
    .select('id')
  if (!contada?.length) return { ok: false, error: 'Aguarde um instante e tente de novo.' }

  if (registro.codigo !== codigo) return { ok: false, error: 'Código incorreto.' }

  await admin.from('cliente_codigos').delete().eq('id', registro.id)

  const { data: existente, error: existenteError } = await admin
    .from('clientes')
    .select(CLIENTE_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('telefone', telefone)
    .maybeSingle()
  if (existenteError) throw existenteError

  if (existente) {
    const { data, error } = await admin
      .from('clientes')
      .update({ verificado_em: new Date().toISOString() })
      .eq('restaurante_id', restauranteId)
      .eq('telefone', telefone)
      .select(CLIENTE_SELECT)
      .single()
    if (error) throw error
    return { ok: true, cliente: mapCliente(data as ClienteRow) }
  }

  const { data, error } = await admin
    .from('clientes')
    .insert({ restaurante_id: restauranteId, telefone, verificado_em: new Date().toISOString() })
    .select(CLIENTE_SELECT)
    .single()
  if (error) throw error
  return { ok: true, cliente: mapCliente(data as ClienteRow) }
}

/** Recupera o perfil salvo a partir do token de sessão guardado no navegador. */
export async function buscarClientePorToken(admin: SupabaseClient, restauranteId: string, telefoneInformado: string, token: string): Promise<ClientePerfil | null> {
  const telefone = formatarTelefoneWhatsapp(telefoneInformado)
  if (!telefone || !token) return null

  const { data, error } = await admin
    .from('clientes')
    .select(CLIENTE_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('telefone', telefone)
    .eq('token', token)
    .maybeSingle()
  if (error) throw error
  return data ? mapCliente(data as ClienteRow) : null
}

export interface AtualizarPerfilInput {
  nome: string
  endereco: EnderecoCliente
}

export async function atualizarPerfilCliente(admin: SupabaseClient, restauranteId: string, telefone: string, token: string, input: AtualizarPerfilInput): Promise<ClientePerfil | null> {
  const { data, error } = await admin
    .from('clientes')
    .update({
      nome: input.nome.trim(),
      endereco_rua: input.endereco.rua.trim(),
      endereco_numero: input.endereco.numero.trim(),
      endereco_complemento: input.endereco.complemento.trim(),
      endereco_bairro: input.endereco.bairro.trim(),
      endereco_cep: input.endereco.cep.trim(),
      endereco_cidade: (input.endereco.cidade ?? '').trim(),
      endereco_referencia: (input.endereco.referencia ?? '').trim(),
    })
    .eq('restaurante_id', restauranteId)
    .eq('telefone', telefone)
    .eq('token', token)
    .select(CLIENTE_SELECT)
    .maybeSingle()
  if (error) throw error
  return data ? mapCliente(data as ClienteRow) : null
}

// ── Base de clientes (admin) ────────────────────────────────────────────────

export type SexoCliente = '' | 'M' | 'F'

export interface ClienteMetrica {
  telefone: string
  nome: string
  endereco: EnderecoCliente
  sexo: SexoCliente
  totalPedidos: number
  valorTotal: number
  ticketMedio: number
  primeiraCompraEm: string
  ultimaCompraEm: string
  pedidosPorSemana: number
  gastoSemanalMedio: number
  diaSemanaPreferido: number | null // 0 = domingo .. 6 = sábado
}

interface PedidoClienteRow {
  cliente_nome: string
  cliente_telefone: string
  endereco_rua: string
  endereco_numero: string
  endereco_complemento: string
  endereco_bairro: string
  endereco_cep: string
  endereco_cidade: string | null
  endereco_referencia: string | null
  total: number
  criado_em: string
}

/** Normaliza um telefone (qualquer formatação) para a chave usada para agrupar pedidos do mesmo cliente. */
export function normalizarTelefone(telefone: string): string {
  return formatarTelefoneWhatsapp(telefone) ?? telefone.replace(/\D/g, '')
}

const MS_POR_SEMANA = 7 * 24 * 60 * 60 * 1000

/** Agrega os pedidos da loja por cliente (telefone) com as métricas de recorrência exibidas em /admin/clientes. */
export async function listarClientesComMetricas(supabase: SupabaseClient, restauranteId: string): Promise<ClienteMetrica[]> {
  // Paginado: o PostgREST corta em 1000 linhas, e a lista ficava com os 1000 pedidos mais
  // antigos (cliente novo não aparecia, métricas erradas).
  const [pedidos, perfis] = await Promise.all([
    lerTodas<PedidoClienteRow>((de, ate) => supabase
      .from('pedidos')
      .select('cliente_nome, cliente_telefone, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep, endereco_cidade, endereco_referencia, total, criado_em')
      .eq('restaurante_id', restauranteId)
      .neq('status', 'cancelado')
      .order('criado_em', { ascending: true })
      .order('id', { ascending: true })
      .range(de, ate)),
    lerTodas<{ telefone: string; sexo: SexoCliente }>((de, ate) => supabase
      .from('clientes')
      .select('telefone, sexo')
      .eq('restaurante_id', restauranteId)
      .order('id', { ascending: true })
      .range(de, ate)),
  ])

  const sexoPorTelefone = new Map<string, SexoCliente>(
    (perfis ?? []).map((p: { telefone: string; sexo: SexoCliente }) => [normalizarTelefone(p.telefone), p.sexo])
  )

  const grupos = new Map<string, PedidoClienteRow[]>()
  for (const pedido of (pedidos ?? []) as PedidoClienteRow[]) {
    const chave = normalizarTelefone(pedido.cliente_telefone)
    const lista = grupos.get(chave)
    if (lista) lista.push(pedido)
    else grupos.set(chave, [pedido])
  }

  const resultado: ClienteMetrica[] = []
  for (const [chave, lista] of grupos) {
    const primeiro = lista[0]
    const ultimo = lista[lista.length - 1]
    const valorTotal = lista.reduce((s, p) => s + Number(p.total), 0)
    const totalPedidos = lista.length
    const primeiraTs = new Date(primeiro.criado_em).getTime()
    const ultimaTs = new Date(ultimo.criado_em).getTime()
    const semanas = Math.max(1, (ultimaTs - primeiraTs) / MS_POR_SEMANA)

    const contagemPorDia = [0, 0, 0, 0, 0, 0, 0]
    for (const p of lista) contagemPorDia[new Date(p.criado_em).getDay()]++
    let diaSemanaPreferido: number | null = null
    let maxContagem = 0
    for (let dia = 0; dia < 7; dia++) {
      if (contagemPorDia[dia] > maxContagem) {
        maxContagem = contagemPorDia[dia]
        diaSemanaPreferido = dia
      }
    }

    resultado.push({
      telefone: ultimo.cliente_telefone,
      nome: ultimo.cliente_nome,
      endereco: {
        rua: ultimo.endereco_rua,
        numero: ultimo.endereco_numero,
        complemento: ultimo.endereco_complemento,
        bairro: ultimo.endereco_bairro,
        cep: ultimo.endereco_cep,
        cidade: ultimo.endereco_cidade ?? '',
        referencia: ultimo.endereco_referencia ?? '',
      },
      sexo: sexoPorTelefone.get(chave) ?? '',
      totalPedidos,
      valorTotal,
      ticketMedio: valorTotal / totalPedidos,
      primeiraCompraEm: primeiro.criado_em,
      ultimaCompraEm: ultimo.criado_em,
      pedidosPorSemana: totalPedidos / semanas,
      gastoSemanalMedio: valorTotal / semanas,
      diaSemanaPreferido,
    })
  }

  resultado.sort((a, b) => new Date(b.ultimaCompraEm).getTime() - new Date(a.ultimaCompraEm).getTime())
  return resultado
}

/** Define o sexo de um cliente (telefone), criando/atualizando o registro em `clientes` sem afetar os demais campos. */
export async function atualizarSexoCliente(supabase: SupabaseClient, restauranteId: string, telefone: string, sexo: SexoCliente): Promise<void> {
  const { error } = await supabase
    .from('clientes')
    .upsert({ restaurante_id: restauranteId, telefone: normalizarTelefone(telefone), sexo }, { onConflict: 'restaurante_id,telefone' })
  if (error) throw error
}

/** Remove acentos/pontuação e deixa em minúsculas — normalização recomendada pelo Meta para nome/cidade no upload de "Customer list". */
function normalizarTextoMeta(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
}

/** Gera o CSV de clientes no formato de upload de "Customer list" (Custom Audiences) do Meta Ads. */
export function gerarCsvMetaAds(clientes: ClienteMetrica[]): string {
  const cabecalho = ['phone', 'fn', 'ln', 'zip', 'country', 'gen']
  const linhas = clientes.map((c) => {
    const [fn = '', ...resto] = normalizarTextoMeta(c.nome).split(' ').filter(Boolean)
    const gen = c.sexo === 'M' ? 'm' : c.sexo === 'F' ? 'f' : ''
    return [normalizarTelefone(c.telefone), fn, resto.join(' '), c.endereco.cep.replace(/\D/g, ''), 'br', gen]
  })
  return [cabecalho, ...linhas].map((linha) => linha.join(',')).join('\r\n')
}
