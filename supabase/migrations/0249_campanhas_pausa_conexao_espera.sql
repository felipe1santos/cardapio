-- 0249 — Pausa por conexão com espera crescente e limite (04/11/2026).
-- Problema: sessão "zumbi" da Evolution (estado "open", mas o envio falha com "Connection Closed"). A campanha pausava,
-- no minuto seguinte o cron via "aberto" e retomava, o envio falhava de novo… sem fim e sem gastar tentativa
-- (1 chamada à Evolution a cada 1–2,5 min por loja, até a rodada expirar). Regra geral nº 1 (CORRECOES-DE-BUGS):
-- todo retry com espera crescente e limite.
-- Agora: cada pausa por conexão soma 1 em `pausas_conexao` e grava `retomar_apos` (5 min, 15 min, 1 h); o cron só
-- retoma depois disso (lib/mensageria/campanhas-envio.ts). Na 4ª pausa seguida o motivo vira 'whatsapp_instavel', que
-- não retoma sozinho (a loja reconecta e toca em Retomar). Um envio que sai zera a conta.
-- Aditiva. Rollback: docs/rollback/0249_campanhas_pausa_conexao_espera.down.sql

alter table public.campanhas
  add column if not exists pausas_conexao smallint not null default 0,
  add column if not exists retomar_apos timestamptz;

create or replace function public.campanha_concluir_envio(p_id uuid, p_resultado text, p_id_externo text, p_erro text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare e public.campanha_envios%rowtype; v_final text;
begin
  select * into e from public.campanha_envios where id = p_id for update;
  if not found or e.status <> 'reservado' then return 'ignorado'; end if;

  if p_resultado = 'pausa' then
    -- WhatsApp da loja desconectado: nada saiu. Volta para a fila sem gastar tentativa.
    update public.campanha_envios set status = 'pendente', travado_ate = null, erro = left(p_erro, 300),
           tentativas = greatest(e.tentativas - 1, 0), proxima_tentativa_em = null
     where id = p_id;
    -- 0249: conta a pausa e espera cada vez mais antes de retomar; na 4ª seguida, só a loja retoma.
    update public.campanhas c set status = 'pausada', pausada_em = coalesce(c.pausada_em, now()),
           pausas_conexao = c.pausas_conexao + 1,
           pausa_motivo = case when c.pausas_conexao + 1 >= 4 then 'whatsapp_instavel' else 'whatsapp_desconectado' end,
           retomar_apos = now() + case c.pausas_conexao + 1 when 1 then interval '5 minutes' when 2 then interval '15 minutes' else interval '60 minutes' end,
           atualizado_em = now()
     where c.id = e.campanha_id and c.status in ('agendada', 'enviando');
    return 'pausa';
  elsif p_resultado = 'enviado' then
    update public.campanha_envios set status = 'enviado', enviado_em = now(), id_externo = left(p_id_externo, 200),
           erro = null, travado_ate = null where id = p_id;
    update public.campanhas set total_enviados = total_enviados + 1, pausas_conexao = 0, retomar_apos = null, atualizado_em = now()
     where id = e.campanha_id;
    v_final := 'enviado';
  elsif p_resultado = 'transitorio' and e.tentativas < 3 then
    update public.campanha_envios set status = 'pendente', travado_ate = null, erro = left(p_erro, 300),
           proxima_tentativa_em = now() + (case e.tentativas when 1 then interval '1 minute' else interval '5 minutes' end)
     where id = p_id;
    v_final := 'nova_tentativa';
  elsif p_resultado = 'incerto' then
    update public.campanha_envios set status = 'incerto', travado_ate = null, erro = left(p_erro, 300) where id = p_id;
    v_final := 'incerto';
  else
    update public.campanha_envios set status = 'erro', travado_ate = null, erro = left(p_erro, 300) where id = p_id;
    update public.campanhas set total_erros = total_erros + 1, atualizado_em = now() where id = e.campanha_id;
    v_final := 'erro';
  end if;

  update public.campanhas c set status = 'concluida', atualizado_em = now()
   where c.id = e.campanha_id and c.status in ('agendada', 'enviando')
     and not exists (select 1 from public.campanha_envios x where x.campanha_id = c.id and x.status in ('pendente', 'reservado'));
  return v_final;
end $$;
revoke execute on function public.campanha_concluir_envio(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.campanha_concluir_envio(uuid, text, text, text) to service_role;
