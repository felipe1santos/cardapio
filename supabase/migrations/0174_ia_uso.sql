-- 0174 — Contador da IA de atendimento (ChatGPT/OpenAI) — 10/10/2026, docs/REGRAS-DE-CUSTO.md
--
-- A guarda (api_uso_contar, 0173) já conta as CHAMADAS de api='ia' e trava no limite diário. O custo da IA só é
-- conhecido depois da resposta (tokens de entrada e saída), então fica nesta tabela própria:
--   · ia_uso_dia: por dia (São Paulo), escopo ('total' ou id da loja) e modelo — chamadas, tokens e custo em
--     micro-dólares (US$ 1 = 1.000.000), para o Super Admin saber quanto o sistema e cada loja gastam;
--   · ia_uso_registrar(): soma de forma ATÔMICA no total e na loja (upsert).
-- Só o servidor (service_role) lê e grava. Nada é apagado nem convertido; tabela nova.

create table if not exists public.ia_uso_dia (
  dia date not null,
  escopo text not null,
  modelo text not null,
  chamadas integer not null default 0,
  tokens_entrada bigint not null default 0,
  tokens_saida bigint not null default 0,
  custo_micro_usd bigint not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (dia, escopo, modelo)
);
alter table public.ia_uso_dia enable row level security;
revoke all on public.ia_uso_dia from anon, authenticated;

create or replace function public.ia_uso_registrar(p_loja uuid, p_modelo text, p_tokens_entrada bigint, p_tokens_saida bigint, p_custo_micro_usd bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
  v_escopo text;
begin
  foreach v_escopo in array (case when p_loja is null then array['total'] else array['total', p_loja::text] end) loop
    insert into public.ia_uso_dia (dia, escopo, modelo, chamadas, tokens_entrada, tokens_saida, custo_micro_usd)
    values (v_dia, v_escopo, coalesce(nullif(p_modelo, ''), 'desconhecido'), 1, greatest(coalesce(p_tokens_entrada, 0), 0),
            greatest(coalesce(p_tokens_saida, 0), 0), greatest(coalesce(p_custo_micro_usd, 0), 0))
    on conflict (dia, escopo, modelo) do update
      set chamadas = public.ia_uso_dia.chamadas + 1,
          tokens_entrada = public.ia_uso_dia.tokens_entrada + excluded.tokens_entrada,
          tokens_saida = public.ia_uso_dia.tokens_saida + excluded.tokens_saida,
          custo_micro_usd = public.ia_uso_dia.custo_micro_usd + excluded.custo_micro_usd,
          atualizado_em = now();
  end loop;
end $$;
revoke execute on function public.ia_uso_registrar(uuid, text, bigint, bigint, bigint) from public, anon, authenticated;
