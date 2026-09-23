-- ============================================================================
-- 0088 — Impressão: cada computador é um agente com credencial própria
--
-- Até aqui o Assistente se identificava só pelo token da loja, o mesmo em todos
-- os computadores (e 4 deles vazaram antes da 0080). Agora:
--
--   · o dono/gerente gera um CÓDIGO DE PAREAMENTO de uso único que expira em 10
--     minutos (o banco guarda só o hash);
--   · o Assistente troca o código pela CREDENCIAL do agente (gerada no servidor,
--     devolvida uma única vez; o banco guarda só o hash sha256);
--   · cada agente tem nome, versão, último sinal e pode ser revogado sozinho, sem
--     derrubar os outros computadores da loja.
--
-- O token antigo da loja continua funcionando (modo compatível) até a migração dos
-- computadores. Nada no navegador lê estas tabelas: RLS ligada, sem policy, sem
-- grant — só as rotas de servidor (service_role).
-- ============================================================================

create table if not exists public.impressao_agentes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 60),
  credencial_hash text not null unique check (credencial_hash ~ '^[0-9a-f]{64}$'),
  versao text,
  visto_em timestamptz,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.usuarios(id) on delete set null,
  criado_por_nome text,
  revogado_em timestamptz,
  revogado_por_nome text
);
create index if not exists idx_impressao_agentes_loja on public.impressao_agentes (restaurante_id);

create table if not exists public.impressao_pareamentos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  codigo_hash text not null unique check (codigo_hash ~ '^[0-9a-f]{64}$'),
  expira_em timestamptz not null,
  usado_em timestamptz,
  agente_id uuid references public.impressao_agentes(id) on delete set null,
  criado_por uuid references public.usuarios(id) on delete set null,
  criado_por_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_impressao_pareamentos_loja on public.impressao_pareamentos (restaurante_id);

alter table public.impressao_agentes enable row level security;
alter table public.impressao_pareamentos enable row level security;
revoke all on public.impressao_agentes from anon, authenticated;
revoke all on public.impressao_pareamentos from anon, authenticated;

-- Troca do código pela credencial. Código usado, expirado ou inexistente: mesma
-- resposta ('codigo_invalido') — não diz qual dos três, para não ajudar tentativa.
create or replace function public.impressao_parear(
  p_codigo_hash text, p_credencial_hash text, p_nome text, p_versao text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_agente uuid;
  v_nome text := left(coalesce(nullif(btrim(p_nome), ''), 'Computador'), 60);
begin
  select * into p from public.impressao_pareamentos
   where codigo_hash = p_codigo_hash and usado_em is null and expira_em > now()
   for update;
  if p.id is null then raise exception 'codigo_invalido'; end if;

  insert into public.impressao_agentes (restaurante_id, nome, credencial_hash, versao, visto_em, criado_por, criado_por_nome)
  values (p.restaurante_id, v_nome, p_credencial_hash, left(p_versao, 20), now(), p.criado_por, p.criado_por_nome)
  returning id into v_agente;

  update public.impressao_pareamentos set usado_em = now(), agente_id = v_agente where id = p.id;

  perform public.auditoria_registrar(p.restaurante_id, null, 'Assistente de Impressão', 'impressao.agente_pareado', 'impressao_agente', v_agente,
    jsonb_build_object('nome', v_nome, 'versao', left(p_versao, 20), 'codigo_gerado_por', p.criado_por_nome));

  return jsonb_build_object('agente_id', v_agente, 'restaurante_id', p.restaurante_id, 'nome', v_nome);
end $$;

-- Autenticação a cada chamada do agente: credencial válida e não revogada. Registra
-- o sinal de vida (visto_em) e a versão do programa.
create or replace function public.impressao_agente_autenticar(p_credencial_hash text, p_versao text)
returns table (agente_id uuid, restaurante_id uuid, nome text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.impressao_agentes a
     set visto_em = now(), versao = coalesce(left(p_versao, 20), a.versao)
   where a.credencial_hash = p_credencial_hash and a.revogado_em is null
  returning a.id, a.restaurante_id, a.nome;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'impressao_parear(text,text,text,text)',
    'impressao_agente_autenticar(text,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
