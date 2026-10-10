-- 0168 — Toda mudança de "Imprimir sozinho" (restaurantes.impressao_automatica) vai para a auditoria, com quem e
-- quando (09/10: na Villa ficou desligado e ninguém sabia por quê). A tela salva direto pelo banco, então o
-- registro é um gatilho que só dispara quando ESSE campo muda. Nada mais muda na tabela.
-- Rollback: docs/rollback/0168_auditoria_imprimir_sozinho.down.sql
create or replace function public.auditar_imprimir_sozinho() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_nome text;
begin
  begin
    if v_uid is not null then select nome into v_nome from public.usuarios where id = v_uid; end if;
    perform public.auditoria_registrar(new.id, v_uid, coalesce(v_nome, 'Sistema'), 'impressao.imprimir_sozinho', 'restaurante', new.id,
      jsonb_build_object('de', old.impressao_automatica, 'para', new.impressao_automatica,
        'resumo', case when new.impressao_automatica then 'Imprimir sozinho LIGADO' else 'Imprimir sozinho DESLIGADO' end));
  exception when others then null; -- a auditoria nunca impede salvar a configuração
  end;
  return new;
end $$;
drop trigger if exists auditar_imprimir_sozinho on public.restaurantes;
create trigger auditar_imprimir_sozinho after update of impressao_automatica on public.restaurantes
  for each row when (old.impressao_automatica is distinct from new.impressao_automatica) execute function public.auditar_imprimir_sozinho();
