import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarWhatsapp, formatarTelefoneWhatsapp } from '@/lib/whatsapp'

export interface EnderecoCliente {
  rua: string
  numero: string
  complemento: string
  bairro: string
  cep: string
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
    },
  }
}

const CLIENTE_SELECT = 'telefone, token, nome, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep'

/** Resolve o id do restaurante a partir do slug da vitrine. */
export async function buscarRestauranteIdPorSlug(admin: SupabaseClient, slug: string): Promise<string | null> {
  const { data, error } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

type ResultadoOtp = { ok: true } | { ok: false; error: string }
type ResultadoVerificacao = { ok: true; cliente: ClientePerfil } | { ok: false; error: string }

const OTP_VALIDADE_MS = 5 * 60 * 1000
const OTP_MAX_TENTATIVAS = 5

/** Gera um código de 6 dígitos e envia pelo WhatsApp conectado da loja. */
export async function enviarCodigoVerificacao(admin: SupabaseClient, restauranteId: string, telefoneInformado: string): Promise<ResultadoOtp> {
  const telefone = formatarTelefoneWhatsapp(telefoneInformado)
  if (!telefone) return { ok: false, error: 'Informe um telefone válido com DDD.' }

  const { data: loja, error: lojaError } = await admin
    .from('restaurantes')
    .select('nome, evolution_instance')
    .eq('id', restauranteId)
    .maybeSingle()
  if (lojaError) throw lojaError
  if (!loja?.evolution_instance) return { ok: false, error: 'Esta loja ainda não habilitou o cadastro por WhatsApp.' }

  const codigo = String(Math.floor(100000 + Math.random() * 900000))
  const expiraEm = new Date(Date.now() + OTP_VALIDADE_MS).toISOString()

  await admin.from('cliente_codigos').delete().eq('restaurante_id', restauranteId).eq('telefone', telefone)
  const { error: insertError } = await admin
    .from('cliente_codigos')
    .insert({ restaurante_id: restauranteId, telefone, codigo, expira_em: expiraEm })
  if (insertError) throw insertError

  const texto = `🔐 Seu código de verificação${loja.nome ? ` para *${loja.nome}*` : ''} é *${codigo}*.\nEle expira em 5 minutos.`
  const enviado = await enviarWhatsapp(telefone, texto, loja.evolution_instance)
  if (!enviado) return { ok: false, error: 'Não foi possível enviar o código pelo WhatsApp agora. Tente novamente em instantes.' }

  return { ok: true }
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

  if (registro.codigo !== codigo) {
    await admin.from('cliente_codigos').update({ tentativas: registro.tentativas + 1 }).eq('id', registro.id)
    return { ok: false, error: 'Código incorreto.' }
  }

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
    })
    .eq('restaurante_id', restauranteId)
    .eq('telefone', telefone)
    .eq('token', token)
    .select(CLIENTE_SELECT)
    .maybeSingle()
  if (error) throw error
  return data ? mapCliente(data as ClienteRow) : null
}
