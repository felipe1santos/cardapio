-- 0202 — Origem do pedido: apps integrados (19/10/2026, Bloco E do redesign do Kanban).
-- Só amplia a lista aceita em pedidos.origem_canal (0149/0183) com os apps de delivery que o card mostra com o
-- logo grande: iFood, Keeta, 99Food e aiqfome. Aditiva e inerte: nenhuma integração grava esses valores ainda —
-- hoje só pedidos de TESTE da Menuzia (criados à mão) usam 'ifood'.
alter table public.pedidos drop constraint if exists pedidos_origem_canal_check;
alter table public.pedidos add constraint pedidos_origem_canal_check
  check (origem_canal is null or origem_canal in ('direto', 'instagram', 'facebook', 'meta', 'google_anuncio', 'google_busca', 'whatsapp', 'qrcode', 'outros', 'whatsapp_ia', 'push',
    'ifood', 'keeta', '99food', 'aiqfome'));
