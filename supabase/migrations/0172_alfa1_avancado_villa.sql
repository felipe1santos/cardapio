-- 0172 — Assistente "Alfa 1" (09/10): Avançado da impressão, "Saiu certinho?" e loja fora da atualização automática.
--   · impressao_dispositivos.envio passa a nascer 'auto' (direto, com o Windows de reserva automática); as linhas que
--     já existem NÃO mudam (o suporte decide loja a loja). 'driver' continua sendo o ajuste interno "forçar Windows".
--   · impressao_dispositivos.teste_resposta / teste_respondido_em / teste_respondido_por_nome: resposta ao
--     "Saiu certinho?" depois do primeiro "Imprimir teste" ('ok' | 'nao_saiu').
--   · impressao_agentes.visto_ip: último IP de onde o computador buscou pedidos (gravado pelo servidor, no máximo
--     a cada 10 min por computador).
--   · restaurantes.impressao_sem_atualizacao: a loja NÃO recebe a atualização automática do Assistente (o
--     latest.yml responde 404 para os IPs dos computadores dela). Villa Lanches = true (ordem do dono, 09/10).
-- Rollback: docs/rollback/0172_alfa1_avancado_villa.down.sql
alter table public.impressao_dispositivos alter column envio set default 'auto';
alter table public.impressao_dispositivos add column if not exists teste_resposta text;
alter table public.impressao_dispositivos add column if not exists teste_respondido_em timestamptz;
alter table public.impressao_dispositivos add column if not exists teste_respondido_por_nome text;
do $$ begin
  alter table public.impressao_dispositivos add constraint impressao_dispositivos_teste_resposta_check
    check (teste_resposta is null or teste_resposta in ('ok', 'nao_saiu'));
exception when duplicate_object then null; end $$;

alter table public.impressao_agentes add column if not exists visto_ip text;
do $$ begin
  alter table public.impressao_agentes add constraint impressao_agentes_visto_ip_check
    check (visto_ip is null or length(visto_ip) <= 64);
exception when duplicate_object then null; end $$;

alter table public.restaurantes add column if not exists impressao_sem_atualizacao boolean not null default false;
update public.restaurantes set impressao_sem_atualizacao = true where slug = 'villa-lanches';
