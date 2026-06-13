-- ============================================================================
-- Cadastro self-service de lojistas com autorização manual: contas criadas
-- via /cadastro ficam sem acesso (autorizado = false, restaurante_id = null)
-- até o operador da plataforma vincular a loja (slug) e liberar o acesso
-- pelo painel /superadmin.
-- ============================================================================

alter table usuarios alter column restaurante_id drop not null;

alter table usuarios
  add column email text not null default '',
  add column telefone text not null default '',
  add column nome_loja text not null default '',
  add column autorizado boolean not null default false,
  add column ultimo_login_em timestamptz;

-- Contas que já existem (criadas via seed) já têm acesso liberado
update usuarios set autorizado = true where restaurante_id is not null;

-- Preenche o e-mail das contas existentes a partir do auth.users
update usuarios u set email = a.email
from auth.users a
where a.id = u.id and u.email = '';
