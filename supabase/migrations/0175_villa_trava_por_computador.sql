-- 0175 — Trava da atualização do Assistente pelo COMPUTADOR pareado, não só pelo IP (10/10/2026, ordem do dono).
--
-- O atualizador do Assistente (beta.13) busca o latest.yml sem credencial nenhuma: o servidor só vê o IP. Para a
-- trava não depender do IP de internet do momento, ela passa a ser do computador pareado:
--   · impressao_agentes.sem_atualizacao: este computador NÃO recebe a atualização automática (Villa: PC-PRINCIPAL);
--   · impressao_agente_ips: todo IP de onde um computador travado buscou pedidos (gatilho; só age nos travados);
--   · a rota do latest.yml nega para qualquer IP já usado por um computador travado e, como segunda checagem,
--     continua negando para o visto_ip das lojas com restaurantes.impressao_sem_atualizacao (0172).
-- Nada é apagado nem convertido.

alter table public.impressao_agentes add column if not exists sem_atualizacao boolean not null default false;

create table if not exists public.impressao_agente_ips (
  agente_id uuid not null references public.impressao_agentes(id) on delete cascade,
  ip text not null check (length(ip) <= 64),
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  primary key (agente_id, ip)
);
alter table public.impressao_agente_ips enable row level security;
revoke all on public.impressao_agente_ips from anon, authenticated;

create or replace function public.impressao_agente_ip_registrar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sem_atualizacao and new.visto_ip is not null then
    insert into public.impressao_agente_ips (agente_id, ip) values (new.id, new.visto_ip)
    on conflict (agente_id, ip) do update set ultimo_em = now();
  end if;
  return new;
end $$;
revoke execute on function public.impressao_agente_ip_registrar() from public, anon, authenticated;

drop trigger if exists impressao_agente_ip_registrar on public.impressao_agentes;
-- Só dispara quando o IP muda (ou a trava é ligada) e o computador está travado: as outras lojas não pagam nada.
create trigger impressao_agente_ip_registrar
  after update of visto_ip, sem_atualizacao on public.impressao_agentes
  for each row
  when (new.sem_atualizacao and new.visto_ip is not null
        and (old.visto_ip is distinct from new.visto_ip or old.sem_atualizacao is distinct from new.sem_atualizacao))
  execute function public.impressao_agente_ip_registrar();

-- Villa: o computador pareado (não revogado) fica travado; o IP atual e o já conhecido entram no histórico.
update public.impressao_agentes a set sem_atualizacao = true
  from public.restaurantes r
 where r.id = a.restaurante_id and r.slug = 'villa-lanches' and a.revogado_em is null;
insert into public.impressao_agente_ips (agente_id, ip)
select a.id, a.visto_ip from public.impressao_agentes a
 where a.sem_atualizacao and a.visto_ip is not null
on conflict do nothing;
insert into public.impressao_agente_ips (agente_id, ip)
select a.id, '186.223.169.172' from public.impressao_agentes a
  join public.restaurantes r on r.id = a.restaurante_id
 where r.slug = 'villa-lanches' and a.sem_atualizacao
on conflict do nothing;
