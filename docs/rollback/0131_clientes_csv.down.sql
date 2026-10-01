-- Rollback da 0131. ATENÇÃO: clientes importados continuam na tabela (só perdem a marca de
-- origem e os campos novos). Para tirá-los antes, use "Desfazer importação" no painel ou:
--   delete from clientes where origem = 'importado' and <critério>;
drop function if exists public.clientes_telefones_conhecidos(uuid, text[]);
drop function if exists public.clientes_importacao_reservar_lote(uuid, integer);
drop function if exists public.clientes_importacao_liberar_lote(uuid, integer);
drop function if exists public.clientes_importacao_somar(uuid, integer, integer, integer, integer);
drop index if exists public.clientes_importacao;
alter table public.clientes drop constraint if exists clientes_origem_check;
alter table public.clientes drop column if exists importacao_id;
alter table public.clientes drop column if exists origem;
alter table public.clientes drop column if exists observacoes;
alter table public.clientes drop column if exists endereco_uf;
alter table public.clientes drop column if exists data_nascimento;
alter table public.clientes drop column if exists email;
drop table if exists public.clientes_importacao_alteracoes;
drop table if exists public.clientes_importacoes;
