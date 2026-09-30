-- Rollback da 0115: o turno volta a abrir só pela Logística. Turnos já abertos ficam.
drop trigger if exists caixa_turno_abre_na_entrega on public.pedidos;
drop function if exists public.caixa_turno_abre_na_entrega();
