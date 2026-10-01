-- Rollback da 0128. Usuários pausados/bloqueados/excluídos continuam sem acesso
-- (desativado_em fica); só o motivo some. A sensível "taxa" sobra no JSON e é ignorada
-- pelo código antigo (normalizarAcessos filtra chaves desconhecidas).
alter table public.usuarios drop constraint if exists usuarios_cargo_check;
alter table public.usuarios drop constraint if exists usuarios_situacao_check;
alter table public.usuarios drop column if exists cargo;
alter table public.usuarios drop column if exists situacao;
