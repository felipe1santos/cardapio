-- Desfaz a 0199 (Entregas Lalamove). Apaga as corridas e as chaves das lojas — fazer backup antes.
alter publication supabase_realtime drop table public.entregas_provedor;
drop table if exists public.entregas_provedor;
drop table if exists public.entregas_provedor_config;
delete from public.loja_modulos where modulo = 'entregas_lalamove';
alter table public.loja_modulos drop constraint if exists loja_modulos_modulo_check;
alter table public.loja_modulos add constraint loja_modulos_modulo_check check (modulo in ('financeiro', 'agente_ia', 'disparos'));
