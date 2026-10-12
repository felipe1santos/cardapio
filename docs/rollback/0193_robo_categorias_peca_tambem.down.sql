update public.whatsapp_conversas set auto_estado = null where auto_estado = 'escolher_categoria' or auto_estado like 'escolher_item:%';
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_auto_estado_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_auto_estado_check
  check (auto_estado is null or auto_estado in ('aguardando_bairro', 'aguardando_numero', 'pedir_link'));
alter table public.whatsapp_conversas drop column if exists ia_bump_em;
-- E na função whatsapp_auto_aplicar_v2 volte a checagem de p_estado para a lista antiga:
--   if p_estado is not null and p_estado not in ('aguardando_bairro', 'aguardando_numero', 'pedir_link') then raise exception 'estado_invalido'; end if;
-- (pg_get_functiondef + troca da linha, como em .medidas/aplicar-0193b.cjs, ao contrário.)
