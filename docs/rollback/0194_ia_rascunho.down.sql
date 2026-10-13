-- Desfaz a 0194 (o código antigo não lê a coluna).
alter table public.whatsapp_conversas drop column if exists ia_rascunho;
