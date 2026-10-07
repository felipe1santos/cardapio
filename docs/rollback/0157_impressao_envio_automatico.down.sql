-- Rollback da 0157. Antes: voltar o código (redeploy do commit anterior).
-- Impressora que ficou em 'auto' volta para o driver (o que as versões antigas já faziam com ela).
update public.impressao_dispositivos set envio = 'driver' where envio = 'auto';
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_envio_caminho_check;
alter table public.impressao_dispositivos
  drop column if exists envio_caminho,
  drop column if exists envio_caminho_em,
  drop column if exists envio_caminho_obs;
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_envio_check;
alter table public.impressao_dispositivos add constraint impressao_dispositivos_envio_check
  check (envio in ('driver', 'raw_fila', 'raw_rede'));
