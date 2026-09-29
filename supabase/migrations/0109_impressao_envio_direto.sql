-- 0109 — Impressão: intensidade, envio direto (ESC/POS) e modo texto, por IMPRESSORA.
--
-- Problema (POS-8370, 2026-09-29): o Assistente Beta entrega a imagem ao DRIVER do
-- Windows, e é o driver quem decide a largura (driver de 58 mm corta a comanda em 2/3) e
-- como o cinza vira ponto (texto fino "apagado"). Agora cada impressora pode:
--   intensidade     normal (= hoje) | escura | mais_escura
--   envio           driver (= hoje) | raw_fila (ESC/POS pela fila USB, tipo RAW) | raw_rede (IP:porta)
--   modo_impressao  imagem (= hoje) | texto (comandos ESC/POS nativos; sempre por envio direto)
--   rede_ip/porta   para raw_rede (porta padrão 9100)
-- Padrões = comportamento atual: quem já imprime bem não muda nada.
-- Numeração: a 0108 (fotos de contato do WhatsApp) está em outra branch; as duas são
-- independentes e podem ser aplicadas em qualquer ordem.
-- Rollback: docs/rollback/0109_impressao_envio_direto.down.sql (voltar o código antes).

alter table public.impressao_dispositivos
  add column if not exists intensidade text not null default 'normal',
  add column if not exists envio text not null default 'driver',
  add column if not exists modo_impressao text not null default 'imagem',
  add column if not exists rede_ip text,
  add column if not exists rede_porta int not null default 9100;

alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_intensidade_check;
alter table public.impressao_dispositivos add constraint impressao_dispositivos_intensidade_check
  check (intensidade in ('normal', 'escura', 'mais_escura'));
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_envio_check;
alter table public.impressao_dispositivos add constraint impressao_dispositivos_envio_check
  check (envio in ('driver', 'raw_fila', 'raw_rede'));
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_modo_impressao_check;
alter table public.impressao_dispositivos add constraint impressao_dispositivos_modo_impressao_check
  check (modo_impressao in ('imagem', 'texto'));
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_rede_ip_check;
alter table public.impressao_dispositivos add constraint impressao_dispositivos_rede_ip_check
  check (rede_ip is null or rede_ip ~ '^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$');
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_rede_porta_check;
alter table public.impressao_dispositivos add constraint impressao_dispositivos_rede_porta_check
  check (rede_porta between 1 and 65535);
-- Envio pela rede sem IP não tem para onde ir.
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_rede_com_ip_check;
alter table public.impressao_dispositivos add constraint impressao_dispositivos_rede_com_ip_check
  check (envio <> 'raw_rede' or rede_ip is not null);
