-- Sistema de campanhas de WhatsApp: disparo em massa para clientes cadastrados
-- com filtros de segmentação e envio escalonado com intervalo aleatório.

create table campanhas (
  id                   uuid primary key default gen_random_uuid(),
  restaurante_id       uuid not null references restaurantes (id) on delete cascade,
  nome                 text not null,
  status               text not null default 'rascunho',
  -- 'rascunho' | 'agendada' | 'enviando' | 'concluida' | 'cancelada'
  tipo_mensagem        text not null default 'texto',
  -- 'texto' | 'imagem' | 'audio'
  mensagem             text not null default '',
  imagem_url           text,
  audio_url            text,
  filtro               jsonb not null default '{}',
  agendado_em          timestamptz,
  total_destinatarios  integer not null default 0,
  total_enviados       integer not null default 0,
  total_erros          integer not null default 0,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);

create index campanhas_restaurante_status_idx on campanhas (restaurante_id, status);
create index campanhas_agendado_idx on campanhas (status, agendado_em) where status = 'agendada';

-- Fila de envios individuais: um registro por destinatário por campanha.
create table campanha_envios (
  id             uuid primary key default gen_random_uuid(),
  campanha_id    uuid not null references campanhas (id) on delete cascade,
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  telefone       text not null,
  nome_cliente   text not null default '',
  status         text not null default 'pendente',
  -- 'pendente' | 'enviado' | 'erro'
  erro           text,
  enviado_em     timestamptz,
  criado_em      timestamptz not null default now()
);

create index campanha_envios_campanha_status_idx on campanha_envios (campanha_id, status);
create index campanha_envios_pendentes_idx on campanha_envios (status, criado_em)
  where status = 'pendente';

alter table campanhas      enable row level security;
alter table campanha_envios enable row level security;

create policy "Tenant members manage campanhas"
  on campanhas for all
  using  (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Tenant members manage campanha_envios"
  on campanha_envios for all
  using  (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

grant select, insert, update, delete on campanhas, campanha_envios to authenticated;

-- Funções atômicas para incrementar contadores (chamadas pelo cron via service_role).
create or replace function campanha_incrementar_enviados(p_campanha_id uuid)
returns void language sql security definer as $$
  update campanhas set total_enviados = total_enviados + 1, atualizado_em = now()
  where id = p_campanha_id;
$$;

create or replace function campanha_incrementar_erros(p_campanha_id uuid)
returns void language sql security definer as $$
  update campanhas set total_erros = total_erros + 1, atualizado_em = now()
  where id = p_campanha_id;
$$;
