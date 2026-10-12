-- Rollback da 0191: pedidos com origem push voltam a "outros" e a lista volta à da 0183.
update public.pedidos set origem_canal = 'outros' where origem_canal = 'push';
alter table public.pedidos drop constraint if exists pedidos_origem_canal_check;
alter table public.pedidos add constraint pedidos_origem_canal_check
  check (origem_canal is null or origem_canal in ('direto', 'instagram', 'facebook', 'meta', 'google_anuncio', 'google_busca', 'whatsapp', 'qrcode', 'outros', 'whatsapp_ia'));
