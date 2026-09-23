-- ============================================================================
-- 0089 — Impressão: impressoras descobertas por agente e funções da loja
--
-- `impressao_dispositivos`: cada impressora do Windows que um agente encontrou,
-- ligada ÀQUELE agente (dois computadores podem ter uma "EPSON" cada — são
-- dispositivos diferentes). Apelido e largura (58/80 mm) quem define é o gerente.
-- Impressora que sumiu do Windows fica `disponivel = false`: nunca é trocada por
-- outra automaticamente.
--
-- `impressao_funcoes`: qual dispositivo faz cada função. Funções desta versão:
-- `cozinha` e `caixa`. A mesma impressora pode fazer as duas — só com confirmação
-- explícita, conferida na rota de servidor.
--
-- `restaurantes.impressao_cozinha_por_funcao`: roteamento da ficha da cozinha pela
-- função (desligado por padrão — lojas atuais seguem exatamente como hoje).
--
-- A tabela antiga `impressoras` (perfis de fonte/largura do modo compatível) não
-- é tocada.
-- ============================================================================

create table if not exists public.impressao_dispositivos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  agente_id uuid not null references public.impressao_agentes(id) on delete cascade,
  nome_sistema text not null check (length(nome_sistema) between 1 and 200),
  apelido text check (apelido is null or length(btrim(apelido)) between 1 and 40),
  largura_mm int not null default 80 check (largura_mm in (58, 80)),
  tamanho_fonte text not null default 'grande' check (tamanho_fonte in ('grande', 'media', 'pequena')),
  copias int not null default 1 check (copias between 1 and 3),
  disponivel boolean not null default true,
  visto_em timestamptz,
  ultimo_uso_em timestamptz,
  ultimo_erro text,
  ultimo_erro_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (agente_id, nome_sistema)
);
create index if not exists idx_impressao_dispositivos_loja on public.impressao_dispositivos (restaurante_id);

create table if not exists public.impressao_funcoes (
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  funcao text not null check (funcao in ('cozinha', 'caixa')),
  dispositivo_id uuid not null references public.impressao_dispositivos(id) on delete cascade,
  atribuido_em timestamptz not null default now(),
  atribuido_por_nome text,
  primary key (restaurante_id, funcao)
);

-- Função só aponta para impressora da MESMA loja (defesa além da rota).
create or replace function public.impressao_funcao_mesma_loja()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform 1 from public.impressao_dispositivos d where d.id = new.dispositivo_id and d.restaurante_id = new.restaurante_id;
  if not found then raise exception 'dispositivo_de_outra_loja' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists impressao_funcao_mesma_loja on public.impressao_funcoes;
create trigger impressao_funcao_mesma_loja before insert or update on public.impressao_funcoes
  for each row execute function public.impressao_funcao_mesma_loja();

alter table public.impressao_dispositivos enable row level security;
alter table public.impressao_funcoes enable row level security;
revoke all on public.impressao_dispositivos from anon, authenticated;
revoke all on public.impressao_funcoes from anon, authenticated;

alter table public.restaurantes add column if not exists impressao_cozinha_por_funcao boolean not null default false;
-- 0080: coluna nova de restaurantes precisa de grant explícito. Só leitura no painel.
grant select (impressao_cozinha_por_funcao) on public.restaurantes to authenticated;

-- Descoberta: o agente manda a lista do Windows; o que veio fica disponível, o que
-- sumiu fica indisponível (não é apagado — pode ter função atribuída e histórico).
create or replace function public.impressao_descobrir(p_agente uuid, p_nomes text[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loja uuid;
  v_nomes text[];
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

revoke execute on function public.impressao_descobrir(uuid, text[]) from public, anon, authenticated;
grant execute on function public.impressao_descobrir(uuid, text[]) to service_role;
