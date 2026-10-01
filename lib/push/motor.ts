/**
 * Motor das notificações push (2026-10-01): avalia as automações de cada loja com push liberado,
 * enfileira o status do pedido, as avulsas e o teste. Regras puras em ./regras; conteúdo em
 * ./conteudo; envio/fila em ./envio. Toda consulta filtra a loja (isolamento entre lojas).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { horaAtualSaoPaulo, lojaEstaAberta, proximaAbertura, diaSemanaSaoPaulo, type HorarioFuncionamento, type StatusLoja } from '@/lib/timezone'
import { resolverPaleta } from '@/lib/paletas'
import { telefoneWhatsapp } from '@/lib/telefone-br'
import { versaoPrevia } from '@/lib/previa-loja'
import {
  CATEGORIA_DO_TIPO,
  bairrosQueFicaramGratis,
  chaveDestinatario,
  dentroDoLimite,
  escolherCandidato,
  faltamParaPremio,
  gatilhoInativo,
  gatilhoRecompra,
  minutosEntre,
  normalizarBairro,
  podeMarketingAgora,
  type Candidato,
  type CategoriaPush,
  type JanelaLoja,
  type TipoAutomacao,
} from './regras'
import { TEXTO_PREMIO_PADRAO, TEXTOS_PADRAO, aplicarVariaveis, montarPayload, primeiroNome, textoStatusPedido } from './conteudo'
import { processarFilaPush, pushConfigurado } from './envio'

const DIA = 24 * 3600_000
/** Intervalo mínimo entre duas avaliações de automação da mesma loja. */
export const INTERVALO_AVALIACAO_MS = 10 * 60_000

export interface LojaPush {
  id: string
  slug: string
  nome: string
  logoUrl: string | null
  corTema: string
  statusLoja: StatusLoja
  horarioFuncionamento: HorarioFuncionamento | null
  freteGratisAcima: number | null
  pushLiberado: boolean
}

export interface ConfigPush {
  limiteDia: number
  limiteSemana: number
  antecedenciaMin: number
  telefoneTeste: string | null
  estado: Record<string, unknown>
  ultimaAvaliacao: string | null
}

export interface AutomacaoPush { tipo: TipoAutomacao; ativo: boolean; titulo: string; texto: string; params: Record<string, unknown> }

export interface AssinaturaPush {
  id: string
  clienteTelefone: string | null
  categorias: string[]
}

const CAMPOS_LOJA = 'id, slug, nome, logo_url, cor_tema, status_loja, horario_funcionamento, frete_gratis_acima, push_liberado'
function lojaDe(r: Record<string, unknown>): LojaPush {
  return {
    id: r.id as string,
    slug: r.slug as string,
    nome: r.nome as string,
    logoUrl: (r.logo_url as string | null) ?? null,
    corTema: (r.cor_tema as string | null) ?? 'azul',
    statusLoja: ((r.status_loja as StatusLoja | null) ?? 'automatico'),
    horarioFuncionamento: (r.horario_funcionamento as HorarioFuncionamento | null) ?? null,
    freteGratisAcima: r.frete_gratis_acima === null || r.frete_gratis_acima === undefined ? null : Number(r.frete_gratis_acima),
    pushLiberado: Boolean(r.push_liberado),
  }
}

export async function carregarLoja(admin: SupabaseClient, restauranteId: string): Promise<LojaPush | null> {
  const { data } = await admin.from('restaurantes').select(CAMPOS_LOJA).eq('id', restauranteId).maybeSingle()
  return data ? lojaDe(data) : null
}

export async function carregarConfig(admin: SupabaseClient, restauranteId: string): Promise<ConfigPush> {
  const { data } = await admin.from('push_config').select('*').eq('restaurante_id', restauranteId).maybeSingle()
  return {
    limiteDia: data?.limite_dia ?? 1,
    limiteSemana: data?.limite_semana ?? 3,
    antecedenciaMin: data?.antecedencia_min ?? 30,
    telefoneTeste: data?.telefone_teste ?? null,
    estado: (data?.estado as Record<string, unknown>) ?? {},
    ultimaAvaliacao: data?.ultima_avaliacao ?? null,
  }
}

/** Automações da loja, com o texto padrão onde a loja ainda não escreveu nada. */
export async function carregarAutomacoes(admin: SupabaseClient, restauranteId: string): Promise<AutomacaoPush[]> {
  const { data } = await admin.from('push_automacoes').select('tipo, ativo, titulo, texto, params').eq('restaurante_id', restauranteId)
  const salvas = new Map((data ?? []).map((r) => [r.tipo as TipoAutomacao, r]))
  return (Object.keys(TEXTOS_PADRAO) as TipoAutomacao[]).map((tipo) => {
    const r = salvas.get(tipo)
    const pad = TEXTOS_PADRAO[tipo]
    return {
      tipo,
      // Status do pedido nasce LIGADO (o cliente pediu "avisar quando sair"); marketing nasce desligado.
      ativo: r ? Boolean(r.ativo) : tipo === 'status_pedido',
      titulo: (r?.titulo as string) || pad.titulo,
      texto: (r?.texto as string) || pad.texto,
      params: { ...(pad.params ?? {}), ...((r?.params as Record<string, unknown>) ?? {}) },
    }
  })
}

export function versaoIcone(loja: LojaPush): string {
  return versaoPrevia({ nome: loja.nome, bannerUrl: null, logoUrl: loja.logoUrl, cor: resolverPaleta(loja.corTema).primaria })
}

export function janelaDaLoja(loja: LojaPush): JanelaLoja {
  const horaAgora = horaAtualSaoPaulo()
  const aberta = lojaEstaAberta(loja)
  let minutosParaAbrir: number | null = null
  if (!aberta && loja.statusLoja === 'automatico') {
    const p = proximaAbertura(loja.horarioFuncionamento)
    if (p && p.diaSemana === diaSemanaSaoPaulo(new Date().toISOString())) minutosParaAbrir = minutosEntre(horaAgora, p.hora)
  }
  return { aberta, minutosParaAbrir, horaAgora }
}

export function dataSaoPaulo(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

/** Telefone normalizado (55 + DDD + número): pedidos antigos guardam sem o 55. */
export const soDigitos = (t: string | null | undefined) => telefoneWhatsapp(t ?? '') ?? ''
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function assinaturasAtivas(admin: SupabaseClient, restauranteId: string): Promise<AssinaturaPush[]> {
  const { data } = await admin
    .from('push_assinaturas')
    .select('id, cliente_telefone, categorias')
    .eq('restaurante_id', restauranteId)
    .eq('status', 'ativa')
  return (data ?? []).map((a) => ({ id: a.id, clienteTelefone: a.cliente_telefone ? soDigitos(a.cliente_telefone) : null, categorias: a.categorias ?? [] }))
}

// ── fila ────────────────────────────────────────────────────────────────────
export interface ItemFila {
  assinatura: AssinaturaPush
  origem: 'automacao' | 'avulsa' | 'status' | 'teste'
  tipo: TipoAutomacao | 'avulsa' | 'teste'
  categoria: CategoriaPush
  chave: string | null
  titulo: string | null
  texto: string
  destino: string
  imagem?: string | null
  avulsaId?: string | null
}

/** Enfileira (um por aparelho). Chave repetida no mesmo aparelho é ignorada pelo banco. */
export async function enfileirar(admin: SupabaseClient, loja: LojaPush, itens: ItemFila[]): Promise<number> {
  if (!itens.length) return 0
  const v = versaoIcone(loja)
  const linhas = itens.map((i) => {
    const id = crypto.randomUUID()
    return {
      id,
      restaurante_id: loja.id,
      assinatura_id: i.assinatura.id,
      destinatario: chaveDestinatario(i.assinatura),
      origem: i.origem,
      tipo: i.tipo,
      categoria: i.categoria,
      avulsa_id: i.avulsaId ?? null,
      chave_dedup: i.chave,
      payload: montarPayload({ slug: loja.slug, lojaNome: loja.nome, versaoIcone: v, titulo: i.titulo, texto: i.texto, destino: i.destino, envioId: id, tipo: i.tipo, imagem: i.imagem }),
    }
  })
  let total = 0
  for (let k = 0; k < linhas.length; k += 500) {
    const { data, error } = await admin
      .from('push_envios')
      .upsert(linhas.slice(k, k + 500), { onConflict: 'assinatura_id,chave_dedup', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error(`enfileirar push: ${error.message}`)
    total += data?.length ?? 0
  }
  return total
}

// ── status do pedido (transacional) ─────────────────────────────────────────
/**
 * Avisa o cliente pelo push quando o pedido é aceito, sai para entrega ou fica pronto para
 * retirada. Chamado no mesmo ponto do WhatsApp (notificarPedido); nunca derruba o fluxo.
 */
export async function enviarPushStatusPedido(admin: SupabaseClient, pedidoId: string, status: string): Promise<'enviado' | 'sem_push' | 'sem_assinatura' | 'sem_mensagem' | 'desligado'> {
  const { data: p } = await admin.from('pedidos').select('id, numero, tipo, cliente_telefone, cliente_nome, restaurante_id').eq('id', pedidoId).maybeSingle()
  if (!p) return 'sem_push'
  const loja = await carregarLoja(admin, p.restaurante_id)
  if (!loja?.pushLiberado || !pushConfigurado() && process.env.PUSH_PROVEDOR !== 'simulado') return 'sem_push'
  const auto = (await carregarAutomacoes(admin, loja.id)).find((a) => a.tipo === 'status_pedido')
  if (!auto?.ativo) return 'desligado'
  const texto = textoStatusPedido(status, p.tipo, p.numero)
  if (!texto) return 'sem_mensagem'
  const tel = soDigitos(p.cliente_telefone)
  if (!tel) return 'sem_assinatura'
  const assinaturas = (await assinaturasAtivas(admin, loja.id)).filter((a) => a.clienteTelefone === tel && a.categorias.includes('pedido'))
  if (!assinaturas.length) return 'sem_assinatura'
  await enfileirar(admin, loja, assinaturas.map((a) => ({
    assinatura: a, origem: 'status', tipo: 'status_pedido', categoria: 'pedido',
    chave: `status:${p.id}:${status}`, titulo: loja.nome, texto, destino: '?aba=pedidos',
  })))
  await processarFilaPush(admin, { limite: 50 })
  return 'enviado'
}

// ── automações de marketing ─────────────────────────────────────────────────
interface Historico { chaves: Map<string, Set<string>>; marketingEm: Map<string, number[]> }

/** Chaves já usadas e instantes dos marketings de cada destinatário (um por notificação, não por aparelho). */
async function historicoDaLoja(admin: SupabaseClient, restauranteId: string, desde: number): Promise<Historico> {
  const { data } = await admin
    .from('push_envios')
    .select('destinatario, chave_dedup, avulsa_id, origem, status, criado_em')
    .eq('restaurante_id', restauranteId)
    .gte('criado_em', new Date(desde).toISOString())
    .limit(50000)
  const chaves = new Map<string, Set<string>>()
  const vistos = new Map<string, Map<string, number>>()
  for (const e of data ?? []) {
    if (e.chave_dedup) {
      if (!chaves.has(e.destinatario)) chaves.set(e.destinatario, new Set())
      chaves.get(e.destinatario)!.add(e.chave_dedup)
    }
    if ((e.origem === 'automacao' || e.origem === 'avulsa') && (e.status === 'pendente' || e.status === 'enviado')) {
      const k = e.chave_dedup ?? e.avulsa_id ?? e.criado_em
      if (!vistos.has(e.destinatario)) vistos.set(e.destinatario, new Map())
      const m = vistos.get(e.destinatario)!
      const t = new Date(e.criado_em).getTime()
      m.set(k, Math.min(m.get(k) ?? t, t))
    }
  }
  const marketingEm = new Map<string, number[]>()
  for (const [d, m] of vistos) marketingEm.set(d, [...m.values()])
  return { chaves, marketingEm }
}

interface PedidosCliente { qtd: number; ultimoEm: number; ultimoId: string; nome: string }

async function pedidosPorTelefone(admin: SupabaseClient, restauranteId: string): Promise<Map<string, PedidosCliente>> {
  const { data } = await admin
    .from('pedidos')
    .select('id, cliente_telefone, cliente_nome, criado_em')
    .eq('restaurante_id', restauranteId)
    .neq('status', 'cancelado')
    .order('criado_em', { ascending: false })
    .limit(50000)
  const m = new Map<string, PedidosCliente>()
  for (const p of data ?? []) {
    const t = soDigitos(p.cliente_telefone)
    if (!t) continue
    const atual = m.get(t)
    if (atual) atual.qtd++
    else m.set(t, { qtd: 1, ultimoEm: new Date(p.criado_em).getTime(), ultimoId: p.id, nome: p.cliente_nome ?? '' })
  }
  return m
}

function descontoDoCupom(c: { tipo: string; valor: number | null }): string {
  if (c.tipo === 'desconto_percentual') return `${Number(c.valor ?? 0)}% de desconto`
  if (c.tipo === 'desconto_valor') return `${brl(Number(c.valor ?? 0))} de desconto`
  if (c.tipo === 'entrega_gratis') return 'entrega grátis'
  return 'um item grátis'
}

export interface ResumoAvaliacao { loja: string; avaliada: boolean; motivo?: string; enfileirados: number }

/**
 * Avalia as automações de UMA loja agora. `forcar` ignora o intervalo de 10 min (testes/painel),
 * nunca a janela de envio.
 */
export async function avaliarLoja(admin: SupabaseClient, loja: LojaPush, opcoes: { agora?: number; forcar?: boolean } = {}): Promise<ResumoAvaliacao> {
  const agora = opcoes.agora ?? Date.now()
  const r: ResumoAvaliacao = { loja: loja.slug, avaliada: false, enfileirados: 0 }
  if (!loja.pushLiberado) return { ...r, motivo: 'push desligado' }
  const config = await carregarConfig(admin, loja.id)
  if (!opcoes.forcar && config.ultimaAvaliacao && agora - new Date(config.ultimaAvaliacao).getTime() < INTERVALO_AVALIACAO_MS - 30_000) return { ...r, motivo: 'avaliada há pouco' }

  const autos = (await carregarAutomacoes(admin, loja.id)).filter((a) => a.ativo && a.tipo !== 'status_pedido')
  const estado = { ...config.estado }
  const novoEstado = await fotoDoEstado(admin, loja)
  const mudancasFrete = mudancaDeFrete(estado, novoEstado, agora)

  const janela = janelaDaLoja(loja)
  const salvar = async () => {
    await admin.from('push_config').upsert({ restaurante_id: loja.id, ultima_avaliacao: new Date(agora).toISOString(), estado: { ...novoEstado, ...mudancasFrete.registro }, atualizado_em: new Date().toISOString() })
  }
  if (!autos.length) { await salvar(); return { ...r, avaliada: true, motivo: 'nenhuma automação ligada' } }
  if (!podeMarketingAgora(janela, config.antecedenciaMin)) { await salvar(); return { ...r, avaliada: true, motivo: 'fora da janela' } }

  const assinaturas = await assinaturasAtivas(admin, loja.id)
  if (!assinaturas.length) { await salvar(); return { ...r, avaliada: true, motivo: 'sem assinaturas' } }

  const ligada = (t: TipoAutomacao) => autos.find((a) => a.tipo === t)
  const hoje = dataSaoPaulo(new Date(agora))
  const pedidos = await pedidosPorTelefone(admin, loja.id)
  const hist = await historicoDaLoja(admin, loja.id, agora - 120 * DIA)

  // Dados da loja usados por várias regras
  const telefones = [...new Set(assinaturas.map((a) => a.clienteTelefone).filter(Boolean) as string[])]
  const { data: clientes } = telefones.length
    ? await admin.from('clientes').select('telefone, nome, endereco_bairro').eq('restaurante_id', loja.id)
    : { data: [] as { telefone: string; nome: string | null; endereco_bairro: string | null }[] }
  const clientePorTel = new Map((clientes ?? []).map((c) => [soDigitos(c.telefone), c]))

  // (a) loja abriu + promoção
  let promo: { nome: string; preco: number; de: number; id: string; imagem: string | null } | null = null
  if (ligada('loja_abriu') && janela.aberta) {
    const { data: itens } = await admin
      .from('itens_cardapio')
      .select('id, nome, preco, promocao_preco, promocao_inicio, promocao_fim, imagem_url')
      .eq('restaurante_id', loja.id)
      .eq('status', 'disponivel')
      .not('promocao_preco', 'is', null)
      .limit(50)
    const p = (itens ?? []).find((i) => (!i.promocao_inicio || i.promocao_inicio <= hoje) && (!i.promocao_fim || i.promocao_fim >= hoje))
    if (p) promo = { id: p.id, nome: p.nome, preco: Number(p.promocao_preco), de: Number(p.preco), imagem: p.imagem_url }
  }
  // (d) item novo: criado nas últimas 48 h ou marcado como Novidade há até ~2 dias (novidade_ate = marcação + 30 dias)
  let itemNovo: { id: string; nome: string; imagem: string | null } | null = null
  if (ligada('item_novo')) {
    const { data: itens } = await admin
      .from('itens_cardapio')
      .select('id, nome, imagem_url, criado_em, novidade_ate')
      .eq('restaurante_id', loja.id)
      .eq('status', 'disponivel')
      .or(`criado_em.gte.${new Date(agora - 2 * DIA).toISOString()},novidade_ate.gte.${new Date(agora + 28 * DIA).toISOString()}`)
      .order('criado_em', { ascending: false })
      .limit(1)
    if (itens?.[0]) itemNovo = { id: itens[0].id, nome: itens[0].nome, imagem: itens[0].imagem_url }
  }
  // (e) cupom novo (últimas 72 h, válido hoje)
  let cupons: { id: string; codigo: string; tipo: string; valor: number | null; publico: string; dias_inatividade: number | null }[] = []
  if (ligada('cupom_novo')) {
    const { data } = await admin
      .from('cupons')
      .select('id, codigo, tipo, valor, publico, dias_inatividade, validade_inicio, validade_fim, max_usos, usos')
      .eq('restaurante_id', loja.id)
      .eq('ativo', true)
      .gte('criado_em', new Date(agora - 3 * DIA).toISOString())
      .order('criado_em', { ascending: false })
    cupons = (data ?? []).filter((c) => (!c.validade_inicio || c.validade_inicio <= hoje) && (!c.validade_fim || c.validade_fim >= hoje) && (c.max_usos === null || c.usos < c.max_usos))
  }
  // (g) fidelidade
  const fidProgresso = new Map<string, { faltam: number; chave: string }>()
  const fidPremio = new Map<string, string>()
  if (ligada('fidelidade')) {
    const { data: camps } = await admin.from('campanhas_fidelidade').select('id, tipo_meta, meta_quantidade').eq('restaurante_id', loja.id).eq('ativa', true)
    const porQtd = new Map((camps ?? []).filter((c) => c.tipo_meta !== 'valor_gasto').map((c) => [c.id, c]))
    if (porQtd.size) {
      const { data: prog } = await admin.from('fidelidade_progresso').select('campanha_id, cliente_telefone, progresso_qtd, ciclos_completados').eq('restaurante_id', loja.id).in('campanha_id', [...porQtd.keys()])
      for (const p of prog ?? []) {
        const c = porQtd.get(p.campanha_id)!
        const f = faltamParaPremio(c.meta_quantidade, p.progresso_qtd)
        if (f) fidProgresso.set(soDigitos(p.cliente_telefone), { faltam: f, chave: `fidprog:${p.campanha_id}:${p.ciclos_completados}:${p.progresso_qtd}` })
      }
    }
    const { data: prem } = await admin.from('fidelidade_recompensas').select('id, cliente_telefone').eq('restaurante_id', loja.id).eq('status', 'disponivel')
    for (const p of prem ?? []) fidPremio.set(soDigitos(p.cliente_telefone), `fidpremio:${p.id}`)
  }
  // Último produto (recompra)
  const ultimoProduto = new Map<string, string>()
  if (ligada('recompra')) {
    const ids = [...pedidos.values()].filter((p) => p.qtd === 1).map((p) => p.ultimoId).slice(0, 2000)
    if (ids.length) {
      const { data } = await admin.from('pedido_itens').select('pedido_id, nome').in('pedido_id', ids)
      for (const i of data ?? []) if (!ultimoProduto.has(i.pedido_id)) ultimoProduto.set(i.pedido_id, i.nome)
    }
  }

  // Candidatos por destinatário
  const porDestinatario = new Map<string, AssinaturaPush[]>()
  for (const a of assinaturas) {
    const d = chaveDestinatario(a)
    if (!porDestinatario.has(d)) porDestinatario.set(d, [])
    porDestinatario.get(d)!.push(a)
  }
  const fila: ItemFila[] = []
  for (const [dest, aparelhos] of porDestinatario) {
    const tel = aparelhos[0].clienteTelefone
    const ped = tel ? pedidos.get(tel) : undefined
    const cli = tel ? clientePorTel.get(tel) : undefined
    const cands: Candidato[] = []
    if (promo) cands.push({ tipo: 'loja_abriu', chave: `loja_abriu:${hoje}`, vars: { produto: promo.nome, desconto: `${promo.nome} por ${brl(promo.preco)}` }, link: `?item=${promo.id}`, imagem: promo.imagem })
    if (itemNovo) cands.push({ tipo: 'item_novo', chave: `item:${itemNovo.id}`, vars: { produto: itemNovo.nome }, link: `?item=${itemNovo.id}`, imagem: itemNovo.imagem })
    for (const c of cupons) {
      const qtd = ped?.qtd ?? 0
      const ok = c.publico === 'todos'
        || (c.publico === 'primeira_compra' && tel && qtd === 0)
        || (c.publico === 'recompra' && ped && (qtd === 1 || (c.dias_inatividade && agora - ped.ultimoEm > c.dias_inatividade * DIA)))
      // Todos os cupons que valem (do mais novo ao mais antigo): a dedup tira os já recebidos e o
      // escolhido é o mais novo que o cliente ainda não viu.
      if (ok) cands.push({ tipo: 'cupom_novo', chave: `cupom:${c.id}`, vars: { cupom: c.codigo, desconto: descontoDoCupom(c) }, link: `?cupom=${encodeURIComponent(c.codigo)}` })
    }
    if (mudancasFrete.geral) cands.push({ tipo: 'frete_gratis', chave: mudancasFrete.geral.chave, vars: { desconto: mudancasFrete.geral.texto } })
    else if (mudancasFrete.bairros && cli?.endereco_bairro && mudancasFrete.bairros.lista.map(normalizarBairro).includes(normalizarBairro(cli.endereco_bairro))) {
      cands.push({ tipo: 'frete_gratis', chave: mudancasFrete.bairros.chave, vars: { desconto: `para ${cli.endereco_bairro}` } })
    }
    if (tel && fidPremio.has(tel)) cands.push({ tipo: 'fidelidade', chave: fidPremio.get(tel)!, vars: { premio: '1' } })
    else if (tel && fidProgresso.has(tel)) { const f = fidProgresso.get(tel)!; cands.push({ tipo: 'fidelidade', chave: f.chave, vars: { faltam: f.faltam === 1 ? '1 pedido' : `${f.faltam} pedidos` } }) }
    if (ped && ligada('recompra')) {
      const dias = Number(ligada('recompra')!.params.dias ?? 3)
      if (gatilhoRecompra(ped.qtd, ped.ultimoEm, agora, dias)) cands.push({ tipo: 'recompra', chave: `recompra:${ped.ultimoId}`, vars: { produto: ultimoProduto.get(ped.ultimoId) ?? 'pedido' } })
    }
    if (ped && ligada('inativo')) {
      const p = ligada('inativo')!.params
      const g = gatilhoInativo(ped.qtd, ped.ultimoEm, agora, Number(p.dias ?? 6), Number(p.repetir_dias ?? 14))
      if (g) cands.push({ tipo: 'inativo', chave: g.chave })
    }
    const deTiposLigados = cands.filter((c) => ligada(c.tipo))
    if (!deTiposLigados.length) continue
    if (!dentroDoLimite(hist.marketingEm.get(dest) ?? [], agora, config)) continue
    const categoriasUniao = [...new Set(aparelhos.flatMap((a) => a.categorias))]
    const escolhido = escolherCandidato(deTiposLigados, hist.chaves.get(dest) ?? new Set(), categoriasUniao)
    if (!escolhido) continue
    const auto = ligada(escolhido.tipo)!
    // Nome do cadastro; sem cadastro (pediu sem confirmar o código), o nome do último pedido.
    const vars = { nome: primeiroNome(cli?.nome || ped?.nome), loja: loja.nome, ...(escolhido.vars ?? {}) }
    const base = escolhido.tipo === 'fidelidade' && escolhido.vars?.premio ? String(auto.params.texto_premio ?? TEXTO_PREMIO_PADRAO) : auto.texto
    const texto = aplicarVariaveis(base, vars)
    const titulo = aplicarVariaveis(auto.titulo, vars) || loja.nome
    const categoria = CATEGORIA_DO_TIPO[escolhido.tipo]
    for (const a of aparelhos.filter((x) => x.categorias.includes(categoria))) {
      fila.push({ assinatura: a, origem: 'automacao', tipo: escolhido.tipo, categoria, chave: escolhido.chave, titulo, texto, destino: escolhido.link ?? '', imagem: escolhido.imagem })
    }
  }
  r.enfileirados = await enfileirar(admin, loja, fila)
  await salvar()
  return { ...r, avaliada: true }
}

// ── frete grátis: detecção por mudança ──────────────────────────────────────
async function fotoDoEstado(admin: SupabaseClient, loja: LojaPush): Promise<Record<string, unknown>> {
  const { data } = await admin.from('taxas_entrega_bairro').select('bairro, taxa').eq('restaurante_id', loja.id)
  return {
    frete_acima: loja.freteGratisAcima,
    bairros_gratis: (data ?? []).filter((b) => Number(b.taxa) === 0).map((b) => b.bairro).sort(),
  }
}

/**
 * Compara a foto anterior com a atual. A mudança fica "viva" 48 h (registro no estado), para a
 * loja que liga o frete de madrugada ainda avisar quando abrir. Primeira avaliação só fotografa.
 */
function mudancaDeFrete(antes: Record<string, unknown>, agoraFoto: Record<string, unknown>, agora: number) {
  const registro: Record<string, unknown> = {}
  let geral: { chave: string; texto: string } | null = null
  let bairros: { chave: string; lista: string[] } | null = null
  const inicializado = 'frete_acima' in antes
  const acimaAntes = antes.frete_acima as number | null | undefined
  const acimaAgora = agoraFoto.frete_acima as number | null
  if (inicializado && acimaAgora !== null && (acimaAntes === null || acimaAntes === undefined || acimaAgora < acimaAntes)) {
    registro.frete_geral = { em: agora, acima: acimaAgora }
  } else if (antes.frete_geral && acimaAgora !== null) registro.frete_geral = antes.frete_geral
  const fg = registro.frete_geral as { em: number; acima: number } | undefined
  if (fg && agora - fg.em < 2 * DIA) geral = { chave: `frete:${fg.em}`, texto: fg.acima > 0 ? `acima de ${brl(fg.acima)}` : 'em todos os pedidos' }

  const novos = inicializado ? bairrosQueFicaramGratis((antes.bairros_gratis as string[]) ?? [], (agoraFoto.bairros_gratis as string[]) ?? []) : []
  if (novos.length) registro.frete_bairros = { em: agora, lista: novos }
  else if (antes.frete_bairros) registro.frete_bairros = antes.frete_bairros
  const fb = registro.frete_bairros as { em: number; lista: string[] } | undefined
  if (fb && agora - fb.em < 2 * DIA) bairros = { chave: `frete_bairro:${fb.em}`, lista: fb.lista }
  return { geral, bairros, registro }
}

/** Avalia todas as lojas com push liberado (cron). */
export async function avaliarTodasAsLojas(admin: SupabaseClient, opcoes: { forcar?: boolean } = {}): Promise<ResumoAvaliacao[]> {
  const { data } = await admin.from('restaurantes').select(CAMPOS_LOJA).eq('push_liberado', true)
  const out: ResumoAvaliacao[] = []
  for (const l of data ?? []) {
    try { out.push(await avaliarLoja(admin, lojaDe(l), opcoes)) } catch (e) { out.push({ loja: l.slug, avaliada: false, motivo: (e as Error).message.slice(0, 120), enfileirados: 0 }) }
  }
  return out
}

// ── avulsas ─────────────────────────────────────────────────────────────────
export type PublicoAvulsa = { tipo: 'todos' } | { tipo: 'recentes'; dias: number } | { tipo: 'inativos'; dias: number } | { tipo: 'fidelidade' }
export type DestinoAvulsa = { tipo: 'cardapio' } | { tipo: 'produto'; id: string } | { tipo: 'cupom'; codigo: string } | { tipo: 'promocoes' }

export function linkDoDestino(d: DestinoAvulsa): string {
  if (d.tipo === 'produto') return `?item=${d.id}`
  if (d.tipo === 'cupom') return `?cupom=${encodeURIComponent(d.codigo)}`
  if (d.tipo === 'promocoes') return '?aba=promocoes'
  return ''
}

/** Aparelhos que recebem uma avulsa com este público (categoria promoções ligada). */
export async function resolverPublico(admin: SupabaseClient, restauranteId: string, publico: PublicoAvulsa, agora = Date.now()): Promise<{ aparelhos: AssinaturaPush[]; clientes: number }> {
  const todas = (await assinaturasAtivas(admin, restauranteId)).filter((a) => a.categorias.includes('promocoes'))
  let aparelhos = todas
  if (publico.tipo !== 'todos') {
    let aceitos = new Set<string>()
    if (publico.tipo === 'fidelidade') {
      const { data } = await admin.from('fidelidade_progresso').select('cliente_telefone').eq('restaurante_id', restauranteId)
      aceitos = new Set((data ?? []).map((p) => soDigitos(p.cliente_telefone)))
    } else {
      const ped = await pedidosPorTelefone(admin, restauranteId)
      const dias = Math.max(1, Number(publico.dias) || 1) * DIA
      for (const [t, p] of ped) {
        if (publico.tipo === 'recentes' && agora - p.ultimoEm <= dias) aceitos.add(t)
        if (publico.tipo === 'inativos' && agora - p.ultimoEm > dias) aceitos.add(t)
      }
    }
    aparelhos = todas.filter((a) => a.clienteTelefone && aceitos.has(a.clienteTelefone))
  }
  return { aparelhos, clientes: new Set(aparelhos.map(chaveDestinatario)).size }
}

/** Avulsas vencidas (agora ou agendadas) das lojas na janela: enfileira e marca concluída. */
export async function processarAvulsas(admin: SupabaseClient, agora = Date.now()): Promise<number> {
  const { data } = await admin
    .from('push_avulsas')
    .select('id, restaurante_id, titulo, texto, imagem_url, destino, publico, agendado_em')
    .eq('status', 'agendada')
    .or(`agendado_em.is.null,agendado_em.lte.${new Date(agora).toISOString()}`)
    .limit(20)
  let total = 0
  for (const a of data ?? []) {
    const loja = await carregarLoja(admin, a.restaurante_id)
    if (!loja?.pushLiberado) continue
    const config = await carregarConfig(admin, loja.id)
    // Fora da janela: espera (fica agendada; o cron tenta de novo).
    if (!podeMarketingAgora(janelaDaLoja(loja), config.antecedenciaMin)) continue
    const { data: trava } = await admin.from('push_avulsas').update({ status: 'enviando' }).eq('id', a.id).eq('status', 'agendada').select('id')
    if (!trava?.length) continue
    const { aparelhos } = await resolverPublico(admin, loja.id, a.publico as PublicoAvulsa, agora)
    const { data: clientes } = await admin.from('clientes').select('telefone, nome').eq('restaurante_id', loja.id)
    const nomes = new Map((clientes ?? []).map((c) => [soDigitos(c.telefone), c.nome as string | null]))
    total += await enfileirar(admin, loja, aparelhos.map((ap) => {
      const vars = { nome: primeiroNome(ap.clienteTelefone ? nomes.get(ap.clienteTelefone) : null), loja: loja.nome }
      return {
        assinatura: ap, origem: 'avulsa' as const, tipo: 'avulsa' as const, categoria: 'promocoes' as const,
        chave: `avulsa:${a.id}`, titulo: aplicarVariaveis(a.titulo, vars) || loja.nome, texto: aplicarVariaveis(a.texto, vars),
        destino: linkDoDestino(a.destino as DestinoAvulsa), imagem: a.imagem_url, avulsaId: a.id,
      }
    }))
    await admin.from('push_avulsas').update({ status: 'concluida' }).eq('id', a.id)
  }
  return total
}

/** "Enviar notificação de teste para mim": só as assinaturas do telefone de teste da loja. */
export async function enviarTeste(admin: SupabaseClient, loja: LojaPush, texto?: string): Promise<{ aparelhos: number; motivo?: string }> {
  const config = await carregarConfig(admin, loja.id)
  const tel = soDigitos(config.telefoneTeste)
  if (!tel) return { aparelhos: 0, motivo: 'Cadastre o telefone de teste.' }
  const aparelhos = (await assinaturasAtivas(admin, loja.id)).filter((a) => a.clienteTelefone === tel)
  if (!aparelhos.length) return { aparelhos: 0, motivo: 'Nenhum aparelho com notificação ativa para o telefone de teste.' }
  await enfileirar(admin, loja, aparelhos.map((a) => ({
    assinatura: a, origem: 'teste', tipo: 'teste', categoria: 'pedido', chave: null,
    titulo: loja.nome, texto: texto?.trim() || `Teste de notificação da ${loja.nome}. Se você está vendo isto, está funcionando! ✅`, destino: '',
  })))
  await processarFilaPush(admin, { limite: 50 })
  return { aparelhos: aparelhos.length }
}

/** Atribuição: pedido feito até 48 h depois do clique na notificação. */
export async function registrarPedidoDoPush(admin: SupabaseClient, restauranteId: string, envioId: string, pedidoId: string): Promise<boolean> {
  const { data } = await admin
    .from('push_envios')
    .update({ pedido_id: pedidoId, pedido_em: new Date().toISOString() })
    .eq('id', envioId)
    .eq('restaurante_id', restauranteId)
    .is('pedido_id', null)
    .gte('clicado_em', new Date(Date.now() - 2 * DIA).toISOString())
    .select('id')
  return Boolean(data?.length)
}
