-- Cadastro automático (self-service sem autorização manual do e-mail) com validade
-- em dias, controlado pelo /superadmin + backfill do nome de usuário das contas
-- antigas (que logavam pelo e-mail). Aditivo e idempotente.

create table if not exists config_plataforma (
  id int primary key default 1 check (id = 1),
  cadastro_automatico boolean not null default false,
  cadastro_automatico_dias int not null default 30
);

insert into config_plataforma (id) values (1) on conflict do nothing;

-- Só o service role lê/escreve (nenhuma policy pra anon/authenticated).
alter table config_plataforma enable row level security;

-- Contas criadas antes do login por usuário ficaram com `usuario` vazio e não
-- conseguem mais entrar digitando um login sem '@' (ex.: a conta antiga "admin").
-- Preenche com a parte local do e-mail, deduplicando com sufixo numérico.
with cand as (
  select id, lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9._-]', '', 'g')) as base
  from usuarios
  where usuario = '' and restaurante_id is not null
),
dedup as (
  select id, base, row_number() over (partition by base order by id) as rn
  from cand
  where base <> '' and not exists (select 1 from usuarios u2 where lower(u2.usuario) = cand.base)
)
update usuarios u
set usuario = case when d.rn = 1 then d.base else d.base || d.rn end
from dedup d
where u.id = d.id;
