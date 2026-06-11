-- ============================================================================
-- Corrige a página de Ajustes: faltava permissão para o tenant atualizar o
-- próprio registro em `restaurantes` (logo, layout do cardápio, taxa padrão,
-- integrações etc. nunca eram persistidos). Também adiciona o banner de capa
-- da vitrine, configurável em Ajustes > Perfil da loja.
-- ============================================================================

alter table restaurantes
  add column banner_url text;

create policy "Tenant members can update their restaurant"
  on restaurantes for update
  using (id = auth_restaurante_id())
  with check (id = auth_restaurante_id());

grant update on restaurantes to authenticated;
