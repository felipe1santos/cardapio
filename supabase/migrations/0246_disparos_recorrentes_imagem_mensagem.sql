-- 0246 — Cada imagem do card tem a SUA mensagem (03/11/2026, pedido do dono).
-- · imagens passa a ser lista de objetos { "url": "https://…", "mensagem": "texto desta imagem" }. Mensagem vazia = usa a
--   mensagem padrão do card. Lista de texto antiga é convertida (nenhum card estava ligado em produção).
-- · Card só liga com pelo menos 1 imagem: todo disparo sai com imagem.
-- · "Pular hoje" sai da regra: a rodada não tem mais o passo de pular (o campo pular_ate fica, sem uso).
-- · A rodada usa a imagem da vez (rodízio diário) e a mensagem daquela imagem.
-- Aditiva no formato (a lista continua jsonb). Rollback: docs/rollback/0246_disparos_recorrentes_imagem_mensagem.down.sql

-- 1. Converter lista de texto para objetos (idempotente: só mexe no que ainda é texto).
update public.campanha_recorrentes r
   set imagens = coalesce((
     select jsonb_agg(case when jsonb_typeof(t.x) = 'string' then jsonb_build_object('url', t.x #>> '{}', 'mensagem', '') else t.x end order by t.ord)
       from jsonb_array_elements(r.imagens) with ordinality as t(x, ord)
   ), '[]'::jsonb)
 where jsonb_array_length(r.imagens) > 0
   and exists (select 1 from jsonb_array_elements(r.imagens) y where jsonb_typeof(y) = 'string');

-- 2. Regras de imagem na trigger (mesma função de agenda da 0245, com a checagem nova).
create or replace function public.campanha_recorrentes_agenda_fn()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
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
  if not new.ativa then
    new.proximo_disparo_em := null;
    return new;
  end if;
  new.proximo_disparo_em := public.campanha_recorrente_proximo(new.dias_semana, new.hora, v_base);
  if new.desligado_motivo is not null and (tg_op = 'INSERT' or old.ativa = false) then new.desligado_motivo := null; end if;
  return new;
end $$;

-- A trigger já existe (0245); a função nova vale na próxima gravação. Permissões explícitas (guarda B7), como na 0245.
revoke all on function public.campanha_recorrentes_agenda_fn() from public, anon;
grant execute on function public.campanha_recorrentes_agenda_fn() to authenticated, service_role;
-- 3. Rodada: imagem da vez + mensagem daquela imagem (sem o passo de "pular hoje").
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
  v_agora_sp timestamp := now() at time zone 'America/Sao_Paulo';
  v_dia_agenda date;
  v_campanha uuid;
  v_n integer;
  v_n_img integer;
  v_idx integer;
  v_imagem text;
  v_msg text;
  v_limite integer;
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
    v_rotulo := case v.tipo when 'recuperacao' then 'Recuperação de clientes' when 'nunca_compraram' then 'Disparos programados' else 'Promoções' end;

    -- 4. A rodada é uma campanha comum: entra na fila (reserva, teto, freio, pausa) e nas métricas de sempre.
    insert into public.campanhas (restaurante_id, nome, status, tipo_mensagem, mensagem, imagem_url, filtro, agendado_em,
                                  janela_inicio, janela_fim, incluir_link, incluir_descadastro, recorrente_id)
    values (v.restaurante_id, v_rotulo || ' · ' || to_char(v_hoje, 'DD/MM'), 'agendada',
            case when v_imagem is not null then 'imagem' else 'texto' end, v_msg, v_imagem,
            jsonb_build_object('tipo', 'recorrente'), now() + make_interval(secs => v.prioridade),
            v.hora, v.janela_fim, v.incluir_link, true, v.id)
    returning id into v_campanha;

    -- 5. Público: quem nunca recebeu primeiro, depois quem recebeu há mais tempo; só o que cabe na janela.
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
