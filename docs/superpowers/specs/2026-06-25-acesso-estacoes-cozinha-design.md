# Acesso restrito por Estação + Kanban da Cozinha — Design

**Data:** 2026-06-25
**Sub-projeto:** 1 de 3 (Fundação de acesso → Cozinha → PDV). Este spec cobre só os dois
primeiros: a fundação de acesso por estação (token) e seu primeiro consumidor, o Kanban
da cozinha. PDV é spec próprio depois.

## Problema

Hoje a Menuzia tem **uma conta por loja** (papel `dono`). O enum `papel`
(`dono/atendente/cozinha/logistica/entregador`) existe no schema mas **nunca é checado**
no app — quem loga vê o painel inteiro. Não há tela para criar usuários extras.

O dono quer:
- Caixa/PDV, administrativo e disparos (campanhas) → **conta compartilhada**, uso
  simultâneo por várias pessoas. Isso **já funciona** hoje (sessões Supabase independentes,
  RLS por tenant, não por sessão) — não precisa mudar nada.
- Cozinha → **acesso restrito especial**: cozinheiro entra pelo celular/tablet, vê **só o
  Kanban**, e cada acesso é responsável por uma etapa (aceitar+preparar, OU pegar
  pronto+despachar).

## Conceito-chave

"**Fundação de acesso**" aqui **não é um RBAC completo** no painel principal (YAGNI). O
painel admin continua aberto/compartilhado. A fundação é o **mecanismo de Estação por
token** — uma view restrita, sem login, acessada por link/QR, com as ações permitidas
travadas no servidor. Reutilizável depois (PDV restrito, outros perfis). A **cozinha é o
primeiro consumidor** desse mecanismo. O padrão já existe e está validado no projeto: o
**portal do entregador** (`/entregador/{token}`).

## Padrão de referência (já no código)

`/entregador/{token}` → página client faz **polling** de `/api/entregador/{token}` →
rota server valida o token com o **admin client** (ignora RLS) → devolve dados. Ações são
POST em rotas token-scoped (`/api/entregador/{token}/pedidos/{id}/...`). Sem Supabase
realtime channel, sem login. A Estação copia exatamente esse padrão.

## Modelo de dados

Nova tabela `estacoes` (migration `0029_estacoes_cozinha.sql`):

```sql
create table estacoes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  nome text not null,                       -- "Chapa", "Expedição", "Cozinha"
  modo text not null check (modo in ('producao','expedicao','completa')),
  token uuid not null unique default gen_random_uuid(),
  ativo boolean not null default true,
  ultimo_visto_em timestamptz,              -- heartbeat → bolinha "online" no painel
  criado_em timestamptz not null default now()
);
create index estacoes_restaurante_id_idx on estacoes (restaurante_id);

alter table estacoes enable row level security;

-- Tenant gerencia só as suas estações (CRUD pelo painel).
create policy "Tenant manages own stations"
  on estacoes for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());
```

O acesso da estação em si **não usa RLS** — é validado server-side pelo token via admin
client, idêntico ao entregador. Anon não lê `estacoes` direto.

## Modos (gate no servidor — impossível burlar pela URL)

| Modo        | Vê                                   | Ações permitidas                                                |
|-------------|--------------------------------------|-----------------------------------------------------------------|
| `producao`  | colunas Recebido + Preparando        | aceitar (recebido→preparando), marcar pronto (preparando→pronto)|
| `expedicao` | coluna Pronto p/ Despacho            | entregue (retirada), enviar p/ logística (entrega)              |
| `completa`  | Recebido → Preparando → Pronto       | todas as ações acima                                            |

Cada rota de ação confere o `modo` da estação antes de executar. Ação não permitida pelo
modo → **403**. Sem bypass possível = sem bug de privilégio.

O dono **fixa o modo na criação** da estação. O cozinheiro **não troca** o modo pelo
celular — trocar furaria a restrição.

## Rotas novas (espelham o entregador)

- `GET /api/cozinha/{token}` → valida token (estação ativa) → devolve pedidos filtrados
  pelo `modo` + grava `ultimo_visto_em` (heartbeat).
- `POST /api/cozinha/{token}/pedidos/{id}/acao` body `{acao}` → valida que o `modo`
  permite a ação → reusa as mutations de pedido já existentes (as mesmas do
  `/admin/pedidos`). Ações: `aceitar`, `pronto`, `entregue`, `enviar_logistica`.

## Página `/cozinha/{token}`

- Kanban restrito, **tablet/celular-first**, botões grandes para toque. Reusa os
  componentes de card de pedido existentes onde der.
- **Polling ~6s** (mais rápido que os 10s do entregador — cozinha é time-critical).
- **Alerta sonoro de "novo pedido"** + badge visual quando entra pedido novo na view.
- `producao`/`completa`: card mostra itens + complementos + observações.
  `expedicao`: card mostra endereço + forma de pagamento + troco.
- Identidade visual Menuzia (Inter, radius 3px, paleta de status laranja/azul/verde).

## Gestão no painel — Ajustes › nova seção "Estações de cozinha"

Espelha o gerenciador de entregador:
- Criar estação (nome + modo).
- Listar com **link + QR + botão copiar**.
- Bolinha **online/offline** por `ultimo_visto_em` (online se < ~30s).
- Ativar/desativar (`ativo`).
- **Rotacionar token** (gera novo `token`, invalida o link antigo).
- Excluir.

## Realtime de volta ao painel

Estação avança um pedido → `/admin/pedidos` **já escuta** `postgres_changes` em `pedidos`
→ atualiza sozinho. O polling da estação pega mudanças feitas em outros lugares.
Consistente, sem código extra.

## Fora de escopo (deste spec)

- RBAC por usuário no painel principal (não é necessário — conta compartilhada).
- Estação "por categoria" (bar vê só bebidas etc.) — fica para depois.
- Login por senha ou PIN para a cozinha — decidido token/QR sem senha.
- Módulo PDV — spec próprio (sub-projeto 3).
- Alterar o portal do entregador ou o painel principal de pedidos.

## Critérios de sucesso

1. Dono cria uma estação `producao` em Ajustes, abre o QR no tablet, vê só Recebido +
   Preparando, aceita e marca pronto — e isso reflete no `/admin/pedidos` em tempo real.
2. Uma estação `expedicao` só consegue despachar/entregar; tentar `aceitar` via API
   devolve 403.
3. Estação desativada ou token rotacionado invalida o link antigo (404/inválido).
4. Painel principal, login e portal do entregador seguem funcionando sem mudança.
