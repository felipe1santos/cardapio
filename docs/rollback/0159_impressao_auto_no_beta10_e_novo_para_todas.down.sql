-- Rollback da 0159. Funções voltam à definição da 0088/0089; envio e liberação voltam pelo backup
-- (~/menuzia-backups/impressao-antes-0159-*.json: envio de cada impressora e lojas liberadas).
create or replace function public.impressao_agente_autenticar(p_credencial_hash text, p_versao text)
returns table (agente_id uuid, restaurante_id uuid, nome text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.impressao_agentes a
     set visto_em = now(), versao = coalesce(left(p_versao, 20), a.versao)
   where a.credencial_hash = p_credencial_hash and a.revogado_em is null
  returning a.id, a.restaurante_id, a.nome;
end $$;

create or replace function public.impressao_descobrir(p_agente uuid, p_nomes text[])
returns int language plpgsql security definer set search_path = public as $$
declare v_loja uuid; v_nomes text[];
begin
  select restaurante_id into v_loja from public.impressao_agentes where id = p_agente and revogado_em is null;
  if v_loja is null then raise exception 'agente_invalido'; end if;
  select coalesce(array_agg(distinct left(btrim(n), 200)), '{}') into v_nomes
    from unnest(coalesce(p_nomes, '{}')) n where btrim(n) <> '';
  if cardinality(v_nomes) > 50 then raise exception 'impressoras_demais'; end if;
  insert into public.impressao_dispositivos (restaurante_id, agente_id, nome_sistema, disponivel, visto_em)
  select v_loja, p_agente, n, true, now() from unnest(v_nomes) n
  on conflict (agente_id, nome_sistema) do update set disponivel = true, visto_em = now();
  update public.impressao_dispositivos set disponivel = false
   where agente_id = p_agente and not (nome_sistema = any(v_nomes)) and disponivel;
  return cardinality(v_nomes);
end $$;

drop function if exists public.impressao_versao_tem_auto(text);
alter table public.impressao_agentes drop column if exists envio_auto_em;
alter table public.restaurantes alter column impressao_beta_liberado set default false;
-- Liberação e envio por loja/impressora: restaurar do JSON de backup.
