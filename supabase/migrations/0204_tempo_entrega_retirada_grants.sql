-- 0204 — Permissões das colunas da 0203 (19/10/2026, hotfix).
-- restaurantes tem grant POR COLUNA para authenticated (0055/0056). A 0203 criou tempo_entrega/tempo_retirada sem
-- grant; o select do painel (CONFIG_SELECT em lib/queries/ajustes.ts) passou a responder "permission denied for table
-- restaurantes" e o Perfil/topo abriram vazios em todas as lojas. anon não precisa (vitrine não lê; robô/IA usam service_role).
grant select (tempo_entrega, tempo_retirada) on public.restaurantes to authenticated;
grant update (tempo_entrega, tempo_retirada) on public.restaurantes to authenticated;
