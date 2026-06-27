# PDV — Fase 2: Comanda de Mesa (design/spec)

> Sub-projeto PDV (serviço de mesa). Fase 1 já entregue (ver `2026-06-27-pdv-mesa-design.md`
> e `PDV-STATUS-HANDOFF.md`). Esta spec cobre a Fase 2: agrupar os pedidos de uma mesa numa
> comanda, ver total acumulado, cancelar pedido e fechar a conta. Pagamento/caixa = Fase 3
> (fora do escopo desta spec).

## 1. Objetivo

`/admin/pdv` passa a ser **mesa-aware**. Cada pedido lançado numa mesa é agrupado numa
**comanda** (uma conta aberta por mesa). O operador consegue:

- Ver quais mesas estão **ocupadas** (têm comanda aberta) e o **total acumulado** de cada uma.
- Abrir a comanda de uma mesa e ver os **pedidos lançados** (itens, status de cozinha, valor).
- **Adicionar mais itens** a uma mesa ocupada (novo pedido na mesma comanda).
- **Cancelar um pedido** errado da comanda.
- **Fechar a conta** (encerra a comanda, libera a mesa) — só fecha a conta, sem registrar
  forma de pagamento nem caixa (isso é Fase 3).

Balcão (pedido sem mesa) continua **avulso**: não cria comanda, comportamento da Fase 1 intacto.

## 2. Modelo de dados — migration `0034_comandas.sql`

Aditiva e idempotente (mesmo padrão da `0033`). Aplicada manualmente no remoto via SQL editor
do Supabase (`npm run db:setup` está quebrado neste projeto).

```sql
-- PDV Fase 2 — comandas de mesa. Aditivo e idempotente.

create table if not exists comandas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  mesa_id uuid not null references mesas(id) on delete cascade,
  status text not null default 'aberta',   -- 'aberta' | 'fechada'
  aberta_em timestamptz not null default now(),
  fechada_em timestamptz
);

create index if not exists idx_comandas_restaurante on comandas(restaurante_id);
create index if not exists idx_comandas_mesa on comandas(mesa_id);

-- No máximo 1 comanda aberta por mesa (resolve corrida do find-or-create).
create unique index if not exists comandas_mesa_aberta_unq
  on comandas (restaurante_id, mesa_id) where status = 'aberta';

-- Liga cada pedido à sua comanda (null = pedido avulso: balcão ou vitrine).
alter table pedidos add column if not exists comanda_id uuid references comandas(id);
create index if not exists idx_pedidos_comanda on pedidos(comanda_id);

alter table comandas enable row level security;

drop policy if exists comandas_tenant_rw on comandas;
create policy comandas_tenant_rw on comandas
  for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

grant select, insert, update, delete on comandas to authenticated;
```

Notas:
- O índice único parcial `comandas_mesa_aberta_unq` é a garantia central: impossível ter duas
  comandas abertas na mesma mesa. O find-or-create concorrente trata a violação de unique
  fazendo re-fetch da comanda aberta.
- `pedidos.comanda_id` nullable → pedidos antigos, vitrine e balcão ficam `null` sem migração de dados.

## 3. Camada de queries — `lib/queries/comandas.ts`

Espelha o estilo de `lib/queries/mesas.ts`. Todas recebem `admin` (service_role) e
`restauranteId` e filtram por tenant. Funções:

- `abrirOuObterComanda(admin, restauranteId, mesaId) -> Comanda`
  Find-or-create: busca comanda `aberta` da mesa; se não houver, insere. Em caso de violação
  do unique (corrida), re-busca e retorna a existente.
- `buscarComandaAberta(admin, restauranteId, mesaId) -> Comanda | null`
- `listarPedidosDaComanda(admin, restauranteId, comandaId) -> Pedido[]`
  Reaproveita `PEDIDO_SELECT`/`mapPedido` de `pedidos.ts`. Inclui cancelados (a UI os marca
  riscados); o cálculo de total ignora cancelados.
- `cancelarPedidoComanda(admin, restauranteId, pedidoId)`
  Seta `pedidos.status = 'cancelado'`. Cancelamento real: some do Kanban/cozinha e sai do
  total. Guard: só cancela pedido cujo `comanda_id` pertence a uma comanda do tenant.
- `fecharComanda(admin, restauranteId, comandaId)`
  Seta `status='fechada'`, `fechada_em=now()`. Guard: comanda precisa estar `aberta`. Não
  mexe em `pago` nem em status de cozinha dos pedidos.
- `listarMesasComEstado(admin, restauranteId) -> MesaComEstado[]`
  Junta `listarMesasAtivas` + comanda aberta de cada mesa + total acumulado (soma de
  `pedidos` não-cancelados da comanda). Alimenta a grade do PDV (ocupada/livre + total).

Tipos novos: `Comanda` (espelha as colunas), `MesaComEstado` (`Mesa & { comandaAberta: Comanda | null; total: number; qtdPedidos: number }`).

Teste unitário (`lib/queries/comandas.test.ts`) cobrindo ao menos o mapeamento de row e o
cálculo de total ignorando cancelados (padrão do `mesas.test.ts`).

## 4. Ligação na criação do pedido

`criarPedido` (`lib/queries/pedidos.ts`) e/ou a route `POST /api/admin/pdv/pedido`:

- Quando `origem==='pdv'` **e** há mesa selecionada → resolve `mesaId`, chama
  `abrirOuObterComanda`, e grava `comanda_id` no pedido criado.
- Balcão (origem pdv sem mesa) e vitrine → `comanda_id = null` (sem mudança de comportamento).

Decisão de onde linkar: preferir fazer na **route do PDV** (já roda com service_role e tem
o contexto de mesa), passando `comandaId` para `criarPedido` via campo opcional novo em
`NovoPedidoInput` (`comandaId?`), análogo a como `origem`/`mesa` foram adicionados na Fase 1.
Isso mantém `criarPedido` agnóstico (só persiste o que recebe) e a vitrine intacta.

> A grade do PDV hoje usa nome de mesa (`mesa` text). Para linkar comanda precisamos do
> `mesa_id`. A tela já carrega as mesas via `listarMesasAtivas` (têm `id`), então o PDV passa
> `mesaId` para a route junto com o `mesa` (nome, snapshot). A route resolve a comanda pelo id.

## 5. UI — `/admin/pdv`

### Grade de mesas (estado)
- Carrega via `listarMesasComEstado`. Mesa **ocupada** (comanda aberta) recebe destaque
  visual (acento + badge) e mostra o **total acumulado**. Mesa livre = aparência atual.
- Balcão continua como atalho avulso (sem estado de comanda).

### Painel da comanda (ao selecionar mesa ocupada)
- Lista de **pedidos da comanda**: cada um com seus itens, status de cozinha (badge) e valor.
  Pedido cancelado aparece riscado/esmaecido e não conta no total.
- **Total da conta** (soma dos não-cancelados).
- Ações:
  - **Adicionar itens** → volta ao fluxo de cardápio/seletor da Fase 1, lançando novo pedido
    na mesma mesa (mesma comanda via find-or-create).
  - **Cancelar pedido** → confirma → `cancelarPedidoComanda`. Pedido some do Kanban/cozinha.
  - **Fechar conta** → confirma (mostra total) → `fecharComanda`. Mesa volta a livre.

### Selecionar mesa livre
- Comportamento da Fase 1: monta pedido novo; ao lançar, a comanda é criada (find-or-create).

### Realtime
- O total da mesa e o estado (ocupada/livre) atualizam quando chega/cancela/fecha pedido,
  reusando o canal Supabase de `pedidos` já usado no Kanban. Re-fetch de `listarMesasComEstado`
  / `listarPedidosDaComanda` ao receber evento.

## 6. Regras / bordas

- **Corrida find-or-create:** índice único parcial garante 1 comanda aberta; em violação,
  re-busca.
- **Fechar comanda vazia/fechada:** bloqueado na UI (botão desabilitado se total 0 ou sem
  comanda aberta). `fecharComanda` ainda valida `status='aberta'` no servidor.
- **Cancelar último pedido:** comanda fica aberta-vazia (total 0). Mesa segue "ocupada" até
  fechar a conta ou lançar outro pedido. (Não auto-fecha — operador decide.)
- **Fechar com pedido em preparo:** permitido, com **aviso visual** no confirm (não bloqueia).
- **Pedido cancelado:** não entra no total e some do Kanban/cozinha (status `cancelado`).

## 7. Fora de escopo (Fase 3)

- Forma(s) de pagamento no fechamento, split de pagamento, `pedidos.pago=true`.
- Sessão/turno de caixa do salão (esperado x declarado x diferença).
- Relatórios de caixa no Dashboard.

## 8. Sequência de implementação (para o plano)

1. Migration `0034_comandas.sql`.
2. `lib/queries/comandas.ts` + `comandas.test.ts`.
3. `NovoPedidoInput.comandaId?` + persistência em `criarPedido`; propagar `comanda_id` em
   `PEDIDO_SELECT`/`mapPedido`/`Pedido`/`PedidoRow`.
4. Route `POST /api/admin/pdv/pedido`: resolver mesaId → `abrirOuObterComanda` → passar `comandaId`.
5. UI `/admin/pdv`: grade com estado (`listarMesasComEstado`), painel da comanda (lista,
   cancelar, adicionar, fechar conta), realtime.
6. Aplicar `0034` no remoto (manual, SQL editor do Supabase).
7. Atualizar `PDV-STATUS-HANDOFF.md` e memória.
