-- ============================================================================
-- 0100 — Assistente Beta: liberação por loja, modos seguros e calibração por impressora
--
-- O Assistente antigo (0.1.23, token da loja) continua exatamente como está. O Beta
-- (pareado por código) só entra numa loja LIBERADA para o piloto e começa no modo
-- "Somente teste". Os modos:
--   · teste         → o Beta imprime só página de teste e calibração;
--   · caixa         → o Beta imprime o Recibo/Extrato; a cozinha fica no Assistente antigo;
--   · cozinha_caixa → o Beta assume também a ficha da cozinha (transferência atômica,
--                     com carimbo do horário da troca para não imprimir em dobro).
-- A troca de modo é uma função do banco: trava a linha da loja, liga/desliga o
-- roteamento da cozinha (impressao_cozinha_por_funcao, 0089) junto e audita.
--
-- Calibração: perfil por IMPRESSORA (impressao_dispositivos) — largura efetiva em pontos
-- e deslocamento. Nulo = padrão de hoje (576 pontos no 80 mm, 384 no 58 mm). Não muda a
-- impressão de nenhuma outra impressora nem do Assistente antigo.
--
-- Só adiciona colunas e funções. Nenhum dado existente muda: toda loja nasce com o Beta
-- desligado e em "teste"; nenhuma impressora ganha perfil.
-- Rollback: docs/rollback/0100_impressao_beta_modos_e_calibracao.down.sql
-- ============================================================================

alter table public.restaurantes add column if not exists impressao_beta_liberado boolean not null default false;
alter table public.restaurantes add column if not exists impressao_beta_modo text not null default 'teste';
alter table public.restaurantes add column if not exists impressao_cozinha_transferida_em timestamptz;
alter table public.restaurantes drop constraint if exists restaurantes_impressao_beta_modo_check;
alter table public.restaurantes add constraint restaurantes_impressao_beta_modo_check
  check (impressao_beta_modo in ('teste', 'caixa', 'cozinha_caixa'));

comment on column public.restaurantes.impressao_beta_liberado is 'Loja do piloto do Assistente Beta (liberada pela plataforma). Sem isso não gera código de pareamento.';
comment on column public.restaurantes.impressao_beta_modo is 'teste | caixa | cozinha_caixa — o que o Assistente Beta imprime (0100).';
comment on column public.restaurantes.impressao_cozinha_transferida_em is 'Quando a cozinha passou para o Beta (corte contra impressão em dobro com o Assistente antigo).';

alter table public.impressao_dispositivos add column if not exists largura_pontos int;
alter table public.impressao_dispositivos add column if not exists deslocamento_pontos int not null default 0;
alter table public.impressao_dispositivos add column if not exists diagnostico jsonb;
alter table public.impressao_dispositivos add column if not exists calibrado_em timestamptz;
alter table public.impressao_dispositivos add column if not exists calibrado_por_nome text;
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_largura_pontos_check;
alter table public.impressao_dispositivos add constraint impressao_dispositivos_largura_pontos_check
  check (largura_pontos is null or largura_pontos between 256 and 832);
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_deslocamento_pontos_check;
alter table public.impressao_dispositivos add constraint impressao_dispositivos_deslocamento_pontos_check
  check (deslocamento_pontos between -64 and 64);

-- ─── troca de modo (atômica e auditada) ────────────────────────────────────────
create or replace function public.impressao_modo_definir(
  p_restaurante uuid, p_modo text, p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_cozinha uuid;
  v_agente record;
begin
  if p_modo not in ('teste', 'caixa', 'cozinha_caixa') then raise exception 'modo_invalido'; end if;
  select id, impressao_beta_liberado, impressao_beta_modo, impressao_cozinha_por_funcao
    into r from public.restaurantes where id = p_restaurante for update;
  if r.id is null then raise exception 'loja_inexistente'; end if;

  -- Voltar ao antigo é sempre permitido (é o botão de emergência); avançar exige piloto.
  if p_modo <> 'teste' and not r.impressao_beta_liberado then raise exception 'beta_nao_liberado'; end if;

  if p_modo = 'cozinha_caixa' then
    select f.dispositivo_id into v_cozinha from public.impressao_funcoes f where f.restaurante_id = p_restaurante and f.funcao = 'cozinha';
    if v_cozinha is null then raise exception 'sem_cozinha'; end if;
    select a.id, a.revogado_em, a.visto_em into v_agente
      from public.impressao_dispositivos d join public.impressao_agentes a on a.id = d.agente_id
     where d.id = v_cozinha;
    if v_agente.id is null or v_agente.revogado_em is not null then raise exception 'agente_revogado'; end if;
    if v_agente.visto_em is null or v_agente.visto_em < now() - interval '30 seconds' then raise exception 'agente_offline'; end if;
  end if;

  if r.impressao_beta_modo = p_modo then
    return jsonb_build_object('modo', p_modo, 'idempotente', true);
  end if;

  update public.restaurantes
     set impressao_beta_modo = p_modo,
         impressao_cozinha_por_funcao = (p_modo = 'cozinha_caixa'),
         impressao_cozinha_transferida_em = case when p_modo = 'cozinha_caixa' then now() else impressao_cozinha_transferida_em end
   where id = p_restaurante;

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'impressao.modo_alterado', 'restaurante', p_restaurante,
    jsonb_build_object('de', r.impressao_beta_modo, 'para', p_modo,
                       'cozinha', case when p_modo = 'cozinha_caixa' then 'assistente_beta' else 'assistente_antigo' end));
  return jsonb_build_object('modo', p_modo, 'idempotente', false);
end $$;

revoke all on function public.impressao_modo_definir(uuid, text, uuid, text) from public, anon, authenticated;

-- ─── página de calibração (trabalho de teste marcado) ─────────────────────────
-- Mesmo fluxo do teste de impressora (0090), com o perfil atual da impressora no
-- snapshot: o Assistente Beta imprime a régua e as bordas com a largura aplicada.
create or replace function public.impressao_calibracao_criar(
  p_restaurante uuid, p_dispositivo uuid, p_chave text, p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  j record;
  v_id uuid;
begin
  if p_chave is null or p_chave !~* '^[0-9a-f-]{36}$' then raise exception 'chave_invalida'; end if;
  select id, estado into j from public.impressao_trabalhos where restaurante_id = p_restaurante and chave = p_chave;
  if j.id is not null then return jsonb_build_object('id', j.id, 'estado', j.estado, 'idempotente', true); end if;

  select dsp.id, dsp.agente_id, dsp.apelido, dsp.nome_sistema, dsp.largura_mm, dsp.largura_pontos, dsp.deslocamento_pontos,
         a.revogado_em, a.nome as agente_nome, r.nome as loja
    into d
    from public.impressao_dispositivos dsp
    join public.impressao_agentes a on a.id = dsp.agente_id
    join public.restaurantes r on r.id = dsp.restaurante_id
   where dsp.id = p_dispositivo and dsp.restaurante_id = p_restaurante;
  if d.id is null then raise exception 'dispositivo_inexistente'; end if;
  if d.revogado_em is not null then raise exception 'impressora_caixa_indisponivel'; end if;

  insert into public.impressao_trabalhos
    (restaurante_id, tipo, dispositivo_id, agente_id, snapshot, chave, criado_por, criado_por_nome, expira_em)
  values
    (p_restaurante, 'teste_impressora', d.id, d.agente_id,
     jsonb_build_object('versao', 1, 'calibracao', true, 'loja', d.loja, 'impressora', coalesce(d.apelido, d.nome_sistema),
                        'nome_sistema', d.nome_sistema, 'computador', d.agente_nome, 'largura_mm', d.largura_mm,
                        'largura_pontos', d.largura_pontos, 'deslocamento_pontos', d.deslocamento_pontos,
                        'operador', p_ator_nome, 'impresso_em', now()),
     p_chave, p_ator, p_ator_nome, now() + interval '10 minutes')
  returning id into v_id;

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'impressao.calibracao', 'impressao_dispositivo', d.id,
    jsonb_build_object('trabalho_id', v_id, 'impressora', coalesce(d.apelido, d.nome_sistema), 'resumo', coalesce(d.apelido, d.nome_sistema)));
  return jsonb_build_object('id', v_id, 'estado', 'pendente', 'idempotente', false);
end $$;

revoke all on function public.impressao_calibracao_criar(uuid, uuid, text, uuid, text) from public, anon, authenticated;
