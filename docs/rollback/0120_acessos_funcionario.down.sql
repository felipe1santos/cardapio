-- Rollback da 0120. Voltar o CÓDIGO antes (o middleware lê usuarios.acessos).
drop trigger if exists itens_cardapio_preco_sensivel on public.itens_cardapio;
drop function if exists public.itens_cardapio_preco_sensivel();
drop function if exists public.auth_pode_sensivel(text);
drop trigger if exists usuarios_acessos_so_servidor on public.usuarios;
drop function if exists public.usuarios_acessos_so_servidor();
alter table public.usuarios drop constraint if exists usuarios_acessos_check;
alter table public.usuarios drop column if exists acessos;
