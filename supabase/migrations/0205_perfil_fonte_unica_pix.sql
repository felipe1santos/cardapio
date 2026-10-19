-- 0205 — Perfil da loja = fonte única dos dados que o robô/IA usam (19/10/2026, Etapa 0 do modo autônomo).
-- Tempo de entrega já está no Perfil (0203). Aqui: chave Pix (tipo + chave) sai de whatsapp_robo_config e vai para
-- restaurantes. Valores já preenchidos são COPIADOS (nunca apagados): o código lê Perfil primeiro e cai no legado.
-- Grant por coluna é obrigatório (0080/0204): sem ele o painel inteiro abre vazio.
alter table public.restaurantes add column if not exists pix_chave text;
alter table public.restaurantes add column if not exists pix_chave_tipo text;
alter table public.restaurantes drop constraint if exists restaurantes_pix_chave_check;
alter table public.restaurantes add constraint restaurantes_pix_chave_check
  check (pix_chave is null or char_length(pix_chave) <= 140);
alter table public.restaurantes drop constraint if exists restaurantes_pix_chave_tipo_check;
alter table public.restaurantes add constraint restaurantes_pix_chave_tipo_check
  check (pix_chave_tipo is null or pix_chave_tipo in ('cpf', 'cnpj', 'telefone', 'email', 'aleatoria'));
grant select (pix_chave, pix_chave_tipo) on public.restaurantes to authenticated;
grant update (pix_chave, pix_chave_tipo) on public.restaurantes to authenticated;

-- Migra o que a loja já tinha preenchido na tela do Robô (só preenche o que está vazio no Perfil).
update public.restaurantes r
   set tempo_entrega = coalesce(nullif(trim(r.tempo_entrega), ''), nullif(trim(c.auto_tempo_entrega), '')),
       pix_chave = coalesce(nullif(trim(r.pix_chave), ''), nullif(trim(c.pix_chave), '')),
       pix_chave_tipo = coalesce(r.pix_chave_tipo, case when nullif(trim(c.pix_chave), '') is not null then c.pix_chave_tipo end)
  from public.whatsapp_robo_config c
 where c.restaurante_id = r.id;
