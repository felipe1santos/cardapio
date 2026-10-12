-- 0191 — Origem "Notificação do app" (push) nos pedidos (12/10/2026). Aditiva: só aceita mais um valor; pedidos antigos não mudam.
alter table public.pedidos drop constraint if exists pedidos_origem_canal_check;
alter table public.pedidos add constraint pedidos_origem_canal_check
  check (origem_canal is null or origem_canal in ('direto', 'instagram', 'facebook', 'meta', 'google_anuncio', 'google_busca', 'whatsapp', 'qrcode', 'outros', 'whatsapp_ia', 'push'));
