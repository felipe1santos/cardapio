-- Rollback da 0246: imagens volta a ser lista de texto; a função de rodada volta à da 0245 (reaplicar o arquivo
-- 0245_disparos_recorrentes.sql depois de este rollback, só a função gerar_rodadas e a trigger de agenda).
update public.campanha_recorrentes
   set imagens = coalesce((select jsonb_agg(t.x ->> 'url' order by t.ord) from jsonb_array_elements(imagens) with ordinality as t(x, ord)), '[]'::jsonb)
 where jsonb_array_length(imagens) > 0;
