-- 0194 (12/10/2026): pedido EM ANDAMENTO do Agente de IA no WhatsApp. O servidor guarda o que o cliente já escolheu e
-- pergunta o que falta, uma coisa por vez (lib/agente-ia/rascunho.ts). Só a coluna; nada muda para linhas existentes.
alter table public.whatsapp_conversas add column if not exists ia_rascunho jsonb;
comment on column public.whatsapp_conversas.ia_rascunho is 'Agente de IA: pedido em andamento (itens/escolhas por grupo, tipo, endereço, pagamento). Limpo quando o pedido é criado.';
