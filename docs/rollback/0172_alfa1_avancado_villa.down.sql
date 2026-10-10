-- Desfaz a 0172 (as respostas do "Saiu certinho?" e os IPs gravados se perdem).
alter table public.restaurantes drop column if exists impressao_sem_atualizacao;
alter table public.impressao_agentes drop constraint if exists impressao_agentes_visto_ip_check;
alter table public.impressao_agentes drop column if exists visto_ip;
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_teste_resposta_check;
alter table public.impressao_dispositivos drop column if exists teste_respondido_por_nome;
alter table public.impressao_dispositivos drop column if exists teste_respondido_em;
alter table public.impressao_dispositivos drop column if exists teste_resposta;
alter table public.impressao_dispositivos alter column envio set default 'driver';
