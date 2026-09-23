-- ============================================================================
-- 0091 — Impressão: espera crescente entre tentativas
--
-- Na 0090, o Assistente consultando a cada 3 s esgotava as 5 tentativas em ~15 s
-- (impressora desconectada do Windows por um instante, por exemplo). Agora, depois de
-- cada falha, o trabalho volta a `pendente` com uma espera: 10 s, 20 s, 30 s, 40 s
-- (~100 s no total) antes de virar `falhou`. O vencimento da pré-conta (10 min) segue
-- valendo por cima de tudo.
--
-- A espera usa `reservado_ate` num trabalho `pendente` como "não antes de". Nada de
-- coluna nova, nada de dado convertido.
-- ============================================================================

create or replace function public.impressao_trabalhos_reservar(p_agente uuid, p_limite int)
returns table (id uuid, tipo text, via int, snapshot jsonb, nome_sistema text, largura_mm int, dispositivo_id uuid,
               segundos_restantes int, tentativas int)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.impressao_trabalhos t set estado = 'expirado', reservado_ate = null
   where t.agente_id = p_agente and t.estado in ('pendente', 'reservado') and t.expira_em <= now();
  update public.impressao_trabalhos t set estado = 'falhou', erro = coalesce(t.erro, 'sem confirmação do Assistente após 5 tentativas')
   where t.agente_id = p_agente and t.estado = 'reservado' and t.reservado_ate < now() and t.tentativas >= 5;

  return query
  with alvo as (
    select t.id from public.impressao_trabalhos t
      join public.impressao_agentes a on a.id = t.agente_id and a.revogado_em is null
     where t.agente_id = p_agente
       and t.estado in ('pendente', 'reservado')
       and (t.reservado_ate is null or t.reservado_ate < now())
       and t.tentativas < 5 and t.expira_em > now()
     order by t.criado_em
     for update of t skip locked
     limit greatest(1, least(coalesce(p_limite, 10), 20))
  ),
  upd as (
    update public.impressao_trabalhos t
       set estado = 'reservado', tentativas = t.tentativas + 1, reservado_ate = now() + interval '60 seconds'
      from alvo where t.id = alvo.id
    returning t.id, t.tipo, t.via, t.snapshot, t.dispositivo_id, t.expira_em, t.tentativas, t.criado_em
  )
  select u.id, u.tipo, u.via, u.snapshot, dsp.nome_sistema, dsp.largura_mm, u.dispositivo_id,
         greatest(0, extract(epoch from (u.expira_em - now()))::int), u.tentativas
    from upd u join public.impressao_dispositivos dsp on dsp.id = u.dispositivo_id
   order by u.criado_em;
end $$;

create or replace function public.impressao_trabalho_resultado(p_agente uuid, p_trabalho uuid, p_ok boolean, p_erro text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_estado text;
begin
  select * into t from public.impressao_trabalhos where id = p_trabalho and agente_id = p_agente for update;
  if t.id is null then raise exception 'trabalho_inexistente'; end if;

  if t.estado in ('enviado_spooler', 'falhou', 'cancelado') then
    return jsonb_build_object('id', t.id, 'estado', t.estado, 'ignorado', true);
  end if;

  if p_ok then
    update public.impressao_trabalhos set estado = 'enviado_spooler', enviado_em = now(), erro = null, reservado_ate = null where id = t.id;
    update public.impressao_dispositivos set ultimo_uso_em = now(), disponivel = true where id = t.dispositivo_id;
    v_estado := 'enviado_spooler';
  else
    v_estado := case when t.estado = 'expirado' then 'expirado' when t.tentativas >= 5 then 'falhou' else 'pendente' end;
    update public.impressao_trabalhos
       set estado = v_estado,
           erro = left(coalesce(nullif(btrim(p_erro), ''), 'erro sem descrição'), 300),
           -- "não antes de": 10 s × número de tentativas já feitas.
           reservado_ate = case when v_estado = 'pendente' then now() + make_interval(secs => 10 * t.tentativas) else null end
     where id = t.id;
    update public.impressao_dispositivos
       set ultimo_erro = left(coalesce(nullif(btrim(p_erro), ''), 'erro sem descrição'), 300), ultimo_erro_em = now()
     where id = t.dispositivo_id;
  end if;
  return jsonb_build_object('id', t.id, 'estado', v_estado, 'ignorado', false);
end $$;

revoke execute on function public.impressao_trabalhos_reservar(uuid, int) from public, anon, authenticated;
revoke execute on function public.impressao_trabalho_resultado(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.impressao_trabalhos_reservar(uuid, int) to service_role;
grant execute on function public.impressao_trabalho_resultado(uuid, uuid, boolean, text) to service_role;
