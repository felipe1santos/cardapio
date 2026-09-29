-- 0112 — Campanhas: descadastro ("SAIR") e pausa quando o WhatsApp da loja cai.
--
--   whatsapp_descadastros     quem pediu para não receber campanhas, por loja e telefone
--                             (telefone_chave: com/sem 55, com/sem o 9 é o mesmo). Avisos de
--                             pedido, código e fidelidade NÃO olham esta tabela.
--   campanhas.incluir_descadastro  rodapé "Para não receber mais, responda SAIR" (nasce
--                             false: campanhas antigas não mudam; a tela liga nas novas).
--   campanhas.pausada_em / pausa_motivo  campanha 'pausada' (WhatsApp desconectado): a fila
--                             fica pendente e volta a sair quando a loja reconecta.
--   whatsapp_envios.tipo      + 'descadastro' (a confirmação do SAIR sai pela fila, mesmo
--                             com o robô da loja desligado).
--   campanha_reservar_envios  + não reserva quem se descadastrou (o envio vira 'cancelado');
--                             campanha pausada não sai (já não saía: filtro de status).
--   campanha_concluir_envio   + resultado 'pausa': o envio volta para a fila SEM contar a
--                             tentativa e a campanha fica 'pausada'.
--
-- Aditiva: nenhuma linha existente muda. Rollback: docs/rollback/0112_campanhas_descadastro_pausa.down.sql

create table if not exists public.whatsapp_descadastros (
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  telefone_chave text not null,
  telefone text not null,
  origem text not null default 'cliente' check (origem in ('cliente', 'painel')),
  criado_em timestamptz not null default now(),
  primary key (restaurante_id, telefone_chave)
);

alter table public.whatsapp_descadastros enable row level security;
revoke all on public.whatsapp_descadastros from anon, authenticated;
grant select on public.whatsapp_descadastros to authenticated;
drop policy if exists "Gestor vê descadastros da loja" on public.whatsapp_descadastros;
create policy "Gestor vê descadastros da loja" on public.whatsapp_descadastros
  for select to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());

alter table public.campanhas
  add column if not exists incluir_descadastro boolean not null default false,
  add column if not exists pausada_em timestamptz,
  add column if not exists pausa_motivo text;

alter table public.whatsapp_envios drop constraint if exists whatsapp_envios_tipo_check;
alter table public.whatsapp_envios add constraint whatsapp_envios_tipo_check
  check (tipo in ('robo', 'aviso_pedido', 'descadastro'));

-- ─── seletor do cron (0104 + descadastro) ─────────────────────────────────────
-- O retorno ganha incluir_descadastro: mudar colunas de saída exige recriar a função.
drop function if exists public.campanha_reservar_envios(integer);
create function public.campanha_reservar_envios(p_limite integer)
returns table (
  id uuid, campanha_id uuid, restaurante_id uuid, telefone text, nome_cliente text, token text,
  tipo_mensagem text, mensagem text, imagem_url text, audio_url text, incluir_link boolean,
  evolution_instance text, slug text, incluir_descadastro boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- Nada sai com mais de 24h de atraso sobre o horário agendado (vale para pausada também).
  update public.campanha_envios e set status = 'expirado', erro = 'Expirado: mais de 24h após o horário agendado'
    from public.campanhas c
   where c.id = e.campanha_id and e.status = 'pendente' and c.status in ('agendada', 'enviando', 'pausada')
     and c.agendado_em < now() - interval '24 hours';

  -- Quem pediu para sair depois de a campanha ser montada não recebe.
  update public.campanha_envios e set status = 'cancelado', erro = 'Cliente pediu para não receber (SAIR)'
   where e.status = 'pendente'
     and exists (select 1 from public.whatsapp_descadastros d
                  where d.restaurante_id = e.restaurante_id and d.telefone_chave = public.telefone_chave(e.telefone));

  -- Trava vencida (o processo caiu no meio): pode ter saído — nunca reenviar sozinho.
  update public.campanha_envios e set status = 'incerto', erro = 'Envio interrompido: pode ter sido entregue'
   where e.status = 'reservado' and e.travado_ate is not null and e.travado_ate < now();

  -- Campanha sem mais nada na fila: concluída.
  update public.campanhas c set status = 'concluida', atualizado_em = now(), pausada_em = null, pausa_motivo = null
   where c.status in ('agendada', 'enviando', 'pausada')
     and c.agendado_em <= now()
     and exists (select 1 from public.campanha_envios x where x.campanha_id = c.id)
     and not exists (select 1 from public.campanha_envios x where x.campanha_id = c.id and x.status in ('pendente', 'reservado'));

  return query
  with alvo as (
    select e.id
      from public.campanha_envios e
      join public.campanhas c on c.id = e.campanha_id
     where e.status = 'pendente'
       and c.status in ('agendada', 'enviando')
       and c.agendado_em is not null
       and c.agendado_em <= now()
       and (e.proxima_tentativa_em is null or e.proxima_tentativa_em <= now())
     order by e.criado_em
     limit greatest(1, least(coalesce(p_limite, 5), 50))
     for update of e skip locked
  ), reservados as (
    update public.campanha_envios e
       set status = 'reservado', travado_ate = now() + interval '5 minutes', tentativas = e.tentativas + 1
      from alvo where e.id = alvo.id
    returning e.*
  ), marcadas as (
    update public.campanhas c set status = 'enviando', atualizado_em = now()
     where c.id in (select r.campanha_id from reservados r) and c.status = 'agendada'
    returning c.id
  )
  select r.id, r.campanha_id, r.restaurante_id, r.telefone, r.nome_cliente, r.token,
         c.tipo_mensagem, c.mensagem, c.imagem_url, c.audio_url, c.incluir_link,
         l.evolution_instance, l.slug, c.incluir_descadastro
    from reservados r
    join public.campanhas c on c.id = r.campanha_id
    join public.restaurantes l on l.id = r.restaurante_id
   order by r.criado_em;
end $$;

-- p_resultado: 'enviado' | 'transitorio' | 'definitivo' | 'incerto' | 'pausa'
create or replace function public.campanha_concluir_envio(p_id uuid, p_resultado text, p_id_externo text, p_erro text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare e public.campanha_envios%rowtype; v_final text;
begin
  select * into e from public.campanha_envios where id = p_id for update;
  if not found or e.status <> 'reservado' then return 'ignorado'; end if;

  if p_resultado = 'pausa' then
    -- WhatsApp da loja desconectado: nada saiu. Volta para a fila sem gastar tentativa.
    update public.campanha_envios set status = 'pendente', travado_ate = null, erro = left(p_erro, 300),
           tentativas = greatest(e.tentativas - 1, 0), proxima_tentativa_em = null
     where id = p_id;
    update public.campanhas set status = 'pausada', pausada_em = coalesce(pausada_em, now()),
           pausa_motivo = 'whatsapp_desconectado', atualizado_em = now()
     where id = e.campanha_id and status in ('agendada', 'enviando');
    return 'pausa';
  elsif p_resultado = 'enviado' then
    update public.campanha_envios set status = 'enviado', enviado_em = now(), id_externo = left(p_id_externo, 200),
           erro = null, travado_ate = null where id = p_id;
    update public.campanhas set total_enviados = total_enviados + 1, atualizado_em = now() where id = e.campanha_id;
    v_final := 'enviado';
  elsif p_resultado = 'transitorio' and e.tentativas < 3 then
    update public.campanha_envios set status = 'pendente', travado_ate = null, erro = left(p_erro, 300),
           proxima_tentativa_em = now() + (case e.tentativas when 1 then interval '1 minute' else interval '5 minutes' end)
     where id = p_id;
    v_final := 'nova_tentativa';
  elsif p_resultado = 'incerto' then
    update public.campanha_envios set status = 'incerto', travado_ate = null, erro = left(p_erro, 300) where id = p_id;
    v_final := 'incerto';
  else
    update public.campanha_envios set status = 'erro', travado_ate = null, erro = left(p_erro, 300) where id = p_id;
    update public.campanhas set total_erros = total_erros + 1, atualizado_em = now() where id = e.campanha_id;
    v_final := 'erro';
  end if;

  update public.campanhas c set status = 'concluida', atualizado_em = now()
   where c.id = e.campanha_id and c.status in ('agendada', 'enviando')
     and not exists (select 1 from public.campanha_envios x where x.campanha_id = c.id and x.status in ('pendente', 'reservado'));
  return v_final;
end $$;

-- Descadastro / volta (chamado pelo servidor ao receber SAIR/VOLTAR). Idempotente.
create or replace function public.whatsapp_descadastrar(p_restaurante uuid, p_telefone text, p_sair boolean, p_origem text default 'cliente')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare k text := public.telefone_chave(p_telefone);
begin
  if k is null then return false; end if;
  if p_sair then
    insert into public.whatsapp_descadastros (restaurante_id, telefone_chave, telefone, origem)
    values (p_restaurante, k, regexp_replace(p_telefone, '\D', '', 'g'), coalesce(p_origem, 'cliente'))
    on conflict (restaurante_id, telefone_chave) do nothing;
    -- O que ainda não saiu deste cliente, em qualquer campanha da loja, não sai mais.
    update public.campanha_envios set status = 'cancelado', erro = 'Cliente pediu para não receber (SAIR)'
     where restaurante_id = p_restaurante and status = 'pendente' and public.telefone_chave(telefone) = k;
  else
    delete from public.whatsapp_descadastros where restaurante_id = p_restaurante and telefone_chave = k;
  end if;
  return true;
end $$;

revoke execute on function public.whatsapp_descadastrar(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.whatsapp_descadastrar(uuid, text, boolean, text) to service_role;
revoke execute on function public.campanha_reservar_envios(integer) from public, anon, authenticated;
revoke execute on function public.campanha_concluir_envio(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.campanha_reservar_envios(integer) to service_role;
grant execute on function public.campanha_concluir_envio(uuid, text, text, text) to service_role;
