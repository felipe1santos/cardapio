-- 0234 (29/10/2026): sinal de vida do Assistente gravado no máximo a cada 10 s.
-- Antes: cada chamada do Assistente (~7 por minuto por computador) fazia UPDATE em impressao_agentes.visto_em.
-- Agora: lê a linha e só grava visto_em quando ele é nulo, tem mais de 10 s, ou a versão mudou.
-- "Online" no painel = sinal com menos de 30 s (ONLINE_SEGUNDOS / ONLINE_MS), então 10 s de atraso é seguro.
-- O programa do Assistente não muda. Definição anterior (produção) guardada em 0234_agente_visto_em_10s_volta.sql.
-- Sem alteração de grants: create or replace mantém os existentes (service_role apenas).

create or replace function public.impressao_agente_autenticar(p_credencial_hash text, p_versao text)
returns table (agente_id uuid, restaurante_id uuid, nome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid; v_loja uuid; v_nome text; v_versao text; v_auto timestamptz; v_visto timestamptz;
begin
  -- Só lê; o UPDATE de visto_em fica condicionado (um UPDATE sem mudança também reescreve a linha).
  select a.id, a.restaurante_id, a.nome, a.versao, a.envio_auto_em, a.visto_em
    into v_id, v_loja, v_nome, v_versao, v_auto, v_visto
    from public.impressao_agentes a
   where a.credencial_hash = p_credencial_hash and a.revogado_em is null;
  if v_id is null then return; end if;

  if v_visto is null
     or v_visto < now() - interval '10 seconds'
     or coalesce(left(p_versao, 20), v_versao) is distinct from v_versao then
    update public.impressao_agentes ag
       set visto_em = now(), versao = coalesce(left(p_versao, 20), ag.versao)
     where ag.id = v_id
    returning ag.versao into v_versao;
  end if;

  if v_auto is null and public.impressao_versao_tem_auto(v_versao) then
    -- Colunas com alias: agente_id/restaurante_id/nome também são os nomes da saída da função.
    update public.impressao_agentes ag set envio_auto_em = now() where ag.id = v_id and ag.envio_auto_em is null;
    if found then
      update public.impressao_dispositivos d set envio = 'auto' where d.agente_id = v_id and d.envio = 'driver';
    end if;
  end if;

  agente_id := v_id; restaurante_id := v_loja; nome := v_nome;
  return next;
end $$;
