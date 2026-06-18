-- ============================================================================
-- Configuração de impressão (aba "Impressão" em Ajustes) + pareamento do
-- Assistente de Impressão Menuzia (agente desktop instalado no PC do lojista,
-- que liga o sistema na nuvem à impressora física instalada localmente).
-- ============================================================================

alter table restaurantes
  add column impressao_mostrar_numero_item boolean not null default true,
  add column impressao_mostrar_preco_complementos boolean not null default true,
  add column impressao_mostrar_nome_complementos boolean not null default true,
  add column impressao_fonte_maior_producao boolean not null default false,
  add column impressao_multiplicar_opcoes_qtd boolean not null default false,
  add column impressao_logo boolean not null default true,
  add column impressao_comprovante_cancelamento boolean not null default false,
  add column impressao_qrcode_avaliacao boolean not null default true,
  add column impressao_ativar_assistente boolean not null default false,
  add column impressao_automatica boolean not null default false,
  add column impressao_aceitar_pedidos_automaticamente boolean not null default false,
  add column impressao_agente_token uuid;

-- Impressoras cadastradas pelo lojista (uma loja pode ter mais de uma, ex.: cozinha + balcão)
create table impressoras (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  nome text not null,
  fabricante text not null default '',
  impressora_sistema text not null default '', -- nome exato reportado pelo Windows (lista vinda do agente)
  tamanho_fonte text not null default 'pequena',
  largura int not null default 48,
  copias int not null default 1,
  ativa boolean not null default true,
  posicao int not null default 0,
  criado_em timestamptz not null default now()
);

create index impressoras_restaurante_id_idx on impressoras (restaurante_id);

alter table impressoras enable row level security;

create policy "Tenant members manage their impressoras"
  on impressoras for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

grant select, insert, update, delete on impressoras to authenticated;

-- O agente desktop autentica com o token de pareamento (sem login de usuário) para
-- ler o restaurante_id e assinar pedidos novos via Realtime. Função roda com
-- security definer pra contornar RLS só nessa checagem pontual.
create or replace function restaurante_id_por_agente_token(token uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from restaurantes where impressao_agente_token = token;
$$;

grant execute on function restaurante_id_por_agente_token(uuid) to anon, authenticated;
