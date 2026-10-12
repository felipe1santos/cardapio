-- 0190 — Campanhas seguras (12/10/2026): push grátis em todas as lojas + disparos de WhatsApp com janela, limite diário,
-- intervalo de 25–90 s por loja, 1 disparo por cliente a cada N dias e freio automático; modelos com título (push).
-- Aditiva. Nenhuma mensagem sai por causa dela: só muda as regras da fila e liga o push (que só manda para quem se inscreveu).

-- ── Push grátis para todas as lojas (loja nova já nasce liberada) ─────────────────────────────────────────────────
alter table public.restaurantes alter column push_liberado set default true;
update public.restaurantes set push_liberado = true where push_liberado is distinct from true;

-- ── Tetos da plataforma (Super Admin) ────────────────────────────────────────────────────────────────────────────
insert into public.plataforma_config (chave, valor, atualizado_por) values
  ('disparo_teto_dia', '150'::jsonb, 'migração 0190'),
  ('disparo_frequencia_dias', '3'::jsonb, 'migração 0190'),
  ('push_teto_dia', '1'::jsonb, 'migração 0190')
on conflict (chave) do nothing;

-- ── Disparos: limite diário e ritmo por loja; janela por campanha; último item por destinatário ────────────────
alter table public.restaurantes
  add column if not exists disparo_limite_dia integer not null default 150,
  add column if not exists disparo_proximo_em timestamptz;
alter table public.restaurantes drop constraint if exists restaurantes_disparo_limite_dia_check;
alter table public.restaurantes add constraint restaurantes_disparo_limite_dia_check check (disparo_limite_dia between 1 and 1000);

alter table public.campanhas
  add column if not exists janela_inicio time,
  add column if not exists janela_fim time;
alter table public.campanha_envios add column if not exists ultimo_item text check (ultimo_item is null or length(ultimo_item) <= 120);

-- ── Modelos de mensagem servem também ao push (título) ───────────────────────────────────────────────────────────
alter table public.campanha_modelos add column if not exists titulo text check (titulo is null or length(titulo) <= 60);

-- ── Leitura de configuração (inteiro com padrão) ─────────────────────────────────────────────────────────────────
create or replace function public.plataforma_int(p_chave text, p_padrao integer)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(valor) = 'number' then (valor)::text::integer end from public.plataforma_config where chave = p_chave), p_padrao)
$$;
revoke execute on function public.plataforma_int(text, integer) from public, anon, authenticated;
grant execute on function public.plataforma_int(text, integer) to service_role;

-- ── Opt-out: consultas usadas na entrada do WhatsApp ─────────────────────────────────────────────────────────────
create or replace function public.whatsapp_esta_descadastrado(p_restaurante uuid, p_telefone text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.whatsapp_descadastros where restaurante_id = p_restaurante and telefone_chave = public.telefone_chave(p_telefone))
$$;
create or replace function public.whatsapp_recebeu_disparo(p_restaurante uuid, p_telefone text, p_dias integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campanha_envios
                  where restaurante_id = p_restaurante and status = 'enviado' and enviado_em > now() - make_interval(days => greatest(p_dias, 1))
                    and public.telefone_chave(telefone) = public.telefone_chave(p_telefone))
$$;
revoke execute on function public.whatsapp_esta_descadastrado(uuid, text) from public, anon, authenticated;
revoke execute on function public.whatsapp_recebeu_disparo(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.whatsapp_esta_descadastrado(uuid, text) to service_role;
grant execute on function public.whatsapp_recebeu_disparo(uuid, text, integer) to service_role;

-- ── Freio: números da campanha (enviados, erros, pedidos de SAIR depois do 1º envio) ─────────────────────────────
create or replace function public.campanha_freio_numeros(p_campanha uuid)
returns table (enviados integer, erros integer, sair integer)
language sql stable security definer set search_path = public as $$
  with c as (select id, restaurante_id, (select min(enviado_em) from public.campanha_envios where campanha_id = p_campanha and status = 'enviado') inicio
               from public.campanhas where id = p_campanha)
  select
    (select count(*)::int from public.campanha_envios e where e.campanha_id = p_campanha and e.status = 'enviado'),
    (select count(*)::int from public.campanha_envios e where e.campanha_id = p_campanha and e.status = 'erro'),
    (select count(*)::int from public.whatsapp_descadastros d, c
      where d.restaurante_id = c.restaurante_id and c.inicio is not null and d.criado_em >= c.inicio and d.origem = 'cliente'
        and exists (select 1 from public.campanha_envios e where e.campanha_id = p_campanha and e.status = 'enviado'
                     and public.telefone_chave(e.telefone) = d.telefone_chave))
$$;
revoke execute on function public.campanha_freio_numeros(uuid) from public, anon, authenticated;
grant execute on function public.campanha_freio_numeros(uuid) to service_role;

-- ── Reserva da fila com as regras novas ──────────────────────────────────────────────────────────────────────────
-- Antes: até 5 por minuto, qualquer hora, expirava 24 h depois do agendamento. Agora, por LOJA:
--   • só dentro da janela da campanha (e nunca fora de 09:00–21:30, horário de Brasília);
--   • no máximo `disparo_limite_dia` por dia (teto do Super Admin), contando o que já saiu hoje;
--   • UMA mensagem por loja por chamada e a próxima só depois de 25–90 s (aleatório);
--   • cliente que recebeu outro disparo desta loja há menos de N dias (Super Admin, padrão 3) fica de fora;
--   • passou do limite do dia: continua amanhã na mesma janela (expira só 7 dias depois do agendamento).
drop function if exists public.campanha_reservar_envios(integer);
create function public.campanha_reservar_envios(p_limite integer)
returns table (
  id uuid, campanha_id uuid, restaurante_id uuid, telefone text, nome_cliente text, token text,
  tipo_mensagem text, mensagem text, imagem_url text, audio_url text, incluir_link boolean,
  evolution_instance text, slug text, incluir_descadastro boolean, ultimo_item text, nome_loja text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_agora_sp timestamp := now() at time zone 'America/Sao_Paulo';
  v_hoje_inicio timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  v_teto integer := public.plataforma_int('disparo_teto_dia', 150);
  v_freq integer := greatest(public.plataforma_int('disparo_frequencia_dias', 3), 0);
  v_loja record;
  v_envio uuid;
  v_ids uuid[] := '{}';
begin
  update public.campanha_envios e set status = 'expirado', erro = 'Expirado: mais de 7 dias após o horário agendado'
    from public.campanhas c
   where c.id = e.campanha_id and e.status = 'pendente' and c.status in ('agendada', 'enviando', 'pausada')
     and c.agendado_em < now() - interval '7 days';

  update public.campanha_envios e set status = 'cancelado', erro = 'Cliente pediu para não receber (SAIR)'
   where e.status = 'pendente'
     and exists (select 1 from public.whatsapp_descadastros d
                  where d.restaurante_id = e.restaurante_id and d.telefone_chave = public.telefone_chave(e.telefone));

  update public.campanha_envios e set status = 'incerto', erro = 'Envio interrompido: pode ter sido entregue'
   where e.status = 'reservado' and e.travado_ate is not null and e.travado_ate < now();

  update public.campanhas c set status = 'concluida', atualizado_em = now(), pausada_em = null, pausa_motivo = null
   where c.status in ('agendada', 'enviando', 'pausada')
     and c.agendado_em <= now()
     and exists (select 1 from public.campanha_envios x where x.campanha_id = c.id)
     and not exists (select 1 from public.campanha_envios x where x.campanha_id = c.id and x.status in ('pendente', 'reservado'));

  -- Nunca fora de 09:00–21:30 (Brasília), qualquer que seja a janela da campanha.
  if v_agora_sp::time < time '09:00' or v_agora_sp::time > time '21:30' then return; end if;

  for v_loja in
    select l.id, least(l.disparo_limite_dia, v_teto) limite
      from public.restaurantes l
     where (l.disparo_proximo_em is null or l.disparo_proximo_em <= now())
       and exists (select 1 from public.campanhas c
                    where c.restaurante_id = l.id and c.status in ('agendada', 'enviando')
                      and c.agendado_em is not null and c.agendado_em <= now()
                      and v_agora_sp::time between coalesce(c.janela_inicio, time '09:00') and coalesce(c.janela_fim, time '21:30'))
     limit greatest(1, least(coalesce(p_limite, 5), 50))
  loop
    -- Limite do dia (o que saiu hoje + o que está saindo agora).
    if (select count(*) from public.campanha_envios x
         where x.restaurante_id = v_loja.id
           and ((x.status in ('enviado', 'incerto') and x.enviado_em >= v_hoje_inicio) or x.status = 'reservado')) >= v_loja.limite then
      continue;
    end if;

    -- Frequência: quem recebeu outro disparo desta loja há menos de N dias fica de fora (não reenvia depois).
    if v_freq > 0 then
      update public.campanha_envios e set status = 'cancelado', erro = format('Recebeu outro disparo há menos de %s dias', v_freq)
        from public.campanhas c
       where c.id = e.campanha_id and e.restaurante_id = v_loja.id and e.status = 'pendente'
         and c.status in ('agendada', 'enviando')
         and exists (select 1 from public.campanha_envios y
                      where y.restaurante_id = v_loja.id and y.campanha_id <> e.campanha_id and y.status in ('enviado', 'incerto')
                        and y.enviado_em > now() - make_interval(days => v_freq)
                        and public.telefone_chave(y.telefone) = public.telefone_chave(e.telefone));
    end if;

    select e.id into v_envio
      from public.campanha_envios e
      join public.campanhas c on c.id = e.campanha_id
     where e.restaurante_id = v_loja.id and e.status = 'pendente'
       and c.status in ('agendada', 'enviando') and c.agendado_em is not null and c.agendado_em <= now()
       and v_agora_sp::time between coalesce(c.janela_inicio, time '09:00') and coalesce(c.janela_fim, time '21:30')
       and (e.proxima_tentativa_em is null or e.proxima_tentativa_em <= now())
     order by c.agendado_em, e.criado_em
     limit 1
     for update of e skip locked;
    if v_envio is null then continue; end if;

    update public.campanha_envios set status = 'reservado', travado_ate = now() + interval '5 minutes', tentativas = tentativas + 1 where id = v_envio;
    update public.campanhas set status = 'enviando', atualizado_em = now()
     where id = (select x.campanha_id from public.campanha_envios x where x.id = v_envio) and status = 'agendada';
    -- Próxima mensagem desta loja: entre 25 e 90 segundos.
    update public.restaurantes set disparo_proximo_em = now() + make_interval(secs => 25 + floor(random() * 66)::int) where id = v_loja.id;
    v_ids := v_ids || v_envio;
    v_envio := null;
  end loop;

  return query
  select r.id, r.campanha_id, r.restaurante_id, r.telefone, r.nome_cliente, r.token,
         c.tipo_mensagem, c.mensagem, c.imagem_url, c.audio_url, c.incluir_link,
         l.evolution_instance, l.slug, c.incluir_descadastro, r.ultimo_item, l.nome
    from public.campanha_envios r
    join public.campanhas c on c.id = r.campanha_id
    join public.restaurantes l on l.id = r.restaurante_id
   where r.id = any (v_ids)
   order by r.criado_em;
end $$;
revoke execute on function public.campanha_reservar_envios(integer) from public, anon, authenticated;
grant execute on function public.campanha_reservar_envios(integer) to service_role;
