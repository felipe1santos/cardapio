-- Rollback da 0100. Antes de rodar: volte o código para a versão anterior e confirme que
-- nenhuma loja está em "cozinha_caixa" (se estiver, a cozinha volta ao Assistente antigo
-- pelo passo abaixo). Não apaga pedido, trabalho de impressão nem auditoria.
update public.restaurantes set impressao_cozinha_por_funcao = false where impressao_beta_modo = 'cozinha_caixa';
drop function if exists public.impressao_calibracao_criar(uuid, uuid, text, uuid, text);
drop function if exists public.impressao_modo_definir(uuid, text, uuid, text);
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_deslocamento_pontos_check;
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_largura_pontos_check;
alter table public.impressao_dispositivos drop column if exists calibrado_por_nome;
alter table public.impressao_dispositivos drop column if exists calibrado_em;
alter table public.impressao_dispositivos drop column if exists diagnostico;
alter table public.impressao_dispositivos drop column if exists deslocamento_pontos;
alter table public.impressao_dispositivos drop column if exists largura_pontos;
alter table public.restaurantes drop constraint if exists restaurantes_impressao_beta_modo_check;
alter table public.restaurantes drop column if exists impressao_cozinha_transferida_em;
alter table public.restaurantes drop column if exists impressao_beta_modo;
alter table public.restaurantes drop column if exists impressao_beta_liberado;
