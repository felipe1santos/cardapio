-- Rollback da impressão com várias impressoras (0087–0091). Não apaga dado gravado.
--
-- 1. Desligar o que muda comportamento, loja por loja (preferível ao rollback de banco):
update public.restaurantes set impressao_cozinha_por_funcao = false where impressao_cozinha_por_funcao;
delete from public.impressao_funcoes;               -- sem funções: pré-conta indisponível, cozinha no modo de sempre
update public.impressao_trabalhos set estado = 'cancelado' where estado in ('pendente', 'reservado');

-- 2. Voltar a fila da cozinha ao comportamento da 0086 (reserva sempre) — só se o código
--    anterior for reposto. Com o código atual, NÃO remover (o B1 volta).
-- drop function public.impressao_elegiveis(uuid);

-- As tabelas impressao_agentes/_pareamentos/_dispositivos/_funcoes/_trabalhos ficam: são
-- histórico (quem imprimiu o quê, quando). Nada no código antigo as lê.
