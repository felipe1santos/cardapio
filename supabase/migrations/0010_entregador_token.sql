-- Token público (link/QR code) do portal do motoboy — acesso sem login.
-- O motoboy acessa /entregador/{token} e vê só as entregas atribuídas a ele.
alter table entregadores
  add column token uuid not null default gen_random_uuid();

create unique index entregadores_token_idx on entregadores (token);
