-- Rollback da 0142 (CMV). ATENÇÃO: apaga insumos, fichas, histórico de custos e o custo guardado das vendas.
-- Faça backup das tabelas cmv_* e pedido_itens_custo antes.
drop trigger if exists cmv_guardar_custo_linha on public.pedido_itens;
drop function if exists public.cmv_guardar_custo_linha();
drop function if exists public.cmv_custo_linha(uuid, uuid, text, text, text, text, jsonb);
drop function if exists public.cmv_custo_ficha(uuid);
drop function if exists public.cmv_custo_insumo(uuid, int);
drop table if exists public.pedido_itens_custo;
drop table if exists public.cmv_config_categoria;
drop table if exists public.cmv_config;
drop table if exists public.cmv_ficha_componentes;
drop table if exists public.cmv_fichas;
drop table if exists public.cmv_custos_historico;
drop table if exists public.cmv_insumo_componentes;
drop table if exists public.cmv_insumos;
drop function if exists public.cmv_historico_imutavel();
drop function if exists public.cmv_chave(text);
