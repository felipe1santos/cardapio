-- 0149 — Origem do pedido (item 55, 2026-10-05).
--
-- A vitrine já gravava a origem crua das VISITAS (vitrine_eventos.origem: utm_source ou domínio). Agora a
-- origem ATRIBUÍDA chega ao PEDIDO: canal (Direto, Instagram, Facebook, Meta, Google Anúncio, Google
-- Busca, WhatsApp — inclui as Campanhas —, QR Code, Outros) + o detalhe cru (fonte, meio, campanha, clique).
-- Regra de atribuição (lib/origem-visita.ts): a última origem não-direta do aparelho nos últimos 7 dias.
--
-- Aditiva: pedidos antigos e os do PDV/balcão/mesa ficam com origem_canal NULO (o card mostra o canal do
-- pedido, como sempre). Só análise — nada de dinheiro depende disto.
alter table public.pedidos add column if not exists origem_canal text;
alter table public.pedidos add column if not exists origem_detalhe jsonb;
alter table public.pedidos drop constraint if exists pedidos_origem_canal_check;
alter table public.pedidos add constraint pedidos_origem_canal_check check (
  origem_canal is null or origem_canal in ('direto', 'instagram', 'facebook', 'meta', 'google_anuncio', 'google_busca', 'whatsapp', 'qrcode', 'outros')
);
create index if not exists pedidos_origem_canal on public.pedidos (restaurante_id, origem_canal) where origem_canal is not null;
