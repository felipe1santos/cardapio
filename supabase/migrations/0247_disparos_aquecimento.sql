-- 0247 — Aquecimento do número e resumo do dia (03/11/2026, pedido do dono).
-- · Limite diário dos 3 cards JUNTOS que sobe aos poucos: 15 mensagens nos 5 primeiros dias (contando da 1ª rodada
--   de card da loja), 20 do 5º ao 9º, +5 a cada 5 dias. Vale por cima das regras de sempre (teto diário da loja,
--   60–150 s, 2 dias por pessoa, janela 09:00–21:30), que continuam iguais. Card que encontra o limite do dia gasto
--   marca 'limite_dia' e volta no próximo dia programado.
-- · Card só liga com tudo pronto: pelo menos 1 imagem E mensagem para cada imagem (a própria ou a padrão do card).
-- · campanha_recorrentes_resumo(): números da aba Campanhas — hoje (enviadas, na fila, limite e quando sobe) e as
--   últimas 16 h (enviadas, perdidas, pedidos e receita atribuídos aos cards).
-- Aditiva. Rollback: docs/rollback/0247_disparos_aquecimento.down.sql

-- 1. Motivo novo da última rodada.
alter table public.campanha_recorrentes drop constraint if exists campanha_recorrentes_motivo_check;
alter table public.campanha_recorrentes add constraint campanha_recorrentes_motivo_check
  check (ultima_rodada_motivo is null or ultima_rodada_motivo in ('ok', 'sem_publico', 'pulado', 'atrasado', 'limite_dia'));

-- 2. Limite do aquecimento: 15 + 5 a cada 5 dias desde a 1ª rodada de card da loja (sem rodada ainda = dia 0).
create or replace function public.campanha_recorrente_limite_aquecimento(p_restaurante uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select 15 + 5 * (greatest(0,
    (now() at time zone 'America/Sao_Paulo')::date
    - coalesce((select min((c.criado_em at time zone 'America/Sao_Paulo')::date) from public.campanhas c
                 where c.restaurante_id = p_restaurante and c.recorrente_id is not null),
               (now() at time zone 'America/Sao_Paulo')::date)) / 5)
$$;
revoke execute on function public.campanha_recorrente_limite_aquecimento(uuid) from public, anon, authenticated;
grant execute on function public.campanha_recorrente_limite_aquecimento(uuid) to service_role;

-- 3. Trigger: card só liga com imagem e com mensagem para cada imagem.
create or replace function public.campanha_recorrentes_agenda_fn()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_base timestamptz := now();
begin
  new.atualizado_em := now();
  if exists (select 1 from jsonb_array_elements(new.imagens) x
              where jsonb_typeof(x) <> 'object' or jsonb_typeof(x -> 'url') <> 'string' or (x ->> 'url') !~ '^https://'
                 or length(coalesce(x ->> 'mensagem', '')) > 4096) then
    raise exception 'imagens: cada uma precisa de URL https e mensagem de até 4096 caracteres' using errcode = '23514';
  end if;
  if new.ativa and jsonb_array_length(new.imagens) = 0 then
    raise exception 'o card precisa de pelo menos 1 imagem para ligar' using errcode = '23514';
  end if;
  if new.ativa and btrim(new.mensagem) = ''
     and exists (select 1 from jsonb_array_elements(new.imagens) x where btrim(coalesce(x ->> 'mensagem', '')) = '') then
    raise exception 'o card precisa de mensagem: escreva a mensagem padrão ou uma mensagem em cada imagem' using errcode = '23514';
  end if;
  if not new.ativa then
    new.proximo_disparo_em := null;
    return new;
  end if;
  new.proximo_disparo_em := public.campanha_recorrente_proximo(new.dias_semana, new.hora, v_base);
  if new.desligado_motivo is not null and (tg_op = 'INSERT' or old.ativa = false) then new.desligado_motivo := null; end if;
  return new;
end $$;
revoke all on function public.campanha_recorrentes_agenda_fn() from public, anon;
grant execute on function public.campanha_recorrentes_agenda_fn() to authenticated, service_role;

-- 4. Rodada com o limite do aquecimento (cópia da 0246 + passo 3b).
create or replace function public.campanha_recorrentes_gerar_rodadas()
returns table (recorrente_id uuid, campanha_id uuid, destinatarios integer, motivo text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v record;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_hoje_inicio timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  v_agora_sp timestamp := now() at time zone 'America/Sao_Paulo';
  v_dia_agenda date;
  v_campanha uuid;
  v_n integer;
  v_n_img integer;
  v_idx integer;
  v_imagem text;
  v_msg text;
  v_limite integer;
  v_resta integer;
  v_rotulo text;
begin
  for v in
    select r.id, r.restaurante_id, r.tipo, r.mensagem, r.incluir_link, r.imagens, r.imagem_indice, r.hora, r.janela_fim,
           r.proximo_disparo_em, l.disparo_limite_dia,
           case r.tipo when 'recuperacao' then 0 when 'nunca_compraram' then 1 else 2 end as prioridade
      from public.campanha_recorrentes r
      join public.restaurantes l on l.id = r.restaurante_id
      join public.loja_modulos m on m.restaurante_id = r.restaurante_id and m.modulo = 'disparos' and m.liberado
     where r.ativa and r.proximo_disparo_em <= now()
     order by r.restaurante_id, case r.tipo when 'recuperacao' then 0 when 'nunca_compraram' then 1 else 2 end
     for update of r skip locked
  loop
    -- 1. Trava: a agenda avança antes de qualquer outra coisa.
    update public.campanha_recorrentes
       set proximo_disparo_em = public.campanha_recorrente_proximo(dias_semana, hora, now() + interval '1 minute')
     where id = v.id;

    -- 2. Atrasado: a agenda era de outro dia, ou a janela de hoje já fechou → não dispara fora do combinado.
    v_dia_agenda := (v.proximo_disparo_em at time zone 'America/Sao_Paulo')::date;
    if v_dia_agenda <> v_hoje or v_agora_sp::time > v.janela_fim then
      update public.campanha_recorrentes set ultima_rodada_em = now(), ultima_rodada_motivo = 'atrasado', ultima_campanha_id = null where id = v.id;
      recorrente_id := v.id; campanha_id := null; destinatarios := 0; motivo := 'atrasado';
      return next;
      continue;
    end if;

    -- 3. Imagem da vez (rodízio diário) e a mensagem dessa imagem; quanto cabe na janela com 60–150 s (média 105 s).
    v_n_img := jsonb_array_length(v.imagens);
    v_idx := case when v_n_img > 0 then v.imagem_indice % v_n_img else null end;
    v_imagem := case when v_idx is not null then v.imagens -> v_idx ->> 'url' else null end;
    v_msg := case when v_idx is not null then coalesce(nullif(v.imagens -> v_idx ->> 'mensagem', ''), v.mensagem) else v.mensagem end;
    v_limite := greatest(1, least(v.disparo_limite_dia, floor(extract(epoch from (v.janela_fim - v.hora)) / 105)::int));

    -- 3b. Aquecimento do número: o que os 3 cards da loja já enfileiraram hoje sai do limite do dia.
    v_resta := public.campanha_recorrente_limite_aquecimento(v.restaurante_id)
             - (select count(*)::int from public.campanha_envios e join public.campanhas c on c.id = e.campanha_id
                 where c.restaurante_id = v.restaurante_id and c.recorrente_id is not null and c.agendado_em >= v_hoje_inicio);
    if v_resta <= 0 then
      update public.campanha_recorrentes set ultima_rodada_em = now(), ultima_rodada_motivo = 'limite_dia', ultima_campanha_id = null where id = v.id;
      recorrente_id := v.id; campanha_id := null; destinatarios := 0; motivo := 'limite_dia';
      return next;
      continue;
    end if;
    v_limite := least(v_limite, v_resta);
    v_rotulo := case v.tipo when 'recuperacao' then 'Recuperação de clientes' when 'nunca_compraram' then 'Disparos programados' else 'Promoções' end;

    -- 4. A rodada é uma campanha comum: entra na fila (reserva, teto, freio, pausa) e nas métricas de sempre.
    insert into public.campanhas (restaurante_id, nome, status, tipo_mensagem, mensagem, imagem_url, filtro, agendado_em,
                                  janela_inicio, janela_fim, incluir_link, incluir_descadastro, recorrente_id)
    values (v.restaurante_id, v_rotulo || ' · ' || to_char(v_hoje, 'DD/MM'), 'agendada',
            case when v_imagem is not null then 'imagem' else 'texto' end, v_msg, v_imagem,
            jsonb_build_object('tipo', 'recorrente'), now() + make_interval(secs => v.prioridade),
            v.hora, v.janela_fim, v.incluir_link, true, v.id)
    returning id into v_campanha;

    -- 5. Público: quem nunca recebeu primeiro, depois quem recebeu há mais tempo; só o que cabe (janela e aquecimento).
    insert into public.campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente, ultimo_item)
    select v_campanha, v.restaurante_id, p.telefone, coalesce(p.nome_cliente, ''), left(p.ultimo_item, 120)
      from public.campanha_recorrente_publico(v.restaurante_id, v.tipo) p
     order by p.ultimo_disparo_em nulls first, random()
     limit v_limite;
    get diagnostics v_n = row_count;

    -- 6. Sem público: não fica campanha vazia para trás.
    if v_n = 0 then
      delete from public.campanhas where id = v_campanha;
      update public.campanha_recorrentes
         set ultima_rodada_em = now(), ultima_rodada_motivo = 'sem_publico', ultima_campanha_id = null
       where id = v.id;
      recorrente_id := v.id; campanha_id := null; destinatarios := 0; motivo := 'sem_publico';
      return next;
      continue;
    end if;

    -- 7. Rodada criada: totais e rodízio da imagem.
    update public.campanhas set total_destinatarios = v_n, atualizado_em = now() where id = v_campanha;
    update public.campanha_recorrentes
       set ultima_rodada_em = now(), ultima_campanha_id = v_campanha, ultima_rodada_motivo = 'ok',
           imagem_indice = case when v_n_img > 0 then (imagem_indice + 1) % v_n_img else imagem_indice end
     where id = v.id;
    recorrente_id := v.id; campanha_id := v_campanha; destinatarios := v_n; motivo := 'ok';
    return next;
  end loop;
end $$;
revoke execute on function public.campanha_recorrentes_gerar_rodadas() from public, anon, authenticated;
grant execute on function public.campanha_recorrentes_gerar_rodadas() to service_role;

-- 5. Resumo da aba Campanhas (só os cards): hoje e últimas 16 h. Pela sessão, só gestor da própria loja.
create or replace function public.campanha_recorrentes_resumo()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_loja uuid := public.auth_restaurante_id();
  v_hoje_inicio timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  v_desde timestamptz := now() - interval '16 hours';
  v_inicio date;
  v_dias integer;
  v_limite integer;
  v_res jsonb;
begin
  if v_loja is null or not public.auth_e_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select min((criado_em at time zone 'America/Sao_Paulo')::date) into v_inicio
    from public.campanhas where restaurante_id = v_loja and recorrente_id is not null;
  v_dias := case when v_inicio is null then 0 else greatest(0, (now() at time zone 'America/Sao_Paulo')::date - v_inicio) end;
  v_limite := 15 + 5 * (v_dias / 5);

  with env as (
    select e.id, e.status, e.enviado_em, e.criado_em, c.agendado_em
      from public.campanha_envios e
      join public.campanhas c on c.id = e.campanha_id
     where c.restaurante_id = v_loja and c.recorrente_id is not null
       and coalesce(e.enviado_em, e.criado_em) >= least(v_hoje_inicio, v_desde)
  ), atr as (
    select a.total from public.campanha_atribuicoes(v_loja, v_desde, now()) a
     where a.envio_id in (select id from env)
  )
  select jsonb_build_object(
    'hoje_enviadas', (select count(*) from env where status = 'enviado' and enviado_em >= v_hoje_inicio),
    'hoje_enfileiradas', (select count(*) from env where agendado_em >= v_hoje_inicio),
    'hoje_na_fila', (select count(*) from env where agendado_em >= v_hoje_inicio and status in ('pendente', 'reservado')),
    'limite_hoje', v_limite,
    'proximo_limite', v_limite + 5,
    'dias_para_subir', 5 - (v_dias % 5),
    'h16_enviadas', (select count(*) from env where status = 'enviado' and enviado_em >= v_desde),
    'h16_perdidas', (select count(*) from env where status in ('erro', 'expirado', 'incerto') and coalesce(enviado_em, criado_em) >= v_desde),
    'h16_pedidos', (select count(*) from atr),
    'h16_receita', (select coalesce(sum(total), 0) from atr)
  ) into v_res;
  return v_res;
end $$;
revoke execute on function public.campanha_recorrentes_resumo() from public, anon;
grant execute on function public.campanha_recorrentes_resumo() to authenticated;
