-- 0076 — Cupom: consumo atômico do teto de usos e trava de uso único por cliente.
--
-- O QUE ESTAVA ERRADO
--
-- `criarPedido` validava o cupom, criava o pedido e só DEPOIS incrementava `usos` com um
-- compare-and-swap (`update ... where usos = <valor lido>`). Entre a leitura e a escrita
-- cabe outro pedido: os dois liam `usos = 0` num cupom de `max_usos = 1`, os dois passavam
-- na validação, e o segundo só descobria o problema quando o update devolvia 0 linhas —
-- momento em que o pedido já existia e o desconto já tinha sido dado. O próprio código
-- registrava isso no log e seguia em frente ("pedido mantido, descompasso logado").
--
-- O mesmo vale para `uso_unico_por_cliente`: a checagem era um SELECT anterior ao INSERT,
-- então dois pedidos simultâneos do mesmo telefone passavam juntos.
--
-- COMO FICA
--
-- Uma função que RESERVA o uso antes de o pedido nascer, em um único UPDATE condicional —
-- o mesmo desenho que `fidelidade_recompensas` já usa para o prêmio (claim-first), e que é
-- atômico porque o Postgres serializa o UPDATE da mesma linha. Quem perder a corrida
-- recebe `false` e o pedido é recusado com a mensagem de sempre, antes de existir.
--
-- E um índice ÚNICO em (cupom_id, cliente_telefone) para o uso único por cliente: a
-- checagem em SQL vira garantia do banco, que é onde ela não tem janela de corrida.
-- Substitui o índice não-único que já existia com as mesmas colunas.
--
-- Aditiva: não altera nem converte dado nenhum. Cupom sem `max_usos` continua ilimitado.

-- ═══ 1. índice único: um uso por cliente por cupom ══════════════════════════
-- Conferido antes de escrever esta migration: não há par (cupom_id, cliente_telefone)
-- repetido em produção, então a criação do índice não falha. Se algum ambiente tiver,
-- o índice não é criado e a migration para — de propósito: apagar uso de cupom já
-- concedido é decisão de quem opera a loja, não de uma migration.
drop index if exists idx_cupom_usos_cliente;
create unique index if not exists idx_cupom_usos_cliente
  on cupom_usos (cupom_id, cliente_telefone);

-- ═══ 2. reserva atômica de um uso ═══════════════════════════════════════════
/**
 * Reserva um uso do cupom. `true` = reservado (pode criar o pedido);
 * `false` = o teto acabou de estourar, ou o cupom não é desta loja / está inativo.
 *
 * `max_usos is null` = ilimitado: incrementa sempre, só para manter o contador honesto.
 *
 * Chamada com service_role pela rota de pedido. `security definer` não é necessário — quem
 * chama já passa por cima da RLS —, e mantê-la `invoker` evita criar um caminho novo de
 * escrita para quem tiver apenas o JWT do painel.
 */
create or replace function public.cupom_reservar_uso(
  p_cupom_id uuid,
  p_restaurante_id uuid
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update cupons
     set usos = usos + 1,
         atualizado_em = now()
   where id = p_cupom_id
     and restaurante_id = p_restaurante_id
     and ativo
     and (max_usos is null or usos < max_usos)
  returning true into v_ok;

  return coalesce(v_ok, false);
end $$;

comment on function public.cupom_reservar_uso(uuid, uuid) is
  'Reserva um uso do cupom em um UPDATE condicional. false = teto esgotado ou cupom indisponível.';

-- ═══ 3. devolve um uso reservado ════════════════════════════════════════════
/**
 * Desfaz a reserva quando o pedido não chega a nascer (erro no insert depois do claim).
 * Sem isto, uma falha no meio do caminho queimaria um uso do cupom para sempre.
 * Nunca deixa o contador negativo.
 */
create or replace function public.cupom_devolver_uso(
  p_cupom_id uuid,
  p_restaurante_id uuid
)
returns void
language sql
set search_path = public
as $$
  update cupons
     set usos = greatest(0, usos - 1),
         atualizado_em = now()
   where id = p_cupom_id
     and restaurante_id = p_restaurante_id;
$$;

comment on function public.cupom_devolver_uso(uuid, uuid) is
  'Devolve um uso reservado por cupom_reservar_uso quando o pedido não chega a ser criado.';

-- ═══ 4. teto zero não existe ════════════════════════════════════════════════
-- `max_usos = 0` passava no cadastro e matava o cupom no ato: `usos >= max_usos` é
-- verdadeiro desde o primeiro cliente, e a vitrine respondia "Este cupom atingiu o limite
-- de usos" para todo mundo, sem ninguém nunca ter usado. Vazio (null) é o jeito de dizer
-- "ilimitado"; zero nunca quis dizer nada.
alter table cupons drop constraint if exists cupons_max_usos_positivo;
alter table cupons add constraint cupons_max_usos_positivo
  check (max_usos is null or max_usos >= 1);
