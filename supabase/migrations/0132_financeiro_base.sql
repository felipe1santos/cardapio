-- 0132 — Módulo Financeiro, Fase 1: base (2026-10-01). Ver docs/financeiro/plano.md.
--
-- 1. restaurantes.financeiro_ativo: flag por loja (padrão DESLIGADA — nada muda sem ela).
-- 2. fin_config: limites de aprovação e alertas por loja (padrões aprovados no plano §5).
-- 3. fin_lancamentos: LIVRO-CAIXA único, em CENTAVOS, append-only (gatilho recusa UPDATE/DELETE
--    para todos os papéis da API, inclusive service_role) e com hash encadeado por loja.
--    Correção = novo lançamento (estorno/ajuste) que aponta o original.
-- 4. fin_aprovacoes: quem pediu, quem aprovou (sempre pessoas diferentes), valor e motivo.
-- 5. fin_alertas: alertas para o dono.
-- 6. Auditoria à prova de adulteração: eventos_auditoria ganha hash encadeado por loja e fica
--    imutável (nem service_role altera/apaga). Função de verificação da cadeia.
-- 7. PIN pessoal (6 dígitos, bcrypt), com bloqueio após 5 erros por 15 min.
-- 8. usuarios_sessoes: histórico de login (IP, dispositivo) para detectar login simultâneo.
-- 9. Correções de risco do diagnóstico:
--    R1  fechamentos_caixa deixa de aceitar escrita do navegador;
--    R2  entregador não pode mais ser apagado pelo navegador, e apagar não leva os acertos junto;
--    R3  pedido entregue/cancelado não troca de entregador pelo navegador; troca é auditada;
--    R9  com o financeiro ligado, ninguém aprova o próprio pedido de cancelamento;
--    R13 cupom_usos deixa de aceitar escrita do navegador.
--
-- Rollback: docs/rollback/0132_financeiro_base.down.sql

-- ── 1. Flag ─────────────────────────────────────────────────────────────────
alter table public.restaurantes add column if not exists financeiro_ativo boolean not null default false;
comment on column public.restaurantes.financeiro_ativo is 'Módulo financeiro (0132). Desligado = tudo como antes.';

-- Quem do papel de servidor está gravando: só o dono do banco (migrations, manutenção)
-- passa pelas travas de imutabilidade. service_role, authenticated e anon não passam.
create or replace function public.fin_manutencao() returns boolean language sql stable as $$
  select current_user in ('postgres', 'supabase_admin')
$$;

-- ── 2. Configuração por loja ────────────────────────────────────────────────
create table if not exists public.fin_config (
  restaurante_id uuid primary key references public.restaurantes(id) on delete cascade,
  limite_desconto_pct numeric(5,2) not null default 10 check (limite_desconto_pct between 0 and 100),
  limite_desconto_centavos bigint not null default 2000 check (limite_desconto_centavos >= 0),
  limite_saida_centavos bigint not null default 10000 check (limite_saida_centavos >= 0),
  limite_divergencia_centavos bigint not null default 500 check (limite_divergencia_centavos >= 0),
  horas_caixa_aberto integer not null default 14 check (horas_caixa_aberto between 1 and 72),
  horas_motoboy_pendente integer not null default 3 check (horas_motoboy_pendente between 1 and 48),
  inatividade_min integer not null default 5 check (inatividade_min between 1 and 120),
  margem_alvo_pct numeric(5,2) not null default 65 check (margem_alvo_pct between 0 and 95),
  alerta_whatsapp text check (alerta_whatsapp is null or alerta_whatsapp ~ '^[0-9]{12,13}$'),
  max_acoes_sensiveis_turno integer not null default 10 check (max_acoes_sensiveis_turno >= 1),
  atualizado_em timestamptz not null default now(),
  atualizado_por_nome text
);
alter table public.fin_config enable row level security;
revoke all on public.fin_config from anon, authenticated;
grant select on public.fin_config to authenticated;
drop policy if exists "Gestor lê a configuração financeira" on public.fin_config;
create policy "Gestor lê a configuração financeira" on public.fin_config for select to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());

-- ── Hash encadeado (genérico) ───────────────────────────────────────────────
-- hash = sha256(hash_anterior || conteúdo canônico). Trava por loja (advisory lock) para dois
-- registros simultâneos não pegarem o mesmo "anterior".
create or replace function public.fin_sha256(p text) returns text language sql immutable
  set search_path = public, extensions as $$
  select encode(extensions.digest(convert_to(coalesce(p, ''), 'UTF8'), 'sha256'), 'hex')
$$;

-- ── 3. Livro-caixa ──────────────────────────────────────────────────────────
create table if not exists public.fin_lancamentos (
  id bigint generated always as identity primary key,
  restaurante_id uuid not null references public.restaurantes(id) on delete restrict,
  grupo_id uuid not null,
  linha smallint not null default 1 check (linha between 1 and 20),
  turno_id uuid references public.caixa_turnos(id) on delete restrict,
  carteira text not null check (carteira in ('gaveta', 'motoboy', 'pix_conferir', 'cartao', 'empresa', 'a_receber', 'resultado')),
  entregador_id uuid references public.entregadores(id) on delete restrict,
  tipo text not null check (tipo in (
    'venda', 'recebimento', 'troco', 'sangria', 'reforco', 'despesa', 'compra', 'retirada', 'perda', 'ajuste',
    'troco_motoboy', 'acerto_motoboy', 'pendencia_motoboy', 'estorno', 'taxa', 'desconto', 'pix_confirmado',
    'abertura', 'conta_pagar', 'conta_receber', 'outro')),
  valor_centavos bigint not null check (valor_centavos <> 0),
  forma text check (forma in ('dinheiro', 'pix', 'credito', 'debito', 'cartao', 'vale', 'fiado', 'transferencia', 'boleto', 'outro')),
  origem text not null check (origem in ('pdv', 'mesa', 'balcao', 'delivery', 'motoboy', 'online', 'manual', 'sistema')),
  pedido_id uuid references public.pedidos(id) on delete restrict,
  comanda_id uuid,
  pagamento_id uuid,
  referencia_id bigint references public.fin_lancamentos(id) on delete restrict,
  motivo text check (motivo is null or length(motivo) <= 500),
  usuario_id uuid,
  usuario_nome text not null,
  aprovacao_id uuid,
  aprovado_por_nome text,
  chave_idempotencia text not null check (length(chave_idempotencia) between 8 and 120),
  dispositivo text check (dispositivo is null or length(dispositivo) <= 200),
  dados jsonb,
  criado_em timestamptz not null default now(),
  hash_anterior text,
  hash text not null default ''
);
create unique index if not exists fin_lancamentos_idem on public.fin_lancamentos (restaurante_id, chave_idempotencia, linha);
create index if not exists fin_lancamentos_turno on public.fin_lancamentos (restaurante_id, turno_id);
create index if not exists fin_lancamentos_carteira on public.fin_lancamentos (restaurante_id, carteira, entregador_id);
create index if not exists fin_lancamentos_data on public.fin_lancamentos (restaurante_id, criado_em);
create index if not exists fin_lancamentos_pedido on public.fin_lancamentos (pedido_id) where pedido_id is not null;
create index if not exists fin_lancamentos_grupo on public.fin_lancamentos (grupo_id);

create or replace function public.fin_lancamentos_antes_inserir() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_ant text;
begin
  -- Data e hora sempre do servidor.
  new.criado_em := now();
  perform pg_advisory_xact_lock(hashtextextended('fin_lancamentos:' || new.restaurante_id::text, 0));
  select l.hash into v_ant from public.fin_lancamentos l where l.restaurante_id = new.restaurante_id order by l.id desc limit 1;
  new.hash_anterior := v_ant;
  new.hash := public.fin_sha256(concat_ws('|', coalesce(v_ant, ''), new.restaurante_id, new.grupo_id, new.linha, new.turno_id,
    new.carteira, new.entregador_id, new.tipo, new.valor_centavos, new.forma, new.origem, new.pedido_id, new.comanda_id,
    new.pagamento_id, new.referencia_id, new.motivo, new.usuario_id, new.usuario_nome, new.aprovacao_id,
    new.chave_idempotencia, to_char(new.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')));
  return new;
end $$;
drop trigger if exists fin_lancamentos_antes_inserir on public.fin_lancamentos;
create trigger fin_lancamentos_antes_inserir before insert on public.fin_lancamentos
  for each row execute function public.fin_lancamentos_antes_inserir();

create or replace function public.fin_imutavel() returns trigger language plpgsql as $$
begin
  if public.fin_manutencao() then return coalesce(new, old); end if;
  raise exception 'registro_imutavel: % não pode ser alterado nem apagado; faça um lançamento de correção', tg_table_name
    using errcode = '42501';
end $$;
drop trigger if exists fin_lancamentos_imutavel on public.fin_lancamentos;
create trigger fin_lancamentos_imutavel before update or delete on public.fin_lancamentos
  for each row execute function public.fin_imutavel();
drop trigger if exists fin_lancamentos_sem_truncate on public.fin_lancamentos;
create trigger fin_lancamentos_sem_truncate before truncate on public.fin_lancamentos
  for each statement execute function public.fin_imutavel();

alter table public.fin_lancamentos enable row level security;
revoke all on public.fin_lancamentos from anon, authenticated;
grant select on public.fin_lancamentos to authenticated;
drop policy if exists "Gestor lê o livro-caixa" on public.fin_lancamentos;
create policy "Gestor lê o livro-caixa" on public.fin_lancamentos for select to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());

-- ── 4. Aprovações ───────────────────────────────────────────────────────────
create table if not exists public.fin_aprovacoes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete restrict,
  acao text not null check (length(acao) between 3 and 60),
  solicitante_id uuid not null,
  solicitante_nome text not null,
  aprovador_id uuid not null,
  aprovador_nome text not null,
  valor_centavos bigint,
  motivo text check (motivo is null or length(motivo) <= 500),
  contexto jsonb,
  criado_em timestamptz not null default now(),
  constraint fin_aprovacoes_pessoas_diferentes check (solicitante_id <> aprovador_id)
);
create index if not exists fin_aprovacoes_loja on public.fin_aprovacoes (restaurante_id, criado_em desc);
drop trigger if exists fin_aprovacoes_imutavel on public.fin_aprovacoes;
create trigger fin_aprovacoes_imutavel before update or delete on public.fin_aprovacoes
  for each row execute function public.fin_imutavel();
alter table public.fin_aprovacoes enable row level security;
revoke all on public.fin_aprovacoes from anon, authenticated;
grant select on public.fin_aprovacoes to authenticated;
drop policy if exists "Gestor lê as aprovações" on public.fin_aprovacoes;
create policy "Gestor lê as aprovações" on public.fin_aprovacoes for select to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());

-- ── 5. Alertas ──────────────────────────────────────────────────────────────
create table if not exists public.fin_alertas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  tipo text not null check (length(tipo) between 3 and 60),
  gravidade text not null default 'atencao' check (gravidade in ('info', 'atencao', 'grave')),
  mensagem text not null check (length(mensagem) <= 500),
  dados jsonb,
  usuario_id uuid,
  usuario_nome text,
  lido_por_nome text,
  lido_em timestamptz,
  whatsapp_enviado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists fin_alertas_loja on public.fin_alertas (restaurante_id, criado_em desc);
alter table public.fin_alertas enable row level security;
revoke all on public.fin_alertas from anon, authenticated;
grant select on public.fin_alertas to authenticated;
drop policy if exists "Gestor lê os alertas" on public.fin_alertas;
create policy "Gestor lê os alertas" on public.fin_alertas for select to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());

-- ── 6. Auditoria à prova de adulteração ─────────────────────────────────────
alter table public.eventos_auditoria add column if not exists hash_anterior text;
alter table public.eventos_auditoria add column if not exists hash text;

create or replace function public.eventos_auditoria_conteudo(e public.eventos_auditoria) returns text language sql immutable as $$
  -- usuario_id fica de fora: apagar a conta do usuário zera esse campo (on delete set null);
  -- o nome (retrato da hora) é que entra no hash.
  select concat_ws('|', e.id, e.restaurante_id, e.ator, e.usuario_nome, e.acao, e.entidade, e.entidade_id,
    e.dados::text, e.papel, e.correlacao, to_char(e.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'))
$$;

create or replace function public.eventos_auditoria_encadear() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_ant text;
begin
  new.criado_em := now();
  perform pg_advisory_xact_lock(hashtextextended('eventos_auditoria:' || coalesce(new.restaurante_id::text, '-'), 0));
  select a.hash into v_ant from public.eventos_auditoria a
   where a.restaurante_id is not distinct from new.restaurante_id and a.hash is not null
   order by a.criado_em desc, a.id desc limit 1;
  new.hash_anterior := v_ant;
  new.hash := public.fin_sha256(coalesce(v_ant, '') || '|' || public.eventos_auditoria_conteudo(new));
  return new;
end $$;
-- Roda DEPOIS do gatilho de contexto (papel/correlação): nome com "z" para ordenar por último.
drop trigger if exists z_eventos_auditoria_encadear on public.eventos_auditoria;
create trigger z_eventos_auditoria_encadear before insert on public.eventos_auditoria
  for each row execute function public.eventos_auditoria_encadear();
-- Imutável, com UMA exceção: zerar usuario_id quando a conta do usuário é apagada (FK on delete
-- set null). Qualquer outra mudança, ou apagar o registro, é recusada.
create or replace function public.eventos_auditoria_imutavel() returns trigger language plpgsql as $$
begin
  if public.fin_manutencao() then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.usuario_id is null and old.usuario_id is not null
     and public.eventos_auditoria_conteudo(new) = public.eventos_auditoria_conteudo(old)
     and new.hash is not distinct from old.hash and new.hash_anterior is not distinct from old.hash_anterior then
    return new;
  end if;
  raise exception 'registro_imutavel: eventos_auditoria não pode ser alterado nem apagado' using errcode = '42501';
end $$;
drop trigger if exists eventos_auditoria_imutavel on public.eventos_auditoria;
create trigger eventos_auditoria_imutavel before update or delete on public.eventos_auditoria
  for each row execute function public.eventos_auditoria_imutavel();
drop trigger if exists eventos_auditoria_sem_truncate on public.eventos_auditoria;
create trigger eventos_auditoria_sem_truncate before truncate on public.eventos_auditoria
  for each statement execute function public.fin_imutavel();

-- Encadeia o que já existe (a migration roda como dono do banco, que passa pela trava).
do $$
declare r public.eventos_auditoria%rowtype; v_ant text; v_loja uuid := '00000000-0000-0000-0000-000000000000'; v_primeira boolean := true;
begin
  for r in select * from public.eventos_auditoria where hash is null order by restaurante_id nulls first, criado_em, id loop
    if v_primeira or r.restaurante_id is distinct from v_loja then
      v_loja := r.restaurante_id; v_primeira := false;
      select a.hash into v_ant from public.eventos_auditoria a
       where a.restaurante_id is not distinct from r.restaurante_id and a.hash is not null order by a.criado_em desc, a.id desc limit 1;
    end if;
    update public.eventos_auditoria set hash_anterior = v_ant, hash = public.fin_sha256(coalesce(v_ant, '') || '|' || public.eventos_auditoria_conteudo(r))
     where id = r.id returning hash into v_ant;
  end loop;
end $$;

-- Verificação: percorre a cadeia da loja e devolve o primeiro registro adulterado (ou nada).
create or replace function public.auditoria_verificar_cadeia(p_restaurante uuid)
returns table (tabela text, registro text, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare r public.eventos_auditoria%rowtype; l public.fin_lancamentos%rowtype; v_ant text := null;
begin
  for r in select * from public.eventos_auditoria where restaurante_id = p_restaurante order by criado_em, id loop
    if r.hash_anterior is distinct from v_ant then
      tabela := 'eventos_auditoria'; registro := r.id::text; motivo := 'cadeia quebrada (registro removido ou fora de ordem)'; return next; return;
    end if;
    if r.hash <> public.fin_sha256(coalesce(v_ant, '') || '|' || public.eventos_auditoria_conteudo(r)) then
      tabela := 'eventos_auditoria'; registro := r.id::text; motivo := 'conteúdo alterado'; return next; return;
    end if;
    v_ant := r.hash;
  end loop;
  v_ant := null;
  for l in select * from public.fin_lancamentos where restaurante_id = p_restaurante order by id loop
    if l.hash_anterior is distinct from v_ant then
      tabela := 'fin_lancamentos'; registro := l.id::text; motivo := 'cadeia quebrada (lançamento removido ou fora de ordem)'; return next; return;
    end if;
    if l.hash <> public.fin_sha256(concat_ws('|', coalesce(v_ant, ''), l.restaurante_id, l.grupo_id, l.linha, l.turno_id,
      l.carteira, l.entregador_id, l.tipo, l.valor_centavos, l.forma, l.origem, l.pedido_id, l.comanda_id, l.pagamento_id,
      l.referencia_id, l.motivo, l.usuario_id, l.usuario_nome, l.aprovacao_id, l.chave_idempotencia,
      to_char(l.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'))) then
      tabela := 'fin_lancamentos'; registro := l.id::text; motivo := 'conteúdo alterado'; return next; return;
    end if;
    v_ant := l.hash;
  end loop;
end $$;
revoke execute on function public.auditoria_verificar_cadeia(uuid) from public, anon, authenticated;
grant execute on function public.auditoria_verificar_cadeia(uuid) to service_role;

-- ── 7. PIN pessoal ──────────────────────────────────────────────────────────
alter table public.usuarios add column if not exists pin_hash text;
alter table public.usuarios add column if not exists pin_falhas integer not null default 0;
alter table public.usuarios add column if not exists pin_bloqueado_ate timestamptz;
alter table public.usuarios add column if not exists pin_definido_em timestamptz;
-- (usuarios tem grant por coluna desde a 0062: estas colunas NÃO são legíveis pelo navegador.)

create or replace function public.usuario_definir_pin(p_usuario uuid, p_pin text) returns void
  language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_pin !~ '^[0-9]{6}$' then raise exception 'pin_invalido' using errcode = '22023'; end if;
  if p_pin ~ '^(.)\1{5}$' or p_pin in ('123456', '654321', '012345', '543210') then raise exception 'pin_fraco' using errcode = '22023'; end if;
  update public.usuarios set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), pin_falhas = 0, pin_bloqueado_ate = null, pin_definido_em = now()
   where id = p_usuario;
end $$;

-- 'ok' | 'errado' | 'bloqueado' | 'sem_pin' | 'inativo'. 5 erros seguidos bloqueiam por 15 min.
create or replace function public.usuario_verificar_pin(p_restaurante uuid, p_usuario uuid, p_pin text) returns text
  language plpgsql security definer set search_path = public, extensions as $$
declare u public.usuarios%rowtype;
begin
  select * into u from public.usuarios where id = p_usuario and restaurante_id = p_restaurante for update;
  if not found or u.desativado_em is not null then return 'inativo'; end if;
  if u.pin_hash is null then return 'sem_pin'; end if;
  if u.pin_bloqueado_ate is not null and u.pin_bloqueado_ate > now() then return 'bloqueado'; end if;
  if p_pin ~ '^[0-9]{6}$' and extensions.crypt(p_pin, u.pin_hash) = u.pin_hash then
    update public.usuarios set pin_falhas = 0, pin_bloqueado_ate = null where id = p_usuario;
    return 'ok';
  end if;
  update public.usuarios set pin_falhas = u.pin_falhas + 1,
         pin_bloqueado_ate = case when u.pin_falhas + 1 >= 5 then now() + interval '15 minutes' else null end
   where id = p_usuario;
  return case when u.pin_falhas + 1 >= 5 then 'bloqueado' else 'errado' end;
end $$;
revoke execute on function public.usuario_definir_pin(uuid, text) from public, anon, authenticated;
revoke execute on function public.usuario_verificar_pin(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.usuario_definir_pin(uuid, text) to service_role;
grant execute on function public.usuario_verificar_pin(uuid, uuid, text) to service_role;

-- ── 8. Sessões ──────────────────────────────────────────────────────────────
create table if not exists public.usuarios_sessoes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid references public.restaurantes(id) on delete cascade,
  usuario_id uuid not null,
  ip text,
  dispositivo text check (dispositivo is null or length(dispositivo) <= 300),
  terminal text check (terminal is null or length(terminal) <= 80),
  criado_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),
  encerrada_em timestamptz,
  motivo_encerramento text,
  -- Tela travada (inatividade ou "Bloquear tela"): a sessão segue viva para o Kanban e o
  -- tempo real não pararem, mas o servidor recusa ações de dinheiro até destravar com PIN.
  bloqueada_em timestamptz
);
create index if not exists usuarios_sessoes_usuario on public.usuarios_sessoes (usuario_id, visto_em desc);
create index if not exists usuarios_sessoes_loja on public.usuarios_sessoes (restaurante_id, criado_em desc);
alter table public.usuarios_sessoes enable row level security;
revoke all on public.usuarios_sessoes from anon, authenticated;
grant select on public.usuarios_sessoes to authenticated;
drop policy if exists "Gestor vê as sessões da loja" on public.usuarios_sessoes;
create policy "Gestor vê as sessões da loja" on public.usuarios_sessoes for select to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());

-- ── 9. Correções de risco ───────────────────────────────────────────────────
-- R1: acertos de entregador só pelo servidor (a tela já grava por /api/admin/caixa).
revoke insert, update, delete, truncate on public.fechamentos_caixa from authenticated, anon;
-- R2: entregador não se apaga pelo navegador; e apagar (manutenção) não leva os acertos junto.
revoke delete, truncate on public.entregadores from authenticated, anon;
alter table public.fechamentos_caixa drop constraint if exists fechamentos_caixa_entregador_id_fkey;
alter table public.fechamentos_caixa add constraint fechamentos_caixa_entregador_id_fkey
  foreign key (entregador_id) references public.entregadores(id) on delete restrict;
-- R13: uso de cupom só pelo servidor (vitrine, PDV e estorno de fidelidade já usam service_role).
revoke insert, update, delete, truncate on public.cupom_usos from authenticated, anon;

-- R9: com o financeiro ligado, quem pediu o cancelamento não aprova o próprio pedido (recusar
-- pode). Gatilho e não só a rota: as duas rotas de decisão e a RPC passam por aqui.
create or replace function public.cancelamento_sem_autoaprovacao() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'aprovada' and old.status = 'pendente' and new.decidido_por is not null
     and new.decidido_por = old.solicitado_por
     and exists (select 1 from public.restaurantes r where r.id = new.restaurante_id and r.financeiro_ativo) then
    raise exception 'autoaprovacao';
  end if;
  return new;
end $$;
drop trigger if exists solicitacoes_cancelamento_sem_autoaprovacao on public.solicitacoes_cancelamento;
create trigger solicitacoes_cancelamento_sem_autoaprovacao before update on public.solicitacoes_cancelamento
  for each row execute function public.cancelamento_sem_autoaprovacao();

-- R3: pedido entregue/cancelado não troca de entregador pelo navegador; toda troca feita pelo
-- navegador fica na auditoria.
create or replace function public.pedidos_entregador_protegido() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.entregador_id is not distinct from old.entregador_id then return new; end if;
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then return new; end if;
  if old.status in ('entregue', 'cancelado') then
    raise exception 'entregador_travado: o pedido já foi % e não pode trocar de entregador', old.status using errcode = '42501';
  end if;
  perform public.auditoria_registrar(new.restaurante_id, auth.uid(), (select u.nome from public.usuarios u where u.id = auth.uid()), 'pedido.trocou_entregador', 'pedido', new.id,
    jsonb_build_object('numero', new.numero, 'de', old.entregador_id, 'para', new.entregador_id, 'status', old.status));
  return new;
end $$;
drop trigger if exists pedidos_entregador_protegido on public.pedidos;
create trigger pedidos_entregador_protegido before update of entregador_id on public.pedidos
  for each row execute function public.pedidos_entregador_protegido();
