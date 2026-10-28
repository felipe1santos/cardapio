-- 0230 — Teto diário POR LOJA nas APIs do Maps (28/10/2026, varredura Etapa 6 — docs/relatorios/2026-10-28-varredura.md).
-- Antes só havia o limite do sistema: uma loja em loop gastava a cota do dia de todas. Novo parâmetro `p_limite_loja`
-- (nulo = sem teto por loja, o comportamento de antes): a loja que já chegou nele é recusada ANTES de contar no total,
-- com `loja: true` na resposta. Mesma assinatura + 1 parâmetro com padrão: o código anterior continua funcionando.
-- Rollback: recriar a versão de 0173 (drop desta assinatura de 6 parâmetros e create da de 5).

drop function if exists public.api_uso_contar(text, uuid, integer, bigint, bigint);

create or replace function public.api_uso_contar(p_api text, p_loja uuid, p_limite integer, p_custo_centavos bigint default 0, p_limite_custo_centavos bigint default null, p_limite_loja integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
  v_chamadas integer;
  v_da_loja integer;
begin
  if p_loja is not null and p_limite_loja is not null then
    select chamadas into v_da_loja from public.api_uso_dia where api = p_api and escopo = p_loja::text and dia = v_dia;
    if coalesce(v_da_loja, 0) >= p_limite_loja then
      return jsonb_build_object('permitido', false, 'chamadas', v_da_loja, 'limite', p_limite_loja, 'loja', true);
    end if;
  end if;
  insert into public.api_uso_dia (api, escopo, dia) values (p_api, 'total', v_dia) on conflict do nothing;
  update public.api_uso_dia
     set chamadas = chamadas + 1, custo_centavos = custo_centavos + coalesce(p_custo_centavos, 0), atualizado_em = now()
   where api = p_api and escopo = 'total' and dia = v_dia
     and chamadas < p_limite
     and (p_limite_custo_centavos is null or custo_centavos + coalesce(p_custo_centavos, 0) <= p_limite_custo_centavos)
  returning chamadas into v_chamadas;
  if v_chamadas is null then
    return jsonb_build_object('permitido', false, 'chamadas', p_limite, 'limite', p_limite);
  end if;
  if p_loja is not null then
    insert into public.api_uso_dia (api, escopo, dia, chamadas, custo_centavos) values (p_api, p_loja::text, v_dia, 1, coalesce(p_custo_centavos, 0))
    on conflict (api, escopo, dia) do update
      set chamadas = public.api_uso_dia.chamadas + 1, custo_centavos = public.api_uso_dia.custo_centavos + coalesce(p_custo_centavos, 0), atualizado_em = now();
  end if;
  return jsonb_build_object('permitido', true, 'chamadas', v_chamadas, 'limite', p_limite);
end $$;
revoke execute on function public.api_uso_contar(text, uuid, integer, bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.api_uso_contar(text, uuid, integer, bigint, bigint, integer) to service_role;
