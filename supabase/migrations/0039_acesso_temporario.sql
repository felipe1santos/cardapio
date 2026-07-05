-- Controle de acesso do lojista no /superadmin: acesso com validade (temporário)
-- e contagem de logins pra ordenar por mais acessados. Aditivo e idempotente.

alter table usuarios add column if not exists acesso_expira_em timestamptz;
alter table usuarios add column if not exists logins_total int not null default 0;
