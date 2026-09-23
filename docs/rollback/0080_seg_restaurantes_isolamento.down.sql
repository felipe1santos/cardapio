-- Rollback da 0080 — SÓ PARA EMERGÊNCIA.
-- ⚠ Reabre o vazamento: usuário logado volta a ler todas as colunas de todas as
-- lojas, inclusive impressao_agente_token. Use apenas se a 0080 derrubar o painel
-- e o código novo (que não lê o token pelo navegador) não puder subir.
drop policy if exists "Visitante le a vitrine" on public.restaurantes;
drop policy if exists "Tenant members can read their restaurant" on public.restaurantes;
create policy "Anyone can read restaurant storefront" on public.restaurantes for select using (true);
create policy "Tenant members can read their restaurant" on public.restaurantes for select using (id = auth_restaurante_id());
grant select, update on public.restaurantes to authenticated;
