import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 03/11/2026: disparos recorrentes (docs/superpowers/specs/2026-11-03-disparos-recorrentes-design.md). */
const sql = readFileSync('supabase/migrations/0245_disparos_recorrentes.sql', 'utf8')

describe('0245 campanha_recorrentes', () => {
  it('tabela com os 3 tipos, unique por loja e RLS de gestor', () => {
    expect(sql).toMatch(/create table if not exists public\.campanha_recorrentes/)
    expect(sql).toMatch(/tipo in \('recuperacao', 'nunca_compraram', 'promocoes'\)/)
    expect(sql).toMatch(/unique \(restaurante_id, tipo\)/)
    expect(sql).toMatch(/ativa boolean not null default false/)
    expect(sql).toMatch(/jsonb_array_length\(imagens\) <= 5/)
    expect(sql).toMatch(/alter table public\.campanha_recorrentes enable row level security/)
    expect(sql).toMatch(/auth_e_gestor\(\)/)
    // Revisão 03/11: update só nas colunas que a tela mexe — agenda, índice da imagem e última rodada são do cron.
    expect(sql).toMatch(/grant select, insert on public\.campanha_recorrentes to authenticated/)
    expect(sql).toMatch(/grant update \(ativa, mensagem, incluir_link, imagens, dias_semana, hora, janela_fim, pular_ate\) on public\.campanha_recorrentes to authenticated/)
    expect(sql).not.toMatch(/grant select, insert, update on public\.campanha_recorrentes/)
    expect(sql).toMatch(/dias_semana <@ '\{0,1,2,3,4,5,6\}'/)
    expect(sql).toMatch(/janela_fim > hora/)
    expect(sql).toMatch(/jsonb_typeof\(x\) <> 'string'/)
  })
  it('card atrasado (dia errado ou janela já fechada) só avança a agenda', () => {
    expect(sql).toMatch(/'ok', 'sem_publico', 'pulado', 'atrasado'/)
    const rod = sql.slice(sql.indexOf('function public.campanha_recorrentes_gerar_rodadas()'))
    expect(rod).toMatch(/'atrasado'/)
    expect(rod).toMatch(/v_dia_agenda <> v_hoje/)
    expect(rod).toMatch(/> v\.janela_fim/)
  })
  it('público sem subconsulta por linha: nomes e último disparo agrupados por chave, usando chave_destino', () => {
    const pub = sql.slice(sql.indexOf('function public.campanha_recorrente_publico('), sql.indexOf('function public.campanha_recorrente_estimativa('))
    expect(pub).toMatch(/nomes as \(/)
    expect(pub).toMatch(/ult as \(/)
    expect(pub).toMatch(/e\.chave_destino/)
    expect(pub).toMatch(/left join nomes/)
    expect(pub).toMatch(/left join ult/)
    expect(pub).not.toMatch(/\(select cl\.nome from public\.clientes/)
    expect(pub).not.toMatch(/\(select max\(e\.enviado_em\)/)
  })
  it('índice parcial dos vencidos e coluna recorrente_id em campanhas', () => {
    expect(sql).toMatch(/create index if not exists campanha_recorrentes_vencidos on public\.campanha_recorrentes \(proximo_disparo_em\) where ativa/)
    expect(sql).toMatch(/alter table public\.campanhas add column if not exists recorrente_id uuid references public\.campanha_recorrentes\(id\) on delete set null/)
  })
  it('frequência por cliente vai a 2 dias; trigger calcula a agenda', () => {
    expect(sql).toMatch(/update public\.plataforma_config set valor = '2'::jsonb[^;]*where chave = 'disparo_frequencia_dias'/)
    expect(sql).toMatch(/create or replace function public\.campanha_recorrente_proximo\(p_dias smallint\[\], p_hora time, p_a_partir timestamptz\)/)
    expect(sql).toMatch(/create trigger campanha_recorrentes_agenda before insert or update of ativa, dias_semana, hora, pular_ate/)
  })
})

describe('0245 público dos cards', () => {
  const publico = sql.slice(sql.indexOf('function public.campanha_recorrente_publico('), sql.indexOf('function public.campanha_recorrente_estimativa('))
  it('base: quem mandou mensagem para a loja, fora descadastros e fora quem já entrou em rodada hoje', () => {
    expect(publico).toMatch(/from public\.whatsapp_conversas/)
    expect(publico).toMatch(/direcao = 'entrada'/)
    expect(publico).toMatch(/not exists \(select 1 from public\.whatsapp_descadastros/)
    expect(publico).toMatch(/not exists \(select 1 from public\.campanha_envios[^)]*criado_em >= /)
    expect(publico).toMatch(/distinct on \(public\.telefone_chave\(/)
  })
  it('recuperação = último pedido há 30 dias ou mais; nunca compraram = sem pedido; promoções = todos', () => {
    expect(publico).toMatch(/interval '30 days'/)
    expect(publico).toMatch(/when 'nunca_compraram' then/)
    expect(publico).toMatch(/when 'promocoes' then true/)
  })
  it('devolve ultimo_disparo_em e só o service_role chama; estimativa é da sessão de gestor', () => {
    expect(publico).toMatch(/ultimo_disparo_em timestamptz/)
    expect(publico).toMatch(/revoke execute on function public\.campanha_recorrente_publico\(uuid, text\) from public, anon, authenticated/)
    expect(sql).toMatch(/function public\.campanha_recorrente_estimativa\(p_tipo text\)[\s\S]*auth_e_gestor\(\)/)
    expect(sql).toMatch(/grant execute on function public\.campanha_recorrente_estimativa\(text\) to authenticated/)
  })
})

describe('0245 geração de rodadas', () => {
  const rod = sql.slice(sql.indexOf('function public.campanha_recorrentes_gerar_rodadas()'))
  it('lê só cards vencidos de loja com o módulo ligado, em ordem de prioridade, com skip locked', () => {
    expect(rod).toMatch(/join public\.loja_modulos/)
    expect(rod).toMatch(/r\.ativa and r\.proximo_disparo_em <= now\(\)/)
    expect(rod).toMatch(/when 'recuperacao' then 0 when 'nunca_compraram' then 1 else 2 end/)
    expect(rod).toMatch(/for update of r skip locked/)
  })
  it('avança a agenda ANTES de criar a campanha (trava contra rodada dupla) e pula o dia marcado', () => {
    const avanca = rod.indexOf('proximo_disparo_em = public.campanha_recorrente_proximo(')
    const cria = rod.indexOf('insert into public.campanhas')
    expect(avanca).toBeGreaterThan(0)
    expect(cria).toBeGreaterThan(avanca)
    expect(rod).toMatch(/'pulado'/)
  })
  it('público em ordem de quem nunca recebeu, limitado ao que cabe na janela; sem público apaga a campanha', () => {
    expect(rod).toMatch(/order by p\.ultimo_disparo_em nulls first, random\(\)/)
    expect(rod).toMatch(/\/ 105/)
    expect(rod).toMatch(/least\(/)
    expect(rod).toMatch(/'sem_publico'/)
    expect(rod).toMatch(/delete from public\.campanhas where id = v_campanha/)
  })
  it('imagem da vez e rodízio; só service_role', () => {
    expect(rod).toMatch(/imagem_indice \+ 1\) % v_n_img/)
    expect(rod).toMatch(/revoke execute on function public\.campanha_recorrentes_gerar_rodadas\(\) from public, anon, authenticated/)
    expect(rod).toMatch(/grant execute on function public\.campanha_recorrentes_gerar_rodadas\(\) to service_role/)
  })
})

describe('0245 cadência nova e métricas em 72 h', () => {
  const reserva = sql.slice(sql.indexOf('create function public.campanha_reservar_envios(p_limite integer)'))
  it('próxima mensagem da loja em 60–150 s', () => {
    expect(reserva).toMatch(/60 \+ floor\(random\(\) \* 91\)/)
    expect(reserva).not.toMatch(/25 \+ floor\(random\(\) \* 66\)/)
  })
  it('rodada de card expira no fim da janela do dia; agendamentos seguem com 7 dias', () => {
    expect(reserva).toMatch(/Rodada do dia encerrada/)
    expect(reserva).toMatch(/c\.recorrente_id is not null/)
    expect(reserva).toMatch(/interval '7 days'/)
  })
  it('atribuição detalhada passa a 72 h, igual à visão geral', () => {
    const atr = sql.slice(sql.indexOf('function public.campanha_atribuicoes('), sql.indexOf('function public.campanhas_metricas('))
    expect(atr).toMatch(/interval '72 hours'/)
    expect(atr).not.toMatch(/12 hours/)
    const met = sql.slice(sql.indexOf('function public.campanhas_metricas('), sql.indexOf('function public.campanha_destinatarios('))
    expect(met).not.toMatch(/12 hours/)
  })
})
