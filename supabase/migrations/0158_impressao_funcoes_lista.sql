-- 0158 — Impressão: tela nova (protótipo v2, 2026-10-07).
--   · função 'entrega' (Comanda de entrega): uma via a mais da comanda dos pedidos de ENTREGA,
--     na impressora escolhida (Assistente 0.2.0-beta.10+; versões anteriores ignoram);
--   · impressao_dispositivos.na_lista: a impressora foi ADICIONADA pela loja na tela (o Assistente
--     descobre todas as do Windows; só as adicionadas aparecem na lista). Removê-la da lista tira
--     as funções dela. Já ficam na lista as que têm função ou apelido (a tela de hoje mostra essas).
-- Aditiva: nenhuma impressão muda. Rollback: docs/rollback/0158_impressao_funcoes_lista.down.sql

alter table public.impressao_funcoes drop constraint if exists impressao_funcoes_funcao_check;
alter table public.impressao_funcoes add constraint impressao_funcoes_funcao_check
  check (funcao in ('cozinha', 'caixa', 'entrega'));

alter table public.impressao_dispositivos add column if not exists na_lista boolean not null default false;

update public.impressao_dispositivos d set na_lista = true
where not d.na_lista
  and (d.apelido is not null or exists (select 1 from public.impressao_funcoes f where f.dispositivo_id = d.id));
