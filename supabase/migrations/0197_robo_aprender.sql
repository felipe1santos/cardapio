-- 0197 (16/10/2026): "Perguntas que o robô não entendeu" refeito — o dono revisa uma frase por vez e escolhe:
--   robô responde (palavra-chave no assunto) · IA responde (conhecimento da loja) · é pedido · ignorar.
-- Palavra genérica ensinada numa loja vira SUGESTÃO no Super Admin; aprovada, vale para todas.
-- Conhecimento da loja é só da loja (nunca compartilhado). Tudo pelo servidor (service_role): nada para anon/authenticated.

alter table public.whatsapp_auto_nao_entendidas
  add column if not exists acao text check (acao is null or acao in ('robo', 'ia', 'pedido', 'ignorar', 'ja_entende')),
  add column if not exists resolvido_em timestamptz,
  add column if not exists resolvido_por text,
  add column if not exists sugestao jsonb,
  add column if not exists contexto text check (contexto is null or char_length(contexto) <= 500);

create table if not exists public.ia_conhecimento (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  pergunta text not null check (char_length(pergunta) between 1 and 300),
  resposta text not null check (char_length(resposta) between 1 and 600),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por_nome text
);
alter table public.ia_conhecimento enable row level security;
revoke all on public.ia_conhecimento from anon, authenticated;
create index if not exists idx_ia_conhecimento_loja on public.ia_conhecimento (restaurante_id, criado_em);

create table if not exists public.robo_palavras_globais (
  id uuid primary key default gen_random_uuid(),
  palavra text not null check (char_length(palavra) between 2 and 60),
  assunto text not null,
  status text not null default 'sugerida' check (status in ('sugerida', 'aprovada', 'recusada')),
  origem_restaurante_id uuid references public.restaurantes(id) on delete set null,
  vezes integer not null default 1,
  criado_em timestamptz not null default now(),
  decidido_em timestamptz,
  decidido_por text,
  unique (palavra, assunto)
);
alter table public.robo_palavras_globais enable row level security;
revoke all on public.robo_palavras_globais from anon, authenticated;

-- Sugestão pela IA: no máximo 1 lote por dia por loja.
alter table public.whatsapp_robo_config add column if not exists auto_sugestao_ia_em date;
