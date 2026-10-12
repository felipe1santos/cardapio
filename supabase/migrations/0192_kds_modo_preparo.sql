-- 0192 — KDS (12/10/2026): "Modo de preparo" (texto curto) na ficha de preparo do item. Fica em fichas_preparo (tabela
-- privada: a vitrine pública nunca lê) e o KDS lê pelo servidor. Aditiva; nada muda para quem não preenche.
alter table public.fichas_preparo add column if not exists modo_preparo text check (modo_preparo is null or length(modo_preparo) <= 500);
