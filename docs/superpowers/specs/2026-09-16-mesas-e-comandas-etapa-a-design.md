# Mesas e Comandas — Etapa A: fundação de identidade, permissões e RLS

Spec definitivo, aprovado em 2026-09-16. Branch: `feature/mesas-e-comandas`.

## Contexto que manda no desenho

**O painel admin não tem camada de servidor.** Todas as páginas `/admin/*` são
`'use client'` e chamam `lib/queries/*` com o client Supabase do navegador, usando o
JWT do usuário. As 22 rotas `/api/admin` cobrem só ações pontuais. **A autorização de
hoje é 100% RLS.** Guard de rota protege quase nada: um garçom com três linhas de
`supabase-js` no console leria todo o delivery se a policy deixasse.

Por isso a etapa A é, antes de tudo, uma etapa de RLS.

**Estado dos papéis:** enum `papel_usuario = ('dono','atendente','cozinha','logistica',
'entregador')`, e `papel` **nunca é lido para autorizar** em lugar nenhum do código.
Os 7 usuários de produção são todos `dono`. Não existe tela de equipe.

**Checkpoint S** (migrations 0055/0056) já está aplicado em produção: `anon` perdeu o
SELECT de tabela em `restaurantes` (token do Assistente de Impressão fechado) e as
policies de INSERT anônimo em `pedidos`/`pedido_itens` foram derrubadas. As migrations
desta etapa começam em **0057**.

## Fluxo presencial — definitivo

1. Cliente escaneia o QR da mesa e abre `/mesa/[token]`.
2. Navega pelo cardápio, configura produtos e **marca itens**.
3. Vê um **resumo no próprio celular**. Isso é uma lista visual, nada mais.
4. Mostra ou fala os itens ao garçom.
5. **O garçom seleciona manualmente** os produtos na interface dele.
6. Aperta **Enviar para a cozinha** — só essa ação cria pedido oficial.
7. O pedido entra na comanda da mesa e vai para o pipeline de impressão existente.
8. A cozinha roda o fluxo dela: recebido → preparando → pronto.
9. **O garçom serve a mesa e não registra entrega.** Não existe `pronto → entregue`
   pelo garçom, nem estado operacional de "entregue pelo garçom".

O cliente no QR **nunca**: envia pedido, acessa pagamento, escolhe entrega/retirada,
informa endereço, calcula frete, dispara WhatsApp, movimenta estoque, manda algo para a
cozinha, cria comanda ou altera pedido oficial. A seleção **não é importada
automaticamente** pelo garçom.

## Permissões — por canal, menor privilégio

| Permissão | dono | gerente | garcom | atendente | cozinha¹ | logistica¹ | entregador¹ |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `pedidos.delivery.ver` | ✅ | ✅ | — | ✅ | — | ✅ | — |
| `pedidos.delivery.criar` | ✅ | ✅ | — | ✅ | — | — | — |
| `pedidos.delivery.avancar` | ✅ | ✅ | — | ✅ | — | ✅ | — |
| `pedidos.delivery.cancelar` | ✅ | ✅ | — | ✅ | — | — | — |
| `pedidos.mesa.ver` | ✅ | ✅ | ✅ | — | ✅ | — | — |
| `pedidos.mesa.criar` | ✅ | ✅ | ✅ | — | — | — | — |
| `pedidos.mesa.enviar_cozinha` | ✅ | ✅ | ✅ | — | — | — | — |
| `pedidos.mesa.cancelar` | ✅ | ✅ | — | — | — | — | — |
| `pedidos.balcao.criar` (PDV) | ✅ | ✅ | **—** | ✅ | — | — | — |
| `cozinha.pedidos.ver` | ✅ | ✅ | — | — | ✅ | — | — |
| `cozinha.pedidos.atualizar_status` | ✅ | ✅ | — | — | ✅ | — | — |
| `mesas.operar` | ✅ | ✅ | ✅ | — | — | — | — |
| `mesas.gerenciar` (QR, token) | ✅ | ✅ | — | — | — | — | — |
| `comanda.fechar` | ✅ | ✅ | ✅ | — | — | — | — |
| `comanda.transferir` | ✅ | ✅ | ✅ | — | — | — | — |
| `comanda.desconto` | ✅ | ✅ | — | — | — | — | — |
| `clientes.ver` | ✅ | ✅ | **—** | ✅ | — | — | — |
| `dashboard.faturamento` | ✅ | ✅ | — | — | — | — | — |
| `cardapio.editar` | ✅ | ✅ | — | — | — | — | — |
| `campanhas.gerenciar` | ✅ | ✅ | — | — | — | — | — |
| `fidelidade.gerenciar` | ✅ | ✅ | — | — | — | — | — |
| `logistica.operar` | ✅ | ✅ | — | — | — | ✅ | — |
| `auditoria.ver` | ✅ | ✅ | — | — | — | — | — |
| `integracoes.gerenciar` | ✅ | — | — | — | — | — | — |
| `ajustes.editar` | ✅ | — | — | — | — | — | — |
| `equipe.gerenciar` | ✅ | ✅ | — | — | — | — | — |

¹ Sem login no painel nesta etapa (portais por token). A linha documenta o conjunto que
valeria; a tela de Equipe não oferece esses papéis.

Nenhuma célula fica vazia por omissão: `—` é negação explícita, e o teste de paridade
reprova papel novo sem decisão.

**Garçom, explicitamente:** sem `balcao.criar` (não entra no PDV), sem `clientes.ver`,
sem nenhuma `delivery.*`, sem faturamento, sem auditoria, e **sem `avancar`/`entregar`**
— ele cria e envia; quem prepara é a cozinha.

## Papéis oferecidos na tela de Equipe

| Quem | Cria | Edita/desativa | Nunca |
|---|---|---|---|
| dono | gerente, garcom, atendente | gerente, garcom, atendente | criar outro dono |
| gerente | garcom, atendente | garcom, atendente | gerente, dono |

`cozinha`, `logistica` e `entregador` **não aparecem** enquanto forem por token; os
valores seguem no enum por compatibilidade.

Travas, na função pura e testadas: ninguém desativa a própria conta · gerente não toca em
nível igual ou superior · a loja nunca fica sem administrador (bloqueia desativar ou
rebaixar o último usuário ativo com `equipe.gerenciar`) · usuário desativado nunca é
apagado · a redefinição de senha não grava a senha em lugar nenhum.

## Migrations (0057+)

- **0057** — `alter type papel_usuario add value 'gerente'` e `'garcom'`. Sozinha no
  arquivo: o runner roda cada migration em `begin/commit` e o Postgres não deixa usar um
  valor de enum na mesma transação em que ele foi criado.
- **0058** — `pedidos.canal text not null default 'delivery' check (canal in
  ('delivery','mesa','balcao'))`, backfill determinístico (`origem='pdv'` + `comanda_id`
  → `mesa`; `origem='pdv'` sem comanda → `balcao`; resto → `delivery`) e
  `check (canal <> 'mesa' or comanda_id is not null)`. `canal` fica fora de todo grant de
  escrita do navegador: é definido só no servidor.
- **0059** — funções `auth_papel()`, `auth_e_gestor()`, `auth_loja_valida(uuid)` e o novo
  `auth_restaurante_id()`, todas `security definer`, `set search_path = public`, objetos
  qualificados, sem SQL dinâmico, `revoke execute from public` + grant só a
  `authenticated`.
- **0060** — policies por operação em `pedidos` e `pedido_itens` + grants de UPDATE por
  coluna.
- **0061** — policies por operação em `mesas`, `comandas` e `clientes`.
- **0062** — `usuarios` com grants por coluna, `eventos_auditoria` append-only,
  `usuarios.desativado_em`, `usuarios.criado_por`, `pedidos.criado_por`,
  `pedidos.criado_por_nome` e `restaurantes.modulo_mesas_ativo boolean default false`.

**Nada de `FOR ALL` em tabela crítica.** Cada operação tem policy própria, e toda policy
usa **allowlist de papéis**, nunca `<> 'garcom'` — papel novo não herda acesso.

Operações que passam a exigir endpoint/RPC com `service_role`: cancelar pedido ou item,
alterar preço/desconto/total, mudar status fora da transição válida, transferir comanda,
fechar conta, registrar pagamento, revogar QR, configurar mesa, excluir pedido.

### Validade da loja, determinística

> A loja é válida ⟺ **existe pelo menos um** usuário `papel='dono'`, `autorizado`,
> `desativado_em is null` e (`acesso_expira_em is null` ou no futuro).

Sem `.single()`, sem ambiguidade. Zero donos → ninguém entra. Vários donos → basta um
válido. `auth_restaurante_id()` devolve `null` quando o usuário está desativado, não
autorizado, ou a loja não é válida — e como **toda policy do sistema deriva dessa
função**, a desativação corta acesso a tudo, inclusive consulta direta pelo PostgREST e
Realtime, na requisição seguinte. Dívida anotada: mover a validade comercial para
`restaurantes`.

## Feature flag

`restaurantes.modulo_mesas_ativo boolean not null default false`. Governa **só a
superfície nova** (seção Mesas e Comandas, `/mesa/[token]`, painel do garçom). **O PDV
atual não a consulta** e segue funcionando com a flag em `false` — a loja que já usa
mesas pelo PDV (13 mesas, comandas abertas) não pode perceber diferença. Sem backfill
"esperto": ninguém nasce com o módulo ligado.

## Isolamento

Preservados integralmente: `/loja/[slug]`, checkout de delivery, retirada, modo gaveta,
Pizza do Rosa, clientes atuais, PDV, impressão, recibo e integrações. A rota
`/mesa/[token]` e o painel novo nascem separados e **não reutilizam a lógica de checkout
do delivery** — só o catálogo (produtos, fotos, adicionais, preços) como fonte de dados.

## Commits da etapa A

| # | Commit |
|---|---|
| A1 | `feat(auth): matriz de permissões por canal` — módulo puro + testes, sem consumidor |
| A2 | `feat(db): papéis de gerente e garçom` — 0057 |
| A3 | `feat(db): canal do pedido como discriminador confiável` — 0058 |
| A4 | `feat(db): funções de sessão, papel e validade da loja` — 0059 |
| A5 | `feat(db): policies por operação em pedidos e itens` — 0060 |
| A6 | `feat(db): policies por operação em mesas, comandas e clientes` — 0061 |
| A7 | `feat(db): usuarios por coluna, auditoria append-only e flag do módulo` — 0062 |
| A8 | `test(rls): paridade entre a matriz e o banco` — stack local, por papel |
| A9 | `feat(auth): guard de permissão nas rotas /api/admin` |
| A10 | `feat(auth): bloqueio server-side de URL administrativa` — `middleware.ts` |
| A11 | `feat(equipe): dono e gerente administram a equipe` |
| A12 | `feat(auth): login revalida papel, desativação e validade da loja` |
| A13 | `feat(admin): menu filtrado por permissão` |
| A14 | `feat(db): rastreabilidade de quem lançou o pedido` |

## Testes

Unitários puros: matriz papel × permissão célula a célula; `papeisQuePodeGerenciar`;
travas da equipe; `acessoValido` com loja vencida.

RLS com Supabase local (Auth + PostgREST + Realtime), um JWT por papel, batendo direto no
PostgREST: garçom só enxerga `canal='mesa'`; `clientes`/`campanhas`/`fidelidade`/
`auditoria` negados; UPDATE de `total`/`desconto`/`pago` negado por grant de coluna;
INSERT/DELETE em `pedidos` negado; `usuarios` sem `email`/`telefone`/`autorizado`;
cross-tenant vazio; desativado perde acesso com o JWT já emitido; os 5 casos de validade
de loja; Realtime não entrega pedido de delivery ao garçom.

Paridade: o teste itera todas as combinações da matriz TypeScript e exige que app e banco
concordem nos dois sentidos.

Regressão: suíte inteira verde, `tsc --noEmit` limpo, checkout/Kanban/PDV/impressão
inalterados.

## Critérios de aceite

1. `pode()` cobre os 7 papéis × todas as permissões, com teste por linha.
2. Nenhuma rota `/api/admin/**` responde 2xx sem a permissão correspondente.
3. URL administrativa direta é barrada no servidor.
4. Garçom não lê pedido de delivery, cliente, endereço, telefone nem faturamento —
   provado por **consulta direta com `supabase-js`**, não só pela UI.
5. Realtime de garçom não entrega evento de delivery.
6. Funcionário desativado perde acesso na requisição seguinte, inclusive no PostgREST.
7. Ninguém sem `auditoria.ver` lê `eventos_auditoria`; nenhum autenticado escreve nela.
8. `select` em `usuarios` pelo cliente não devolve `email`, `usuario`, `telefone`,
   `autorizado` nem `acesso_expira_em`.
9. Login duplicado ou ambíguo é impossível (índice único global já existente na 0038).
10. `cozinha`, `logistica` e `entregador` não aparecem na criação de equipe.
11. `modulo_mesas_ativo` existe, default `false`, e **o PDV funciona igual com ela em
    `false`**.
12. Loja sem dono válido bloqueia todo mundo; os 5 casos têm teste.
13. Migrations rodam do zero em ambiente descartável; 0057–0062 são reaplicáveis.
14. Nenhuma migration da feature vai para produção; nenhum deploy.

## Pendências registradas fora desta etapa

- **Checkpoint S**: correções aplicadas, vitrines carregando, token protegido, inserção
  anônima bloqueada, testes automatizados aprovados. **Checkout completo, Kanban e
  impressão física seguem como validação pendente** — não bloqueiam o desenvolvimento
  local deste módulo.
- **Rotação dos tokens do Assistente de Impressão**: 4 lojas com token, 3 com assistente
  ativo. Uma loja por vez, com alguém no PC dela.
- **Resgate de fidelidade por telefone**: checkpoint de segurança próprio, antes do
  próximo deploy geral.
- **0054 (frete)**: congelada. O DDL já está no schema de produção sem registro em
  `schema_migrations`.
- **Validade comercial** deveria morar em `restaurantes`, não numa linha de dono.
