-- Rollback da 0248 (Disparos v2). Ordem: (1) este arquivo; (2) reaplicar a 0247 inteira (trigger de agenda e
-- gerar_rodadas antigos). Perde: anúncios de Promoções/Personalizado, copies da Recuperação e a 6ª imagem.
-- Os cards Promoções e Personalizado voltam DESLIGADOS (a v1 não tem os anúncios; ligar exige imagem no card).

-- 1. Cron para de ler anúncios antes de tudo (a 0247 reaplicada recria a função antiga).
drop trigger if exists campanha_recorrentes_anuncios_agenda on public.campanha_recorrentes;
drop function if exists public.campanha_recorrentes_anuncios_agenda_fn();
update public.campanha_recorrentes set ativa = false, proximo_disparo_em = null where tipo in ('promocoes', 'nunca_compraram') and ativa;

-- 2. Funções novas.
drop function if exists public.campanha_recorrente_criar_rodada(uuid, uuid, uuid, text, text[], text, text, text, time, time, boolean, integer, integer, integer);
drop function if exists public.campanha_recorrente_pendentes_hoje(uuid);
drop function if exists public.campanha_publicos_tamanhos();
drop function if exists public.campanha_publico_estimativa(text[]);
drop function if exists public.campanha_recorrente_estimativa(text);
drop function if exists public.campanha_recorrente_publico(uuid, text, text[]);
drop function if exists public.campanha_publico_bate(text, timestamptz, timestamptz, integer, integer, numeric);
drop function if exists public.campanha_publico_base(uuid);

-- 3. Tabela de anúncios e o vínculo nas campanhas.
drop index if exists public.campanhas_anuncio_idx;
alter table public.campanhas drop column if exists anuncio_id;
drop table if exists public.campanha_recorrente_anuncios;

-- 4. Recuperação: volta a até 5 imagens e sem copies (a 1ª copy vira a mensagem, se a mensagem estiver vazia).
update public.campanha_recorrentes set mensagem = mensagens ->> 0
 where btrim(mensagem) = '' and jsonb_array_length(mensagens) > 0;
update public.campanha_recorrentes set imagens = (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(imagens) with ordinality t(x, o) where o <= 5),
       imagem_indice = 0
 where jsonb_array_length(imagens) > 5;
revoke update (mensagens) on public.campanha_recorrentes from authenticated;
alter table public.campanha_recorrentes drop constraint if exists campanha_recorrentes_mensagens_check;
alter table public.campanha_recorrentes drop column if exists mensagens, drop column if exists mensagem_indice;
alter table public.campanha_recorrentes drop constraint if exists campanha_recorrentes_imagens_check;
alter table public.campanha_recorrentes add constraint campanha_recorrentes_imagens_check
  check (jsonb_typeof(imagens) = 'array' and jsonb_array_length(imagens) <= 5);

-- 5. Público e estimativa da v1 (cópia da 0245).
create or replace function public.campanha_recorrente_publico(p_restaurante uuid, p_tipo text)
returns table (telefone text, nome_cliente text, ultimo_item text, ultimo_disparo_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with hoje as (
    select (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo' as inicio
  ), base as (
    select distinct on (public.telefone_chave(c.telefone)) c.telefone, public.telefone_chave(c.telefone) as k, c.nome_contato
      from public.whatsapp_conversas c
     where c.restaurante_id = p_restaurante
       and public.telefone_chave(c.telefone) is not null
       and exists (select 1 from public.whatsapp_mensagens m where m.conversa_id = c.id and m.direcao = 'entrada')
       and not exists (select 1 from public.whatsapp_descadastros d
                        where d.restaurante_id = p_restaurante and d.telefone_chave = public.telefone_chave(c.telefone))
       and not exists (select 1 from public.campanha_envios e, hoje
                        where e.restaurante_id = p_restaurante and e.criado_em >= hoje.inicio
                          and e.chave_destino = public.telefone_chave(c.telefone))
     order by public.telefone_chave(c.telefone), c.ultima_atividade_em desc nulls last, length(c.telefone) desc, c.criado_em desc
  ), ped as (
    select public.telefone_chave(p.cliente_telefone) as k, max(p.criado_em) as ultimo_em,
           (array_agg(p.id order by p.criado_em desc))[1] as ultimo_id
      from public.pedidos p
     where p.restaurante_id = p_restaurante and p.status <> 'cancelado' and public.telefone_chave(p.cliente_telefone) is not null
     group by 1
  ), nomes as (
    select distinct on (public.telefone_chave(cl.telefone)) public.telefone_chave(cl.telefone) as k, cl.nome
      from public.clientes cl
     where cl.restaurante_id = p_restaurante and nullif(btrim(cl.nome), '') is not null and public.telefone_chave(cl.telefone) is not null
     order by public.telefone_chave(cl.telefone), cl.criado_em
  ), ult as (
    select e.chave_destino as k, max(e.enviado_em) as ultimo
      from public.campanha_envios e
     where e.restaurante_id = p_restaurante and e.status in ('enviado', 'incerto')
     group by 1
  )
  select b.telefone,
         coalesce(n.nome, b.nome_contato, '') as nome_cliente,
         case when p_tipo = 'recuperacao'
              then (select i.nome from public.pedido_itens i where i.pedido_id = ped.ultimo_id order by i.id limit 1) end as ultimo_item,
         ult.ultimo as ultimo_disparo_em
    from base b
    left join ped on ped.k = b.k
    left join nomes n on n.k = b.k
    left join ult on ult.k = b.k
   where case p_tipo
           when 'recuperacao' then ped.ultimo_em is not null and ped.ultimo_em <= now() - interval '30 days'
           when 'nunca_compraram' then ped.k is null
           when 'promocoes' then true
           else false
         end
$$;
revoke execute on function public.campanha_recorrente_publico(uuid, text) from public, anon, authenticated;
grant execute on function public.campanha_recorrente_publico(uuid, text) to service_role;

create or replace function public.campanha_recorrente_estimativa(p_tipo text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_loja uuid := public.auth_restaurante_id();
begin
  if v_loja is null or not public.auth_e_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_tipo not in ('recuperacao', 'nunca_compraram', 'promocoes') then raise exception 'tipo inválido' using errcode = '22023'; end if;
  return (select count(*)::int from public.campanha_recorrente_publico(v_loja, p_tipo));
end $$;
revoke execute on function public.campanha_recorrente_estimativa(text) from public, anon;
grant execute on function public.campanha_recorrente_estimativa(text) to authenticated;

-- Agora: reaplicar supabase/migrations/0247_disparos_aquecimento.sql (agenda e gerar_rodadas da v1).
