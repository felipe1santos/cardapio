-- Desfaz a 0154. ATENÇÃO: aplicar só depois de tirar instagram_url do select da vitrine
-- (lib/queries/cardapio.ts › buscarRestaurantePorSlug), senão a vitrine quebra.
revoke select (instagram_url) on public.restaurantes from anon;
