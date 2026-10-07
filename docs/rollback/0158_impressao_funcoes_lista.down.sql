-- Rollback da 0158. Antes: voltar o código (redeploy do commit anterior).
delete from public.impressao_funcoes where funcao = 'entrega';
alter table public.impressao_funcoes drop constraint if exists impressao_funcoes_funcao_check;
alter table public.impressao_funcoes add constraint impressao_funcoes_funcao_check
  check (funcao in ('cozinha', 'caixa'));
alter table public.impressao_dispositivos drop column if exists na_lista;
