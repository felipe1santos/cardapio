-- Rollback da 0175: volta para a trava só por IP da loja (0172 continua valendo).
drop trigger if exists impressao_agente_ip_registrar on public.impressao_agentes;
drop function if exists public.impressao_agente_ip_registrar();
drop table if exists public.impressao_agente_ips;
alter table public.impressao_agentes drop column if exists sem_atualizacao;
