-- Policies do salão, da equipe e da auditoria — allowlist em todas.

-- ── mesas ────────────────────────────────────────────────────────────────────
drop policy if exists mesas_tenant_rw on public.mesas;
drop policy if exists mesas_select on public.mesas;
drop policy if exists mesas_insert on public.mesas;
drop policy if exists mesas_update on public.mesas;

create policy mesas_select on public.mesas
  for select to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and public.auth_papel() in ('dono', 'gerente', 'garcom')
  );

-- Cadastrar mesa e mexer em QR/token é da gestão. Mesa com histórico se arquiva
-- (`ativa = false`), não se apaga: nenhuma policy de DELETE.
create policy mesas_insert on public.mesas
  for insert to authenticated
  with check (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());

create policy mesas_update on public.mesas
  for update to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor())
  with check (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());

-- ── comandas ─────────────────────────────────────────────────────────────────
drop policy if exists comandas_tenant_rw on public.comandas;
drop policy if exists comandas_select on public.comandas;

create policy comandas_select on public.comandas
  for select to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and public.auth_papel() in ('dono', 'gerente', 'garcom')
  );

-- Abrir, fechar e transferir comanda passam por endpoint com service_role: são
-- operações com efeito financeiro e precisam de transação e auditoria.
revoke insert, update, delete on public.comandas from authenticated;

-- ── clientes ─────────────────────────────────────────────────────────────────
-- Base do delivery: telefone e endereço não são assunto do salão.
drop policy if exists "Tenant members manage clientes" on public.clientes;
drop policy if exists clientes_select on public.clientes;
drop policy if exists clientes_update on public.clientes;

create policy clientes_select on public.clientes
  for select to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and public.auth_papel() in ('dono', 'gerente', 'atendente')
  );

create policy clientes_update on public.clientes
  for update to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and public.auth_papel() in ('dono', 'gerente', 'atendente')
  )
  with check (
    restaurante_id = public.auth_restaurante_id()
    and public.auth_papel() in ('dono', 'gerente', 'atendente')
  );

-- ── usuarios ─────────────────────────────────────────────────────────────────
-- RLS filtra linha, não coluna: a policy de colegas entregava e-mail, telefone,
-- autorização e validade da equipe inteira para qualquer autenticado. Grant por coluna
-- resolve. Dados sensíveis passam a sair só por endpoint com `equipe.gerenciar`.
revoke select on public.usuarios from authenticated;
grant select (id, restaurante_id, papel, nome, desativado_em) on public.usuarios to authenticated;

-- Criar, editar e desativar usuário: service_role, atrás do guard de permissão.
drop policy if exists "Users can update their own profile" on public.usuarios;
revoke insert, update, delete on public.usuarios from authenticated;

-- ── eventos_auditoria ────────────────────────────────────────────────────────
-- Append-only para a aplicação: leitura só de gestor, escrita só de service_role.
drop policy if exists auditoria_gestor_ro on public.eventos_auditoria;
create policy auditoria_gestor_ro on public.eventos_auditoria
  for select to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());

revoke all on public.eventos_auditoria from authenticated;
grant select on public.eventos_auditoria to authenticated;
revoke all on public.eventos_auditoria from anon;
