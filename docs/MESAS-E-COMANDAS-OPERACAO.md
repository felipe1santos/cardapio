# Mesas e Comandas — deploy, rollback e operação

Documento operacional do módulo. O desenho e as decisões estão em
`docs/superpowers/specs/2026-09-16-mesas-e-comandas-etapa-a-design.md` (fundação),
`docs/superpowers/specs/2026-09-18-mesas-e-comandas-release-candidate.md` (etapas até G) e
`docs/superpowers/specs/2026-09-18-mesas-e-comandas-fechamento.md` (caixa, regras por loja,
pedido de cancelamento, desconto %, flag no servidor, token do QR).

> **Estado em 2026-09-18:** release candidate pronta na branch
> `feature/mesas-e-comandas`. **Nada foi aplicado em produção.** As migrations
> 0057–0072 existem só localmente, nenhuma loja tem o módulo ligado, e o merge na
> `main` depende de autorização.

---

## 1. O que precisa acontecer para ir ao ar

Nesta ordem. Cada passo é reversível até o passo 4.

### Passo 0 — antes de tudo, rodar as provas locais

```bash
npx supabase start
node scripts/seguranca/servidor-local.mjs build
node scripts/seguranca/servidor-local.mjs start   # 127.0.0.1:3999, chaves LOCAIS

npx tsc --noEmit
npx vitest run
npx next lint

node scripts/seguranca/verificar-migrations.mjs        # do zero e sobre a 0056
node scripts/seguranca/verificar-rls-papeis.mjs        # RLS por papel
node scripts/seguranca/verificar-conta-sql.mjs         # funções de dinheiro
node scripts/seguranca/e2e-release-mesas.mjs           # cenário completo
node scripts/seguranca/e2e-regressao-release.mjs       # delivery, PDV, gaveta, pizza
node scripts/seguranca/e2e-checkpoint-e.mjs            # ciclo do rascunho (pede QRDIR)
node scripts/seguranca/e2e-etapa-f.mjs                 # conta em detalhe
node scripts/seguranca/e2e-garcom.mjs                  # menu e permissões do garçom
node scripts/seguranca/e2e-caixa-e-regras.mjs          # caixa, regras, cancelamento pedido, QR revogado — pela tela
node scripts/seguranca/verificar-responsivo-mesas.mjs  # 5 viewports
```

Cada suíte refaz a semente local no começo. `e2e-checkpoint-e.mjs` precisa de
`QRDIR` apontando para uma pasta com `jsqr` e `pngjs` instalados (fica fora do
`package.json` de propósito). Para aplicar uma migration nova só na stack local:
`node scripts/seguranca/aplicar-local.mjs 0072` (recusa qualquer banco que não seja
loopback e a 0054).

`servidor-local.mjs` existe porque o `.env.local` deste repositório aponta para o
**Supabase de produção**, e `next build` inlina as `NEXT_PUBLIC_*` no bundle. Buildar
sem ele gera um servidor "local" que fala com o banco real. O script resolve as chaves
pela CLI do Supabase e recusa qualquer alvo que não seja loopback.

### Passo 1 — migrations em produção

**16 arquivos, 0057 a 0072.** Em ordem, cada um na sua transação. Todos são
reaplicáveis (provado no `verificar-migrations.mjs`), então um deploy interrompido pode
ser repetido.

```bash
# Confira o estado antes: tem de estar na 0056.
psql "$DATABASE_URL" -c "select version from schema_migrations order by version desc limit 3"
```

| Arquivo | O que faz | Reverte com |
|---|---|---|
| 0057 | valores `gerente` e `garcom` no enum `papel_usuario` | **não reverte** (ver §3) |
| 0058 | `pedidos.canal` + backfill + CHECK | `alter table pedidos drop column canal` |
| 0059 | colunas de equipe, auditoria e `modulo_mesas_ativo` | drop das colunas |
| 0060 | `auth_papel()`, `auth_e_gestor()`, `auth_restaurante_id()` | restaurar as policies da 0056 |
| 0061 | policies por operação em `pedidos`/`pedido_itens` | idem |
| 0062 | policies de `mesas`/`comandas`/`clientes`/`usuarios`/auditoria | idem |
| 0063 | `mesas.token`, setor, capacidade, bloqueio | drop das colunas |
| 0064 | `sessoes_mesa`, `selecoes_mesa`, `selecao_itens` | drop das tabelas |
| 0065 | `selecoes_mesa.encerrada_em`, `pedidos.chave_idempotencia` | drop das colunas |
| 0066 | policies antigas restringidas por papel | restaurar as da 0056 |
| 0067 | conta, pagamentos, transferências (funções + `pagamentos_comanda`) | drop das funções e da tabela |
| 0068 | `chamados_mesa` + funções do chamado | drop da tabela e das funções |
| 0069 | `itens_cardapio.disponivel_delivery` / `disponivel_salao` | drop das colunas |
| 0070 | `comanda_cancelar`, `itens_transferir` com quantidade | drop/restaurar as funções |
| 0071 | `auth_modulo_mesas()`, regras do salão, caixa lê o salão, token do QR fora do navegador, travas de mesa, auditoria com papel/correlação | ver §2 — as policies e o grant por coluna voltam com o SQL da 0062/0063 |
| 0072 | desconto %, número da comanda, observação/fiado, pedido de cancelamento, transferência com motivo, fechamento encerra chamados | drop das colunas novas, da tabela `solicitacoes_cancelamento` e das funções; restaurar as funções da 0067/0070 |

**Ordem obrigatória: migrations antes do código.** O código desta branch lê colunas da
0058–0072 (`pedidos.canal`, `comandas.numero` embutido no `PEDIDO_SELECT` etc.).
Código novo sobre schema velho derruba o Kanban inteiro — a lição de 2026-07-27.

**A 0054 (frete) continua congelada e fora deste deploy.** O DDL dela já está no schema
de produção sem registro em `schema_migrations`; aplicá-la agora não é assunto desta
entrega.

### Passo 2 — código

Merge de `feature/mesas-e-comandas` na `main` e deploy pelo Coolify (o push não dispara
build; ver `project_menuzia_deploy_coolify` na memória para a URL do deployment).

**Com as migrations aplicadas e o código no ar, nada muda para nenhuma loja:**
`modulo_mesas_ativo` é `false` em todas, então o menu Mesas e Comandas não aparece,
`/mesa/[token]` responde 404 e as APIs do módulo recusam. O delivery, o PDV e a
impressão seguem idênticos.

### Passo 3 — ligar em UMA loja

O próprio dono liga em **Ajustes › Mesas › Módulo Mesas e Comandas › Ligar o módulo**
(fica auditado como `mesas.ligou_modulo`). Ninguém mais consegue: a rota exige o dono e
um trigger recusa a coluna vinda do navegador. Alternativa pelo banco, se for preciso:

```sql
update restaurantes set modulo_mesas_ativo = true where slug = '<slug-da-loja>';
```

Depois, com o dono:

1. cadastrar as mesas (nome/número, setor, capacidade) em **Mesas e Comandas**;
2. conferir **Conta e pagamentos**: taxa de serviço padrão, formas aceitas (fiado só se
   a loja trabalha com isso) e **quem pode o quê no salão** — garçom recebe? garçom
   transfere? caixa dá desconto? Os padrões seguem a matriz: garçom não recebe, caixa
   recebe e fecha, desconto é da gestão;
3. imprimir a **Folha de QR** e colar/colocar nas mesas;
4. cadastrar garçons e caixas em **Equipe** (login e senha individuais; o caixa é o
   papel **atendente**);
5. rodar um atendimento de teste de ponta a ponta antes do primeiro cliente.

### Passo 4 — as outras lojas

Uma por vez, com o dono acompanhando o primeiro turno. É aqui que a reversão deixa de
ser trivial: a partir do primeiro pedido de mesa existem comandas e pagamentos reais.

---

## 2. Plano de rollback

### Antes de qualquer loja ligar o módulo (passos 1 e 2)

**Reverter o código basta.** Volte a `main` para o commit anterior ao merge e faça o
deploy. As migrations podem ficar aplicadas: colunas e tabelas novas sem ninguém
escrevendo nelas são inertes, e todos os defaults preservam o comportamento antigo
(`modulo_mesas_ativo = false`, `taxa_servico_padrao = 0`, item nos dois canais).

O que **não** fica inerte e precisa de atenção se você reverter só o código:

- **As policies (0060–0062, 0066) ficam mais restritivas do que o código antigo
  espera.** Elas passaram a exigir papel na allowlist. As 7 contas de produção são
  todas `dono` e estão em todas as listas, então o painel antigo continua funcionando.
  Se aparecer uma conta com outro papel, ela perde acesso.
- **`pedidos.canal`** é `not null` com default `'delivery'`, e o CHECK
  `canal <> 'mesa' or comanda_id is not null` vale para inserção nova. O código antigo
  não envia `canal`, então cai no default e passa.

### O que a 0071 muda para quem ainda não usa o módulo

Mesmo com o módulo desligado em todas as lojas, a 0071 vale para o PDV e para a aba
antiga de mesas em Ajustes:

- **mesa com conta aberta não é pausada nem bloqueada** (antes deixava a conta
  pendurada) e **mesa com histórico de contas não é excluída** (antes a comanda sem
  pedido sumia em cascata). A tela explica e sugere pausar;
- taxa de serviço padrão, formas da mesa, regras do salão e a flag **não mudam mais
  pelo navegador** — só pelas rotas. Nenhuma tela de produção fazia isso pelo navegador.

Revertendo só o código, essas travas continuam (são do banco) e não atrapalham o código
antigo.

### Depois de uma loja ligar, mas sem pedido de mesa ainda

O dono desliga em **Ajustes › Mesas** (recusado se houver conta de mesa aberta), ou:

```sql
update restaurantes set modulo_mesas_ativo = false where slug = '<slug>';
```

Isso apaga o módulo da tela na hora, sem deploy: o menu desaparece, o QR para de
funcionar e as rotas recusam. Mesas cadastradas e QR impressos ficam guardados para
quando religar.

### Depois de haver comandas e pagamentos reais

**Não desligue o módulo com conta aberta.** Uma comanda aberta com o módulo desligado
fica inalcançável pela tela (o garçom não entra) mas continua existindo no banco, e o
pedido dela segue na cozinha.

A sequência segura:

1. fechar ou cancelar todas as contas abertas da loja (o cancelamento exige motivo e
   fica no histórico);
2. conferir que não sobrou nada:
   ```sql
   select m.nome, c.id, c.aberta_em
     from comandas c join mesas m on m.id = c.mesa_id
    where c.restaurante_id = '<id>' and c.status = 'aberta';
   ```
3. desligar a flag.

**Reverter as migrations 0067/0068/0070/0072 com dinheiro registrado apagaria pagamento
ou pedido de cancelamento.**
Não faça. Se o módulo precisar sair de vez depois de ter rodado, a saída é desligar a
flag e deixar o schema: o histórico financeiro tem de continuar consultável.

---

## 3. O que não reverte

**A 0057 adiciona valores ao enum `papel_usuario`.** O PostgreSQL não remove valor de
enum. Isso é inofensivo — um valor de enum que ninguém usa não faz nada — mas significa
que `gerente` e `garcom` ficam no schema para sempre. Foi decidido assim de propósito:
a alternativa (`papel` como `text` com CHECK) trocaria uma irreversibilidade por um
tipo mais frouxo em toda a base.

**Pedido já impresso não "desimprime".** Cancelamento marca `reimprimir = false` para
não sair de novo, mas o papel que já saiu da impressora é papel.

---

## 4. Rotação dos tokens do Assistente de Impressão

> **Pendência aberta, herdada do checkpoint S. NÃO executar sem coordenar com cada
> loja.** Está aqui porque o procedimento ficou pronto nesta entrega; a execução é
> uma decisão do dono do produto, loja por loja.

**Por quê:** até a 0055, `anon` conseguia ler `restaurantes.impressao_agente_token` pelo
PostgREST. A 0055 fechou o grant, mas os tokens que circularam antes disso continuam
válidos. Quem tiver copiado um deles ainda lê a fila de impressão daquela loja e pode
marcar pedido como impresso.

**Quem é afetado:** 4 lojas têm token; 3 têm o Assistente ativo hoje.

```sql
-- Inventário, para saber com quem falar.
select slug, nome,
       impressao_agente_token is not null as tem_token,
       impressao_agente_visto_em          as ultimo_heartbeat
  from restaurantes
 where impressao_agente_token is not null
 order by impressao_agente_visto_em desc nulls last;
```

**Por que não é automático:** rodar o token **derruba o Assistente daquela loja na
hora**. Ele precisa ser pareado de novo, no PC da loja, por alguém que esteja lá. Fazer
isso em lote, sem avisar, significa quatro restaurantes sem imprimir pedido no meio do
almoço.

**Procedimento, uma loja por vez:**

1. Combine o horário com a loja — fora do pico, com alguém no PC.
2. Confirme que o Assistente está rodando lá (o painel mostra a impressora conectada em
   **Ajustes › Impressão**).
3. No painel, em **Ajustes › Impressão**, gere um token novo.
4. No PC da loja, cole o token novo no Assistente e pareie.
5. Imprima um pedido de teste (a reimpressão de um pedido antigo serve).
6. Confirme a chegada do heartbeat:
   ```sql
   select slug, impressao_agente_visto_em from restaurantes where slug = '<slug>';
   ```
7. Só então passe para a próxima loja.

Se a loja não atender ou o Assistente estiver fora do ar, **não rode o token**: sem
alguém no PC, a loja fica sem impressão até a próxima visita.

**O token de QR de mesa não tem nada a ver com isso.** São coisas diferentes:
`mesas.token` é o código público do QR (rotacionável pela tela de mesas, sem afetar
impressão), e `restaurantes.impressao_agente_token` é a credencial do agente desktop.

---

## 5. Operação do dia a dia

### Ligar e desligar mesa

- **Bloquear** tira a mesa de operação sem apagar nada (mesa quebrada, em reforma). O
  QR dela passa a responder 404.
- **Desativar** arquiva a mesa. O cadastro, as comandas e os pedidos continuam ligados
  a ela — nada é excluído.
- As duas ações **recusam mesa com conta aberta**. Feche, transfira ou cancele a conta
  primeiro.

### QR de mesa

- **Copiar link** e **Baixar PNG** para uma mesa; **Folha de QR** imprime todas de uma
  vez, uma etiqueta por mesa (cada uma com o seu código).
- **Gerar novo** revoga o QR atual **na hora**: o adesivo que está na mesa para de
  funcionar. Use quando o código vazou (foto na internet, cliente que salvou o link) ou
  quando o material foi reimpresso. Só a gestão faz isso, e fica auditado.
- **Revogar sem gerar outro**: a mesa fica sem QR válido até a gestão gerar um novo. O
  salão mostra "QR revogado — gere um novo" e a folha A4 pula a mesa.
- O link só aparece para a gestão: garçom e caixa não leem o token nem pela tela nem
  pelo banco.

### Caixa (papel atendente)

Entra em **Mesas e Comandas**, vê as mesas ocupadas com o número da comanda e abre
**Ver conta**: registra pagamentos (Pix, cartão, dinheiro com troco, vale), divide por
pessoa ou por item e fecha a conta. Não lança pedido, não atende chamado, não estorna,
não pendura (fiado) e só dá desconto se o dono ligar a regra.

### Pedido de cancelamento

O garçom não cancela o que já foi para a cozinha: toca o **×** do item (ou "Pedir
cancelamento" do lançamento), escreve o motivo e a gestão vê o bloco **Pedido de
cancelamento aguardando** na conta, com **Aprovar** e **Recusar**. Enquanto houver pedido
pendente a conta **não fecha**.

### Taxa, desconto e fiado

- **Cliente recusou a taxa** e **Restaurar taxa** ficam na própria conta; o fechamento
  registra se a taxa foi aceita, removida ou alterada.
- Desconto em **R$** ou **%**; o percentual acompanha a conta se um item for cancelado.
  Sempre com motivo.
- **Fiado** só com a gestão e com o nome/contato de quem fica devendo.
- Nada disso deixa o total abaixo do que já foi pago: nesse caso a tela pede o estorno
  antes.

### Quando algo não bate na conta

A conta é sempre recalculada pelo banco a partir dos itens não cancelados
(`comanda_totais`), nunca por um total guardado. Se um valor parecer errado:

1. **Histórico** da mesa mostra quem fez o quê e quando;
2. **/admin/auditoria** mostra a loja inteira, com filtro por assunto;
3. cancelamento de item e de lançamento exigem motivo e ficam registrados;
4. pagamento errado vira **estorno** (com motivo), nunca exclusão.

### Cliente não consegue abrir o QR

Por ordem de probabilidade:

1. o módulo está desligado na loja (`modulo_mesas_ativo`);
2. a mesa está bloqueada ou desativada;
3. o QR foi rotacionado e o adesivo é o antigo;
4. o adesivo é de outra loja.

Todos os quatro respondem **404 igual**, de propósito: responder diferente transformaria
a rota em um oráculo para descobrir mesas e lojas.

---

## 6. Usuários de teste do ambiente local

Criados por `node scripts/seguranca/semear-demo-mesas.mjs`. Senha de todos:
`demo-local-123456`.

| Login | Papel | Para quê |
|---|---|---|
| `dono.local` | dono | acesso integral |
| `garcom.local` | garcom | salão, chamados, lançamento, pedido de cancelamento |
| `atendente.local` | atendente | delivery e caixa do salão — recebe e fecha, não lança |
| `dono.vizinha` | dono (outra loja) | prova de isolamento entre inquilinos |

Lojas: `cantina-demo` (módulo ligado, 6 mesas) e `vizinha-demo` (existe só para as
tentativas de acesso cruzado falharem).

URLs locais: painel em `http://127.0.0.1:3999/admin/mesas`, vitrine em
`/loja/cantina-demo`, mesa em `/mesa/<token>` (o token sai da tela de QR ou de
`select nome, token from mesas`).
