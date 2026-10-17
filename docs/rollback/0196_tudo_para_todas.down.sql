-- Volta da 0196: devolve as chaves como estavam (cópia em backup.*_0196).
alter table public.restaurantes add column if not exists novidades_teste boolean not null default false;
update public.restaurantes r set novidades_teste = b.novidades_teste, pdv_v2 = b.pdv_v2, financeiro_ativo = b.financeiro_ativo
  from backup.restaurantes_chaves_0196 b where b.id = r.id;
alter table public.restaurantes alter column pdv_v2 set default false;
alter table public.restaurantes alter column financeiro_ativo set default false;
update public.whatsapp_robo_config w set ia_ativo = b.ia_ativo from backup.robo_ia_0196 b where b.restaurante_id = w.restaurante_id;
alter table public.whatsapp_robo_config alter column ia_ativo set default false;
