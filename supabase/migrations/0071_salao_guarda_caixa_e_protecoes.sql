-- 0071 — Guarda do módulo, caixa no salão, regras por papel e proteções de coluna.
--
-- O que a auditoria da release candidate achou e esta migration fecha:
--
-- 1. A feature flag só escondia o MENU. `/admin/mesas` e `/api/admin/mesas/*` rodavam
--    com ela desligada. `auth_modulo_mesas()` dá ao middleware e às rotas uma pergunta
--    única e barata: "o módulo está ligado na MINHA loja?".
-- 2. O atendente/caixa não enxergava o salão. Pagamento, divisão e fechamento são
--    trabalho de caixa, então ele passa a LER mesas, contas, lançamentos e pagamentos
--    de mesa. Escrever continua só pelas rotas (service_role).
-- 3. Regras por papel configuráveis por loja: se o garçom recebe pagamento, se o garçom
--    transfere, se o caixa dá desconto. Os defaults seguem a matriz oficial (garçom
--    lança e serve, caixa recebe, gestão dá desconto).
-- 4. `restaurantes` aceitava UPDATE do navegador em TODAS as colunas para dono, gerente
--    e atendente. O atendente ligava o módulo ou mudava a taxa de serviço pelo console.
--    Um trigger recusa mudança nas colunas do salão quando quem escreve é o JWT do
--    usuário; as rotas (service_role) continuam podendo.
-- 5. O token do QR saía para qualquer papel que lê `mesas` (o garçom incluso) e podia
--    ser ESCOLHIDO por quem insere/atualiza a mesa pelo PostgREST. Grant por coluna:
--    o navegador não lê nem escreve `token`; o QR sai por rota com `mesas.gerenciar`.
-- 6. Revogar o QR sem emitir outro (mesa sem adesivo, QR vazado antes de reimprimir).
-- 7. Excluir mesa apagava em cascata a comanda sem pedido, e desativar pela tela antiga
--    de Ajustes ignorava conta aberta. Triggers fecham os dois caminhos, venha a escrita
--    de onde vier.
-- 8. Auditoria ganha o PAPEL do ator (no momento do evento) e um identificador de
--    correlação que liga os eventos de uma mesma requisição.
--
-- Tudo idempotente. Nenhuma linha existente muda de valor.

-- ═══ 1. o módulo está ligado na minha loja? ══════════════════════════════════
create or replace function public.auth_modulo_mesas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select r.modulo_mesas_ativo from public.restaurantes r where r.id = public.auth_restaurante_id()),
    false
  )
$$;

revoke execute on function public.auth_modulo_mesas() from public, anon;
grant execute on function public.auth_modulo_mesas() to authenticated;

-- ═══ 3. regras do salão por loja ═════════════════════════════════════════════
alter table public.restaurantes add column if not exists salao_garcom_recebe boolean not null default false;
alter table public.restaurantes add column if not exists salao_garcom_transfere boolean not null default true;
alter table public.restaurantes add column if not exists salao_caixa_desconto boolean not null default false;

comment on column public.restaurantes.salao_garcom_recebe is
  'Garçom registra pagamento e fecha a conta da mesa. Padrão: não (é trabalho do caixa).';
comment on column public.restaurantes.salao_garcom_transfere is
  'Garçom transfere mesa e itens entre mesas. Padrão: sim.';
comment on column public.restaurantes.salao_caixa_desconto is
  'Atendente/caixa ajusta taxa de serviço e desconto. Padrão: não (fica com a gestão).';

-- ═══ 4. colunas do salão só mudam pelo servidor ══════════════════════════════
create or replace function public.restaurantes_protege_salao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Só o JWT de usuário é barrado. service_role (rotas) e conexão direta (migrations,
  -- scripts de operação) passam.
  if coalesce(auth.role(), '') in ('authenticated', 'anon') and (
       new.modulo_mesas_ativo is distinct from old.modulo_mesas_ativo
    or new.taxa_servico_padrao is distinct from old.taxa_servico_padrao
    or new.formas_pagamento_mesa is distinct from old.formas_pagamento_mesa
    or new.salao_garcom_recebe is distinct from old.salao_garcom_recebe
    or new.salao_garcom_transfere is distinct from old.salao_garcom_transfere
    or new.salao_caixa_desconto is distinct from old.salao_caixa_desconto
  ) then
    raise exception 'coluna_protegida' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists restaurantes_protege_salao on public.restaurantes;
create trigger restaurantes_protege_salao
  before update on public.restaurantes
  for each row execute function public.restaurantes_protege_salao();

-- ═══ 2. o caixa lê o salão ═══════════════════════════════════════════════════
drop policy if exists mesas_select on public.mesas;
create policy mesas_select on public.mesas
  for select to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and public.auth_papel() in ('dono', 'gerente', 'garcom', 'atendente')
  );

drop policy if exists comandas_select on public.comandas;
create policy comandas_select on public.comandas
  for select to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and public.auth_papel() in ('dono', 'gerente', 'garcom', 'atendente')
  );

drop policy if exists pagamentos_select on public.pagamentos_comanda;
create policy pagamentos_select on public.pagamentos_comanda
  for select to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and public.auth_papel() in ('dono', 'gerente', 'garcom', 'atendente')
  );

-- Leitura de pedido de mesa: o caixa consulta o que a mesa consumiu. Escrita segue
-- como na 0061 (o atendente NÃO avança pedido de mesa).
drop policy if exists pedidos_select on public.pedidos;
create policy pedidos_select on public.pedidos
  for select to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and case canal
          when 'mesa'     then public.auth_papel() in ('dono', 'gerente', 'garcom', 'cozinha', 'atendente')
          when 'delivery' then public.auth_papel() in ('dono', 'gerente', 'atendente', 'logistica')
          when 'balcao'   then public.auth_papel() in ('dono', 'gerente', 'atendente')
          else false
        end
  );

drop policy if exists pedido_itens_select on public.pedido_itens;
create policy pedido_itens_select on public.pedido_itens
  for select to authenticated
  using (
    exists (
      select 1 from public.pedidos p
       where p.id = pedido_itens.pedido_id
         and p.restaurante_id = public.auth_restaurante_id()
         and case p.canal
               when 'mesa'     then public.auth_papel() in ('dono', 'gerente', 'garcom', 'cozinha', 'atendente')
               when 'delivery' then public.auth_papel() in ('dono', 'gerente', 'atendente', 'logistica')
               when 'balcao'   then public.auth_papel() in ('dono', 'gerente', 'atendente')
               else false
             end
    )
  );

-- ═══ 5 e 6. o token do QR não passa pelo navegador ═══════════════════════════
alter table public.mesas add column if not exists qr_revogado_em timestamptz;

comment on column public.mesas.qr_revogado_em is
  'QR revogado sem substituto: o link para de funcionar até a gestão gerar um novo.';

-- Grant por coluna. Com grant de TABELA o revoke de coluna não teria efeito, então a
-- tabela sai e as colunas voltam uma a uma — todas menos `token`.
revoke select, insert, update on public.mesas from authenticated;
grant select (
  id, restaurante_id, nome, ordem, ativa, criado_em, setor, capacidade,
  bloqueada_em, token_gerado_em, qr_revogado_em
) on public.mesas to authenticated;
-- Cadastro e edição pela tela: nunca token, bloqueio ou revogação (esses passam pela
-- rota de estado, que confere conta aberta e audita).
grant insert (restaurante_id, nome, ordem, ativa, setor, capacidade) on public.mesas to authenticated;
grant update (nome, ordem, ativa, setor, capacidade) on public.mesas to authenticated;

-- ═══ 7. mesa com conta aberta não sai de operação; mesa com histórico não some ═══
create or replace function public.mesas_protege_operacao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- Comanda (aberta ou encerrada) é histórico financeiro. Mesa com histórico se
    -- arquiva com `ativa = false`.
    if exists (select 1 from public.comandas c where c.mesa_id = old.id) then
      raise exception 'mesa_com_historico' using errcode = '23503';
    end if;
    return old;
  end if;

  if (new.ativa = false and coalesce(old.ativa, true) = true)
     or (new.bloqueada_em is not null and old.bloqueada_em is null) then
    if exists (select 1 from public.comandas c where c.mesa_id = new.id and c.status = 'aberta') then
      raise exception 'comanda_aberta' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists mesas_protege_operacao on public.mesas;
create trigger mesas_protege_operacao
  before update or delete on public.mesas
  for each row execute function public.mesas_protege_operacao();

-- ═══ 8. auditoria com papel e correlação ═════════════════════════════════════
alter table public.eventos_auditoria add column if not exists papel text;
alter table public.eventos_auditoria add column if not exists correlacao uuid;

create index if not exists idx_auditoria_correlacao
  on public.eventos_auditoria (restaurante_id, correlacao) where correlacao is not null;

-- Preenche no banco, para os eventos gravados por função SQL (transferência, chamado,
-- cancelamento) ganharem o mesmo contexto dos gravados pela aplicação:
--   * papel: o do usuário NO MOMENTO do evento (se ele mudar de papel depois, a trilha
--     continua dizendo com que papel ele agiu);
--   * correlação: o cabeçalho `x-correlacao` que a rota manda ao PostgREST.
create or replace function public.eventos_auditoria_contexto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cab text;
begin
  if new.papel is null and new.usuario_id is not null then
    select u.papel::text into new.papel from public.usuarios u where u.id = new.usuario_id;
  end if;
  if new.correlacao is null then
    begin
      v_cab := nullif(current_setting('request.headers', true), '')::json ->> 'x-correlacao';
      if v_cab ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        new.correlacao := v_cab::uuid;
      end if;
    exception when others then
      -- Cabeçalho malformado nunca derruba a operação auditada.
      null;
    end;
  end if;
  return new;
end $$;

drop trigger if exists eventos_auditoria_contexto on public.eventos_auditoria;
create trigger eventos_auditoria_contexto
  before insert on public.eventos_auditoria
  for each row execute function public.eventos_auditoria_contexto();

revoke execute on function public.eventos_auditoria_contexto() from public, anon, authenticated;
revoke execute on function public.mesas_protege_operacao() from public, anon, authenticated;
revoke execute on function public.restaurantes_protege_salao() from public, anon, authenticated;
