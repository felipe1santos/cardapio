-- Login por nome de usuário: o e-mail passa a ser só a autorização do pré-cadastro;
-- o lojista define um usuário próprio no primeiro acesso e entra com usuário+senha.
-- Aditivo e idempotente.

alter table usuarios add column if not exists usuario text not null default '';

-- Unicidade case-insensitive, ignorando contas antigas sem usuário definido.
create unique index if not exists usuarios_usuario_unique
  on usuarios (lower(usuario))
  where usuario <> '';
