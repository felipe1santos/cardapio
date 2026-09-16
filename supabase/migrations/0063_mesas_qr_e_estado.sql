-- Mesas: token público do QR, identificação e estado operacional.
--
-- A tabela `mesas` existe desde a 0033 (PDV Fase 1) com nome, ordem e ativa. O módulo
-- Mesas e Comandas precisa de mais: um token opaco por mesa para o QR, setor e
-- capacidade para o mapa do salão, e um estado operacional que não se confunde com
-- `ativa` (que é cadastro, não operação).
--
-- O token segue o padrão já usado em estações de cozinha (0029) e no portal do
-- entregador: uuid opaco, único, validado no servidor com o client admin. Nada de id
-- sequencial previsível na URL pública.

alter table public.mesas add column if not exists token uuid not null default gen_random_uuid();
alter table public.mesas add column if not exists setor text;
alter table public.mesas add column if not exists capacidade int;
alter table public.mesas add column if not exists bloqueada_em timestamptz;
alter table public.mesas add column if not exists token_gerado_em timestamptz not null default now();

-- Um token só pode apontar para uma mesa. O índice é global de propósito: o token viaja
-- sozinho na URL pública, sem slug de loja.
create unique index if not exists mesas_token_unq on public.mesas (token);

alter table public.mesas drop constraint if exists mesas_capacidade_check;
alter table public.mesas add constraint mesas_capacidade_check
  check (capacidade is null or (capacidade > 0 and capacidade <= 99));

comment on column public.mesas.token is
  'Segredo do QR da mesa. Opaco e revogável (regenerar troca o valor sem mexer no id). NUNCA conceder a anon.';
comment on column public.mesas.bloqueada_em is
  'Mesa bloqueada pela operação (reservada, quebrada, em limpeza). Diferente de `ativa`, que é cadastro.';

-- `anon` não tem grant nenhum em `mesas` (a 0062 já restringiu a papéis autenticados por
-- allowlist), e a resolução do token na rota pública roda com service_role. Garantia
-- explícita, no espírito do checkpoint S: a chave pública não lê esta tabela.
revoke all on public.mesas from anon;
