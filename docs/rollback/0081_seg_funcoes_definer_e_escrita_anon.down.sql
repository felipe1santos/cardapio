-- Rollback da 0081 — só se alguma chamada legítima com chave anon/authenticated
-- aparecer (nenhuma conhecida em 2026-09-23). Reabre o oráculo de token de impressão.
grant execute on function public.restaurante_id_por_agente_token(text) to public, anon, authenticated;
grant execute on function public.campanha_incrementar_enviados(uuid) to public, anon, authenticated;
grant execute on function public.campanha_incrementar_erros(uuid) to public, anon, authenticated;
-- Escrita anônima: devolver só na tabela que precisar, nunca em massa.
-- grant insert on public.<tabela> to anon;
