-- Policies de `pedidos` e `pedido_itens` — uma por operação, com allowlist de papéis.
--
-- O que estava errado antes: `for all using (restaurante_id = auth_restaurante_id())`.
-- Isso dá SELECT, INSERT, UPDATE e DELETE de uma vez para qualquer papel do tenant. Como
-- o painel é client-side, um garçom faria `update pedidos set total = 0` do console.
--
-- Nada de `auth_papel() <> 'garcom'`: papel novo não pode herdar o delivery por descuido.

-- ── pedidos ──────────────────────────────────────────────────────────────────
drop policy if exists "Tenant members manage pedidos" on public.pedidos;
drop policy if exists pedidos_tenant on public.pedidos;

-- Leitura: uma allowlist POR CANAL. Quem atende o delivery não passa a enxergar o salão
-- (e vice-versa) só por estar no mesmo tenant. Canal desconhecido nega — se um canal
-- novo aparecer, ele nasce invisível até alguém decidir quem o vê.
drop policy if exists pedidos_select on public.pedidos;
create policy pedidos_select on public.pedidos
  for select to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and case canal
          when 'mesa'     then public.auth_papel() in ('dono', 'gerente', 'garcom', 'cozinha')
          when 'delivery' then public.auth_papel() in ('dono', 'gerente', 'atendente', 'logistica')
          when 'balcao'   then public.auth_papel() in ('dono', 'gerente', 'atendente')
          else false
        end
  );

-- Escrita: só as colunas operacionais, e só para quem move pedido no painel.
-- Criar e apagar pedido é exclusividade do servidor (service_role).
--
-- No canal mesa o garçom fica de fora de propósito: ele lança e envia para a cozinha,
-- quem avança o preparo é a cozinha.
drop policy if exists pedidos_update on public.pedidos;
create policy pedidos_update on public.pedidos
  for update to authenticated
  using (
    restaurante_id = public.auth_restaurante_id()
    and case canal
          when 'mesa'     then public.auth_papel() in ('dono', 'gerente', 'cozinha')
          when 'delivery' then public.auth_papel() in ('dono', 'gerente', 'atendente', 'logistica')
          when 'balcao'   then public.auth_papel() in ('dono', 'gerente', 'atendente')
          else false
        end
  )
  with check (
    restaurante_id = public.auth_restaurante_id()
    and case canal
          when 'mesa'     then public.auth_papel() in ('dono', 'gerente', 'cozinha')
          when 'delivery' then public.auth_papel() in ('dono', 'gerente', 'atendente', 'logistica')
          when 'balcao'   then public.auth_papel() in ('dono', 'gerente', 'atendente')
          else false
        end
  );

-- Sem policy de INSERT e de DELETE: service_role apenas.

-- Grant por coluna: preço, desconto, total, pago, canal, origem e comanda_id ficam
-- inalteráveis pelo navegador. As sete abaixo são exatamente as que o painel escreve
-- hoje (Kanban, Logística e fila de impressão).
revoke update on public.pedidos from authenticated;
grant update (
  status,
  preparando_por,
  preparado_por,
  preparando_notificado,
  entregador_id,
  impresso,
  reimprimir
) on public.pedidos to authenticated;

-- ── pedido_itens ─────────────────────────────────────────────────────────────
drop policy if exists "Tenant members manage pedido_itens" on public.pedido_itens;
drop policy if exists pedido_itens_select on public.pedido_itens;

-- Espelha a visibilidade do pedido pai.
create policy pedido_itens_select on public.pedido_itens
  for select to authenticated
  using (
    exists (
      select 1 from public.pedidos p
       where p.id = pedido_itens.pedido_id
         and p.restaurante_id = public.auth_restaurante_id()
         and case p.canal
               when 'mesa'     then public.auth_papel() in ('dono', 'gerente', 'garcom', 'cozinha')
               when 'delivery' then public.auth_papel() in ('dono', 'gerente', 'atendente', 'logistica')
               when 'balcao'   then public.auth_papel() in ('dono', 'gerente', 'atendente')
               else false
             end
    )
  );

-- Item de pedido só nasce, muda e morre pelo servidor.
revoke insert, update, delete on public.pedido_itens from authenticated;
