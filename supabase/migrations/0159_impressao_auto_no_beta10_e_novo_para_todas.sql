-- 0159 — Item 60 (2026-10-08): Assistente novo para todas as lojas e envio automático no beta.10.
--
-- 1. Computador que chega no Assistente 0.2.0-beta.10 (ou mais novo) passa as impressoras dele que
--    estão em "Windows (driver)" para "Automático" — UMA vez, no primeiro sinal com a versão nova
--    (impressao_agentes.envio_auto_em marca que já foi feito; depois disso a escolha da loja manda).
--    Envio DIRETO (raw_fila / raw_rede) nunca muda. O automático tenta o direto e, se falhar, sai
--    pelo driver: a impressão não para.
-- 2. Impressora descoberta depois por um computador que já está no beta.10 nasce em "Automático".
-- 3. O Assistente novo fica liberado para todas as lojas (e as novas já nascem liberadas). O modo de
--    cada loja NÃO muda: quem imprime pelo antigo continua no antigo até passar pela tela.
-- Rollback: docs/rollback/0159_impressao_auto_no_beta10_e_novo_para_todas.down.sql

alter table public.impressao_agentes add column if not exists envio_auto_em timestamptz;

-- A versão do Assistente já conhece o envio automático? (0.2.0-beta.10+, ou 0.2.0 final e acima)
create or replace function public.impressao_versao_tem_auto(p_versao text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_versao is null then false
    when p_versao ~ '^0\.2\.0-beta\.[0-9]+' then substring(p_versao from '^0\.2\.0-beta\.([0-9]+)')::int >= 10
    when p_versao ~ '^[0-9]+\.[0-9]+\.[0-9]+' then
      (split_part(p_versao, '.', 1)::int, split_part(p_versao, '.', 2)::int, split_part(split_part(p_versao, '.', 3), '-', 1)::int) >= (0, 2, 0)
      and p_versao !~ '-'
    else false
  end
$$;

create or replace function public.impressao_agente_autenticar(p_credencial_hash text, p_versao text)
returns table (agente_id uuid, restaurante_id uuid, nome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid; v_loja uuid; v_nome text; v_versao text; v_auto timestamptz;
begin
  update public.impressao_agentes a
     set visto_em = now(), versao = coalesce(left(p_versao, 20), a.versao)
   where a.credencial_hash = p_credencial_hash and a.revogado_em is null
  returning a.id, a.restaurante_id, a.nome, a.versao, a.envio_auto_em into v_id, v_loja, v_nome, v_versao, v_auto;
  if v_id is null then return; end if;

  if v_auto is null and public.impressao_versao_tem_auto(v_versao) then
    -- Colunas com alias: agente_id/restaurante_id/nome também são os nomes da saída da função.
    update public.impressao_agentes ag set envio_auto_em = now() where ag.id = v_id and ag.envio_auto_em is null;
    if found then
      update public.impressao_dispositivos d set envio = 'auto' where d.agente_id = v_id and d.envio = 'driver';
    end if;
  end if;

  agente_id := v_id; restaurante_id := v_loja; nome := v_nome;
  return next;
end $$;

create or replace function public.impressao_descobrir(p_agente uuid, p_nomes text[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loja uuid;
  v_auto timestamptz;
  v_nomes text[];
begin
  select restaurante_id, envio_auto_em into v_loja, v_auto from public.impressao_agentes where id = p_agente and revogado_em is null;
  if v_loja is null then raise exception 'agente_invalido'; end if;
  select coalesce(array_agg(distinct left(btrim(n), 200)), '{}') into v_nomes
    from unnest(coalesce(p_nomes, '{}')) n where btrim(n) <> '';
  if cardinality(v_nomes) > 50 then raise exception 'impressoras_demais'; end if;

  insert into public.impressao_dispositivos (restaurante_id, agente_id, nome_sistema, disponivel, visto_em, envio)
  select v_loja, p_agente, n, true, now(), case when v_auto is not null then 'auto' else 'driver' end from unnest(v_nomes) n
  on conflict (agente_id, nome_sistema) do update set disponivel = true, visto_em = now();

  update public.impressao_dispositivos set disponivel = false
   where agente_id = p_agente and not (nome_sistema = any(v_nomes)) and disponivel;

  return cardinality(v_nomes);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'impressao_agente_autenticar(text,text)',
    'impressao_descobrir(uuid,text[])',
    'impressao_versao_tem_auto(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

update public.restaurantes set impressao_beta_liberado = true where impressao_beta_liberado is distinct from true;
alter table public.restaurantes alter column impressao_beta_liberado set default true;
