-- 0156 — Auditoria de abrir/fechar a loja (2026-10-07, noite 5).
-- Caso real: a Menuzia apareceu "fechada manualmente" e a auditoria não dizia quem fechou. O
-- status manual é gravado direto do navegador (Kanban), então a trilha nasce no banco: toda
-- mudança de restaurantes.status_loja vira um evento 'loja.status' com quem (usuário da sessão),
-- de→para e de onde (tela pelo Referer: kanban, ajustes, painel; aparelho; IP).
-- Abrir/fechar AUTOMÁTICO pela grade de horário não é gravação: a rotina /api/cron/loja-horario
-- registra 'loja.abriu_horario' / 'loja.fechou_horario'.
-- Nunca bloqueia a mudança (erro na auditoria é engolido). Aditiva: sem dado convertido.
-- Rollback: docs/rollback/0156_auditoria_abrir_fechar_loja.down.sql

create or replace function public.restaurantes_audita_status_loja()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cab json;
  v_ref text;
  v_ua text;
  v_ip text;
  v_origem text;
  v_uid uuid;
  v_nome text;
begin
  if new.status_loja is not distinct from old.status_loja then
    return new;
  end if;
  begin
    begin
      v_cab := nullif(current_setting('request.headers', true), '')::json;
    exception when others then v_cab := null;
    end;
    v_ref := coalesce(v_cab ->> 'referer', '');
    v_ua := coalesce(v_cab ->> 'user-agent', '');
    v_ip := nullif(split_part(coalesce(v_cab ->> 'x-forwarded-for', ''), ',', 1), '');
    v_origem := coalesce(
      nullif(v_cab ->> 'x-menuzia-origem', ''),
      case
        when v_ref ~ '/admin/pedidos' then 'kanban'
        when v_ref ~ '/admin/ajustes' then 'ajustes'
        when v_ref ~ '/admin' then 'painel'
        when v_cab is null then 'sistema'
        else 'outro'
      end
    );
    v_uid := auth.uid();
    if v_uid is not null then
      select u.nome into v_nome from public.usuarios u where u.id = v_uid;
    end if;
    insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
    values (
      new.id,
      case when v_uid is null then 'sistema' else 'usuario' end,
      v_uid,
      coalesce(v_nome, case when v_uid is null then 'Sistema' else 'Usuário' end),
      'loja.status',
      'restaurante',
      new.id,
      jsonb_build_object(
        'de', old.status_loja, 'para', new.status_loja, 'origem', v_origem,
        'aparelho', case when v_ua ~* '(mobi|android|iphone|ipad)' then 'celular' when v_ua = '' then null else 'computador' end,
        'ip', v_ip
      )
    );
  exception when others then
    -- A trilha nunca pode impedir a loja de abrir ou fechar.
    null;
  end;
  return new;
end $$;

drop trigger if exists restaurantes_audita_status_loja on public.restaurantes;
create trigger restaurantes_audita_status_loja
  after update of status_loja on public.restaurantes
  for each row execute function public.restaurantes_audita_status_loja();

revoke execute on function public.restaurantes_audita_status_loja() from public, anon, authenticated;
