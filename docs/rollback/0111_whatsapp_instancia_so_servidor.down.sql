-- Rollback da 0111. Volta a situação da 0080 (coluna gravável por authenticated).
-- ATENÇÃO: reabre a falha de tomada de instância entre lojas. Só use se a 0111 quebrar algo.
drop trigger if exists restaurantes_protege_instancia on public.restaurantes;
drop function if exists public.restaurantes_protege_instancia();
drop index if exists public.restaurantes_evolution_instance_uidx;
grant update (evolution_instance) on public.restaurantes to authenticated;
