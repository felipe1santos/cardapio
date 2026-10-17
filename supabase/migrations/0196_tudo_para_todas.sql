-- 0196 (16/10/2026): TUDO PARA TODAS AS LOJAS — o único liga/desliga por loja é o Super Admin (loja_modulos).
--   · "Novidades em teste" acabou: a coluna sai (o código já não lê; aplicar DEPOIS do deploy).
--   · pdv_v2 e financeiro_ativo passam a valer para todas (e para loja nova): o módulo Financeiro do Super Admin é a
--     única chave do Financeiro; o PDV v2 é o PDV de todas.
--   · Agente de IA: módulo liberado no Super Admin = ligado por padrão (a loja ainda pode desligar em Ajustes).
-- Cópia do que muda em backup.*_0196; volta em docs/rollback/0196_tudo_para_todas.down.sql.
create schema if not exists backup;
create table if not exists backup.restaurantes_chaves_0196 as
  select id, slug, novidades_teste, pdv_v2, financeiro_ativo from public.restaurantes;
create table if not exists backup.robo_ia_0196 as
  select restaurante_id, ia_ativo from public.whatsapp_robo_config;

update public.restaurantes set pdv_v2 = true where pdv_v2 is distinct from true;
alter table public.restaurantes alter column pdv_v2 set default true;

update public.restaurantes set financeiro_ativo = true where financeiro_ativo is distinct from true;
alter table public.restaurantes alter column financeiro_ativo set default true;

update public.whatsapp_robo_config w set ia_ativo = true
 where ia_ativo is distinct from true
   and exists (select 1 from public.loja_modulos m where m.restaurante_id = w.restaurante_id and m.modulo = 'agente_ia' and m.liberado);
alter table public.whatsapp_robo_config alter column ia_ativo set default true;

alter table public.restaurantes drop column if exists novidades_teste;
