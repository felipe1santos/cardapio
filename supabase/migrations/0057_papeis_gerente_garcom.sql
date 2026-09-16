-- Papéis novos do módulo Mesas e Comandas.
--
-- SOZINHA NO ARQUIVO de propósito: o runner (scripts/setup-db.mjs) roda cada migration
-- dentro de begin/commit, e o Postgres não deixa USAR um valor de enum na mesma
-- transação em que ele foi adicionado. Qualquer migration que referencie 'gerente' ou
-- 'garcom' precisa vir depois desta.
--
-- Aditivo: nenhuma linha muda de papel. Os 7 usuários existentes seguem 'dono'.

alter type papel_usuario add value if not exists 'gerente';
alter type papel_usuario add value if not exists 'garcom';
