# Mesas e Comandas — release candidate

Fecha o módulo. A fundação (papéis, RLS, feature flag, QR, seleção do cliente, painel do
garçom) está em `2026-09-16-mesas-e-comandas-etapa-a-design.md`; a conta, os pagamentos
e as transferências vieram na etapa F. Este documento registra **o que faltava e as
decisões tomadas para fechar**, com o porquê de cada uma.

Branch: `feature/mesas-e-comandas`. Migrations novas: **0068, 0069, 0070**.
Operação (deploy, rollback, rotação de token): `docs/MESAS-E-COMANDAS-OPERACAO.md`.

---

## 1. Catálogo único (0069)

**O risco real não era técnico, era de produto:** a saída fácil para "o combo não faz
sentido no salão" é criar uma tabela de cardápio de mesa. No dia em que isso acontece o
dono cadastra o mesmo hambúrguer duas vezes, e as duas cópias divergem na primeira troca
de preço.

Mesa, delivery e balcão leem as MESMAS linhas de `itens_cardapio`, `grupos_cardapio`,
`item_complementos`, `grupos_item_complementos`, `tamanhos_item` e `pizza_sabores`. O
que varia por canal é só **se o item aparece**, e isso são duas colunas no próprio item:

```sql
disponivel_delivery boolean not null default true
disponivel_salao    boolean not null default true
check (disponivel_delivery or disponivel_salao)
```

**Defaults `true` nas duas**, e o CHECK impede item fora dos dois canais (quem quer tirar
do ar usa `status`, o controle de sempre). Nenhuma loja existente perde item nem muda de
comportamento por causa da migration.

**O balcão segue o salão.** Dar ao PDV uma terceira coluna obrigaria o dono a marcar três
caixinhas por item sem nenhum caso de uso real pedindo isso. Balcão e mesa são a mesma
decisão comercial: atendimento presencial.

`lib/canais-item.ts` é o lugar único da regra. `lib/queries/catalogo-unico.test.ts` é a
guarda arquitetural: falha se alguma migration criar `itens_mesa`/`cardapio_salao`, se
uma tela fizer o seu próprio `SELECT` em `itens_cardapio`, ou se uma superfície do salão
parar de filtrar por canal.

**Preço é sempre do servidor.** A seleção pública reprecifica pelo catálogo antes de
gravar (o rascunho não pode exibir preço inventado para o garçom), e `criarPedido`
reprecifica de novo no lançamento oficial, agora também conferindo o canal — aba aberta
antes da mudança e POST direto não furam a regra.

---

## 2. Loja fechada para delivery não fecha o salão

`criarPedido` recusava qualquer pedido com a loja fora do horário. Isso está certo para a
vitrine: é o que impede o cliente de pedir de casa às 4h. **Mesa é funcionário
autenticado dentro da loja** — se o dono pausou o delivery porque a cozinha está cheia, o
salão continua servindo.

Então `canal === 'mesa'` não passa mais por `lojaEstaAberta`. O **balcão continua
passando**, exatamente como antes: mexer nele mudaria o comportamento de quem já usa o
PDV, e não havia pedido para isso.

---

## 3. Chamar garçom (0068)

Botão de verdade, não decorativo. `chamados_mesa` tem ciclo
`pendente → assumido → concluído`, ligado à mesa e à sessão, e **não cria pedido,
comanda nem movimento financeiro**.

**Por que as três transições são funções do banco:** dois garçons veem o mesmo aviso ao
mesmo tempo, então "assumir" é uma corrida. `update ... where status = 'pendente'`
resolve: o segundo recebe `ja_assumido` com o nome de quem pegou, em vez de sobrescrever.

**Anti-spam estrutural, não visual:**

| Trava | Como |
|---|---|
| dois chamados abertos na mesma mesa | índice único parcial `(mesa_id, motivo) where status in ('pendente','assumido')` |
| dez toques seguidos | carência de 45 s entre um chamado concluído e o próximo do mesmo motivo → 429 com o tempo de espera |
| chamado que ninguém concluiu | expira em 30 min e libera a mesa para chamar de novo |
| toque repetido com chamado em pé | devolve o chamado que já existe (`jaExistia: true`) — para o cliente é "já avisamos", não erro |

Nada disso depende de desabilitar botão na tela. A tabela entra na publicação do
Realtime; o salão escuta, com releitura periódica como reserva
(`lib/realtime-fallback.ts`).

---

## 4. Cancelar a conta e transferir parte de uma linha (0070)

**Cancelar comanda** não existia — só item e lançamento. Mesa aberta por engano ou
cliente que desistiu antes de consumir obrigava a "fechar com R$ 0,00", registrando uma
venda que não houve. Agora `cancelada` é um estado: motivo obrigatório, autor gravado,
lançamentos derrubados pelo caminho de sempre (saem do Kanban, não reimprimem), mesa
liberada, nada apagado. **Conta que já recebeu dinheiro é recusada** — quem quer cancelar
estorna primeiro, e o estorno fica registrado.

**Transferência parcial:** `itens_transferir` movia a linha inteira, então "3 Cocas, leva
1 para a mesa 5" exigia cancelar e relançar, o que apaga o histórico de quem pediu o quê.
Agora aceita quantidade por linha: a de origem diminui, nasce uma cópia no destino com o
mesmo preço, complementos e observação, e os dois pedidos são recalculados. O pedido de
destino nasce `impresso = true` porque aquele prato **já foi produzido**.

### Detalhe que custou tempo

A primeira versão montava o plano da transferência numa tabela temporária e a limpava com
`delete from _mov`. O banco roda com a trava que exige `WHERE` em `DELETE` (supautils), e
a função estourava em tempo de execução — com a tela mostrando só "Não foi possível
concluir a operação.", porque o erro cru não aparecia em lugar nenhum.

Duas correções: o plano passou a viver em **arrays paralelos** (sem limpeza, sem depender
de `search_path`), e o helper de RPC da conta passou a **logar a mensagem crua** do banco.
Falha inesperada de função virando frase genérica sem rastro é o tipo de coisa que custa
uma hora na próxima vez.

---

## 5. `/api/pedidos/[id]/notificar`

A rota não tinha autenticação nenhuma. Com o UUID de um pedido, qualquer um de fora
mandava mensagem no WhatsApp do cliente da loja, quantas vezes quisesse. O comentário no
arquivo dizia que não era vetor de abuso porque o motor de fidelidade reconfere o status
— verdade para a fidelidade, mas a mensagem saía do mesmo jeito.

**Inventário antes de mexer.** Só telas do painel já autenticadas chamam esta rota, via
`lib/notificar.ts`, com o cookie da sessão: `/admin/pedidos`, `/admin/logistica` e
`components/pedidos/rota-panel.tsx`. Cozinha, entregador, vitrine e o webhook do Nexta
chamam `notificarPedido` direto no servidor, com token próprio, e não passam por aqui.

Três camadas: sessão válida; pedido da **mesma loja** da sessão (404 igual para
inexistente e para alheio, sem virar oráculo); e allowlist **por canal do pedido** —
quem pode mover o pedido daquele canal pode avisar o cliente dele.

| Canal | Quem pode notificar |
|---|---|
| `delivery` | `pedidos.delivery.avancar` ou `logistica.operar` → dono, gerente, atendente, logística |
| `mesa` | `pedidos.mesa.ver` → dono, gerente, garçom, cozinha |
| `balcao` | `pedidos.balcao.criar` → dono, gerente, atendente |
| desconhecido | ninguém, nem o dono |

---

## 6. Pedido de salão na cozinha e no Kanban

As telas olhavam só `origem === 'pdv'` e escreviam "PDV · Mesa 4". Pedido de mesa não vem
do PDV: vem do painel do garçom, é outro posto de trabalho e outro fluxo. Com salão e
balcão escritos igual, quem lê o card não sabe se o prato vai para uma mesa ou para o
balcão — e é justamente isso que decide o destino.

`lib/pedido-origem.ts` resolve o rótulo em um lugar só: **"Salão · Mesa 4 · Ana"** com cor
própria, ou "PDV · Balcão", ou nada (delivery, cuja tela já é sobre entrega).

**O recibo não foi tocado.** Ele já imprime `MESA X` quando `origem = 'pdv'` e há nome de
mesa (`printer-agent/src/recibo.js`), e a folha é protegida (CLAUDE.md §7). Pedido de mesa
mantém `origem = 'pdv'` exatamente para continuar caindo nesse caminho.

---

## 7. QR revogável e estado da mesa

O botão "Gerar novo" estava desabilitado com "Em breve". Agora roda o token por
`/api/admin/mesas/[id]/estado`, que:

- exige **`mesas.gerenciar`** (garçom não roda QR);
- encerra as sessões e os rascunhos abertos da mesa, para o celular que estava no token
  antigo não seguir gravando numa sessão inalcançável;
- grava auditoria **sem o token dentro** — trilha com credencial é vazamento com carimbo
  de data;
- confirma antes, explicando que o adesivo na mesa para de funcionar na hora.

Bloquear e desativar saíram do `update` client-side pela mesma rota, e agora **recusam
mesa com conta aberta** (409 `comanda_aberta`), em vez de deixar comanda pendurada numa
mesa fora de operação. As quatro transições ficam auditadas com estado anterior e novo.

A **folha A4** imprime uma etiqueta por mesa, cada uma com o seu QR — o componente do QR
de cardápio passou a aceitar QR por etiqueta em vez de repetir o mesmo para a loja toda.

---

## 8. Auditoria consultável

A trilha já era gravada e já tinha permissão própria (`auditoria.ver`), mas não havia
tela: só dava para ler o histórico de UMA conta, dentro da mesa. "Quem cancelou aquele
item ontem?" não tinha resposta em lugar nenhum.

`/admin/auditoria` lista os eventos da loja com filtro por assunto e busca, lendo **sob a
RLS** (a policy exige `auth_e_gestor()`, então a loja é filtrada pelo banco, não pelo
código da tela).

`lib/queries/auditoria.test.ts` varre o código e as migrations procurando as ações
realmente gravadas e **cobra rótulo em português para cada uma** — senão a tela mostraria
`conta.cancelou_comanda` para o dono.

Dois eventos que faltavam: **`mesa.abriu`** (o marco de quando a mesa entrou em operação e
por quem — só na comanda que nasceu agora, não em quem perdeu a corrida do
find-or-create) e o **responsável operacional** da comanda.

---

## 9. Indisponibilidade no envio, item por item

`criarPedido` já recusava item indisponível, mas estourando um `Error` com o nome no
texto: o garçom leria "Item X não está disponível" e não saberia qual linha tirar.

O envio agora confere disponibilidade **antes de criar qualquer coisa** e devolve a lista
de linhas travadas, com o motivo de cada uma (saiu do cardápio / pausado ou esgotado /
não é servido hoje / não é vendido no salão). A tela marca só as recusadas em vermelho e
**preserva o resto do lançamento** — o cliente marcou no celular e o prato pode ter
esgotado nesse meio-tempo.

**400 quando o id nem existe** (corpo inválido: o navegador mandou algo que nunca foi
cardápio) e **409 quando o item existe mas saiu do ar** (conflito de estado, com a lista).

---

## 10. Responsividade: o painel era desktop-only

O garçom trabalha com o telefone na mão, e a sidebar de 240px era coluna fixa: num
aparelho de 360px sobravam **120px de conteúdo**. Abaixo de `lg` ela passa a ser gaveta,
aberta por um botão na barra de topo e fechada ao navegar; a partir de `lg` nada muda.

Fechada, ela é `invisible` e não só deslocada — senão continuaria no caminho do Tab e do
leitor de tela.

**Alvos de toque:** o botão da Menuzia é baixo por identidade (11px, caixa alta, ~27px),
o que num celular fica abaixo do que o dedo acerta. Abaixo de `lg` ele ganha 40px de
altura mínima e volta ao natural no desktop.

### Armadilha que vale registrar

O root font-size do painel é **87,5% (14px)**, então a escala rem do Tailwind encolhe:
`h-10` dá 35px e `h-11` dá 38,5px. **Altura de alvo de toque tem de ser em px.** Metade
das correções da primeira rodada não pegaram por isso.

`scripts/seguranca/verificar-responsivo-mesas.mjs` foi o que provou: em 360×800, 390×844,
768×1024, 1024×768 e desktop mede rolagem horizontal da página, elemento mais largo que a
tela, alvo de toque, texto miúdo e se modal e gaveta caem dentro da viewport — mais nome
acessível de todo controle, `alt` de imagem, foco pelo Tab e os papéis `aria` das escolhas
obrigatórias.

**Indicador de progresso no celular:** a trilha de etapas do configurador só existia a
partir de 700px. No celular ninguém sabia em que passo estava nem quantos faltavam. A
faixa de progresso mostra a mesma informação (passo atual, concluídos, quais dos que
faltam são obrigatórios), permite voltar a uma etapa já vista e **não** pular para a
frente — a obrigatória seria burlada.

---

## 11. Matriz de permissões

Sem mudança na fundação. O que esta entrega acrescentou:

| Permissão | dono | gerente | garcom | atendente | cozinha | logistica |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| chamados: ver e atender (`mesas.operar`) | ✅ | ✅ | ✅ | — | — | — |
| QR e estado da mesa (`mesas.gerenciar`) | ✅ | ✅ | — | — | — | — |
| cancelar a conta (`pedidos.mesa.cancelar`) | ✅ | ✅ | — | — | — | — |
| transferir item com quantidade (`comanda.transferir`) | ✅ | ✅ | ✅ | — | — | — |
| ler a auditoria (`auditoria.ver`) | ✅ | ✅ | — | — | — | — |
| notificar cliente de delivery | ✅ | ✅ | — | ✅ | — | ✅ |
| notificar cliente de mesa | ✅ | ✅ | ✅ | — | ✅ | — |

Toda página, rota e função do banco confere de novo: menu escondido é conforto, não
autorização. As funções de dinheiro e de chamado são `security definer` com
`revoke execute from public, anon, authenticated` e `grant` só ao `service_role`.

---

## 12. O que foi provado, e como

| Suíte | Verificações | Cobre |
|---|---|---|
| `vitest run` | 861 | unitários e guardas arquiteturais |
| `verificar-migrations.mjs` | 43 | do zero e sobre a 0056, com reaplicação |
| `verificar-rls-papeis.mjs` | 50 | RLS por papel, cross-tenant, desativação |
| `verificar-conta-sql.mjs` | 43 | funções de dinheiro direto no banco |
| `e2e-release-mesas.mjs` | 203 | cenário completo em 30 passos, chamados, canal, QR, concorrência, tenants |
| `e2e-regressao-release.mjs` | 50 | delivery, PDV, gaveta, Pizza do Rosa, notificar por perfil |
| `e2e-checkpoint-e.mjs` | 90 | ciclo do rascunho, idempotência, URL proibida, equipe |
| `e2e-etapa-f.mjs` | 128 | conta, pagamentos, transferências, permissões |
| `e2e-garcom.mjs` | 47 | menu e permissões do garçom, campos internos |
| `verificar-responsivo-mesas.mjs` | 169 | 5 viewports + acessibilidade mínima |

**Concorrência com requisições de verdade, não com botão desabilitado:** dois pagamentos
do mesmo restante em paralelo (um passa), dois fechamentos (uma comanda fechada), dois
lançamentos na mesma mesa livre (uma comanda só, pelo índice único parcial), duas
transferências do mesmo item (a linha não duplica), cliente alterando o rascunho enquanto
o garçom envia (a versão nova não é apagada).

---

## 13. Pendências

| Pendência | Classificação | Nota |
|---|---|---|
| Rotação dos tokens do Assistente de Impressão (4 lojas) | **dependência externa** | Procedimento pronto em `MESAS-E-COMANDAS-OPERACAO.md` §4. Rodar o token derruba o Assistente na hora: precisa de alguém no PC de cada loja. |
| Saída física da impressora | **dependência externa** | Fila e protocolo do agente testados de ponta a ponta (entra uma vez, sai ao imprimir, reconexão não reimprime, reimpressão volta à fila). **Papel saindo da impressora não foi verificado** — não há impressora térmica no ambiente local. |
| Migrations 0057–0070 em produção | **bloqueada por autorização** | Prontas e provadas localmente. Nenhuma aplicada. |
| Merge na `main` e deploy | **bloqueada por autorização** | Release candidate na branch. |
| 0054 (frete) | **fora de escopo** | Congelada. O DDL já está em produção sem registro em `schema_migrations`. |
| Validade comercial em `restaurantes` | **baixa** | Hoje ela deriva de existir um `dono` válido. Dívida anotada na etapa A, sem impacto operacional. |
| Item grátis de fidelidade no gating por horário | **baixa** | Herdado de 2026-07-23, sem relação com mesas. |
