-- 0157 — Impressão: envio AUTOMÁTICO e o caminho que cada impressora usou (2026-10-07, noite 5).
--   envio = 'auto': o Assistente (0.2.0-beta.10+) tenta o envio direto ESC/POS — pela rede
--   (IP:9100) quando a impressora tem IP, senão pela fila USB (RAW) quando o driver é de
--   térmica — e, se falhar, imprime pelo driver do Windows. Versões até o beta.9 não conhecem
--   'auto' e imprimem pelo driver (o mesmo de sempre), então nada quebra.
--   envio_caminho / _em / _obs: o último caminho que a impressão realmente usou, informado
--   pelo Assistente (beta.10+) — aparece em Impressão › Avançado.
-- Aditiva: nenhuma impressora muda (o padrão continua 'driver').
-- Rollback: docs/rollback/0157_impressao_envio_automatico.down.sql

alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_envio_check;
alter table public.impressao_dispositivos add constraint impressao_dispositivos_envio_check
  check (envio in ('driver', 'raw_fila', 'raw_rede', 'auto'));

alter table public.impressao_dispositivos
  add column if not exists envio_caminho text,
  add column if not exists envio_caminho_em timestamptz,
  add column if not exists envio_caminho_obs text;

alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_envio_caminho_check;
alter table public.impressao_dispositivos add constraint impressao_dispositivos_envio_caminho_check
  check (envio_caminho is null or envio_caminho in ('driver', 'raw_fila', 'raw_rede'));
