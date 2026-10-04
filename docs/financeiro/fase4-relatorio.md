# Financeiro Fase 4 — Fluxo de Caixa + correção "entrega paga não quita a comanda" (2026-10-04)

Regras de cálculo da tela: [fase4-fluxo.md](fase4-fluxo.md). Migration **0140** (rollback em
`docs/rollback/0140_fluxo_caixa_e_comanda_entrega.down.sql`).

## Parte 0 — Bug: entrega paga não quitava a comanda do PDV
**Causa.** A correção de 03/10 (0137) só fechava a comanda quando o pagamento era registrado **na entrega** (motoboy
ou operador, em dinheiro ou cartão). Ficava aberta, com restante R$ 0,00, quando:
- a conta tinha sido paga **no PDV** antes de sair: o registro da entrega via "já pago" e pulava a quitação;
- foi paga no PDV **depois** de entregue;
- o pedido foi marcado entregue pela Logística ou pelo Kanban, sem registro.

**Reprodução com dados TESTE (local):** 4 cenários com a comanda "aberta / restante 0,00".

**Correção (0140).** Dois gatilhos **adiados para o fim da transação**, para não atropelar o "Receber e fechar", que paga e
fecha na mesma transação. Um dispara quando o pedido de entrega vira "entregue"; o outro quando entra um pagamento na
comanda que não seja o da própria entrega.

A comanda é fechada pelo caminho normal (`comanda_fechar_presencial`) quando todas estas condições valem:
- é de balcão;
- todos os pedidos não cancelados são de entrega e estão entregues;
- não sobra saldo.

Nenhum lançamento novo no livro-caixa (fechar não lança). Conta com outro pedido ainda na cozinha não fecha à força.
Só em loja com o financeiro ligado.

**Teste** (`e2e-financeiro-fluxo.mjs`, Parte 0, 9 verificações; suíte inteira 86/86, 19 de antifraude), todos com 1 recebimento só e cadeia de hash íntegra:
- pago antes + registro "já pago";
- pago antes + entregue sem registro;
- entregue e pago depois;
- dois pedidos, com um na cozinha;
- motoboy registra dinheiro de pedido já pago.

**Produção (só leitura), contas presas:** **nenhuma em loja real.** Na Menuzia (loja de teste), 5 contas antigas
abertas:

| Conta | O que é | A 0140 resolveria? |
|---|---|---|
| #27 | entrega paga no PDV e entregue (restante 0) | **sim**: é exatamente o caso do bug |
| #26 | mesa paga (restante 0) | não: mesa fecha pelo "Fechar conta", que também libera a mesa |
| #20 | retirada de teste ("sadsadsa") sem pagamento | não (tem saldo) |
| #30 | entrega de teste parada em "pronto", sem pagamento | não (tem saldo) |
| #31 | conta vazia | não |

## Parte 1 — Fluxo de Caixa
**Tela:** Financeiro › Fluxo de Caixa.

**Tabela por turno:**
- o turno aberto aparece no topo, "Em andamento";
- status Fechado, Divergente ou Reaberto, em selos de cor viva;
- diferença em verde, vermelho ou âmbar;
- rodapé com os totais do período;
- seletor "Colunas", com a preferência salva por usuário neste navegador.

**Extrato do turno** (painel lateral; tela cheia no celular):
- resumo do fechamento no topo, com esperado × contado × diferença e a maquininha;
- reaberturas em destaque, com quem reabriu e o motivo;
- todos os lançamentos, com hora, tipo, origem, forma, carteira, quem fez e quem aprovou, e valor;
- link para o pedido (abre o painel do pedido no Kanban);
- estorno ou ajuste com o lançamento original e o link para o turno antigo;
- contrapartidas internas esmaecidas;
- "Reimprimir relatório" registrado na auditoria;
- exportação do extrato em CSV e PDF.

**Filtros:**
- período, com os atalhos hoje, ontem, 7 dias, 30 dias, este mês, mês passado e personalizado;
- origem, forma, status, operador, motoboy e produto (quantidade e valor por turno);
- tudo na URL, com o "voltar" funcionando e o botão "Limpar filtros".

**Exportação:**
- CSV para o Excel em português, com proteção contra fórmula;
- PDF pela impressão do navegador, em A4 paisagem;
- permissão nova **"Exportar relatórios financeiros"**;
- toda exportação vai para a auditoria.

**Desempenho:** a agregação é feita no banco (`fin_fluxo_turnos`), com 99 turnos em cerca de 110 ms no ambiente
local. Não há o limite de 1000 linhas. Dois índices novos.

**Peças reaproveitáveis para o redesign:** `components/financeiro/ui/blocos.tsx` (selo, chip, painel lateral,
impressão) e `CartaoNumero`.

## Permissão "Exportar relatórios financeiros"
- **Padrão:** só dono e gerente. Atendente, logística, garçom, cozinha e entregador não podem (teste unitário).
- Com acessos personalizados, a permissão precisa estar marcada: ver o financeiro não basta.
- O modelo "Gerente" da Equipe já inclui a permissão.
- A 0140 marca a permissão só em quem é gerente de verdade (cargo gerente), com acessos personalizados que já
  viam o financeiro, e só em loja com financeiro ligado. Em produção, isso é **ninguém**: o único candidato,
  `garcom123` da Menuzia, tem papel gerente mas cargo de garçom e ficou de fora de propósito.

## Usuário de manutenção do banco (incidente local e produção)
**O que houve (local):** uma checagem do teste usou a conexão local `postgres` e alterou de verdade um lançamento de
teste. Esse é o papel de manutenção, que pode passar por cima da imutabilidade por desenho. A verificação de
integridade **acusou** a alteração; o valor foi restaurado e a cadeia voltou a 0 problemas. O teste passou a usar o
acesso da aplicação (`service_role`), que o banco recusa.

**Produção (só leitura, 2026-10-04):**

| Papel | Pode alterar ledger/auditoria? | Observação |
|---|---|---|
| `service_role` (o que o app usa, via API) | **Não**: o gatilho de imutabilidade recusa UPDATE, DELETE e TRUNCATE | bypass de RLS, mas não de gatilho |
| `authenticated` / `anon` | Não (sem permissão de escrita e com RLS) | |
| `postgres` | **Sim** | dono das tabelas (pode `ALTER TABLE … DISABLE TRIGGER`) e incluído em `fin_manutencao()`; não é superusuário |
| `supabase_admin` | **Sim** | superusuário gerenciado pela Supabase (não temos a senha) |

**Onde fica a credencial `postgres`:**
- no `DATABASE_URL` do arquivo `.env.local` desta máquina de desenvolvimento, fora do git;
- no painel da Supabase, com quem administra a organização do projeto.

**Quem usa:** só os scripts manuais rodados desta máquina. Eles servem para aplicar migrations com backup e para
consultas só leitura de conferência. O ajuste único `ajustar-caixas-automaticos-0135` de 03/10 também usou essa
credencial, e só inseriu lançamentos pelo caminho normal, com hash calculado pelo banco.

O **sistema em produção não usa essa credencial**: o app não tem conexão direta ao banco, só a API com a chave
`service_role`. Os testes que adulteram de propósito, como o `e2e-financeiro-fase1`, que prova que a verificação
acusa, são travados para o banco local (`exigirLoopback`).

**A verificação detectaria?**
- **Sim**, para alteração ou remoção de linhas: `auditoria_verificar_cadeia` recalcula o hash de cada registro e
  confere o encadeamento. Foi o que aconteceu no incidente local.
- **Limite:** quem tem `postgres` pode reescrever a cadeia inteira a partir do ponto alterado, recalculando todos
  os hashes. Isso não seria detectado sem uma âncora externa.
- **Limite:** colunas fora do hash do lançamento (`dados`, `aprovado_por_nome`, `dispositivo`) podem mudar sem
  acusar.

**Verificação em produção (só leitura, 2026-10-04 ~01:30): íntegro em todas as 11 lojas** (auditoria e livro-caixa).

**Proposta para restringir — NÃO aplicada, aguarda autorização:**
1. **Âncora externa diária do hash.** Todo dia, enviar o último `seq`/`hash` de cada loja para fora do banco
   (WhatsApp do dono ou um arquivo no servidor do Coolify). A verificação passa a comparar com a âncora. Assim, reescrever a
   cadeia vira detectável.
2. **Tirar a senha do `postgres` desta máquina.** Guardá-la num gerenciador de senhas, pôr no `.env.local` só na
   hora da migration e **trocar a senha** no painel da Supabase depois de cada uso.
3. **Papel só leitura para conferências** (`menuzia_leitura`: login com SELECT nas tabelas usadas, sem bypass).
   Os scripts de conferência param de usar o `postgres`.
4. **Ativar o `pgaudit`** (extensão suportada pela Supabase) para registrar no log da plataforma qualquer DDL ou
   DML do papel `postgres` nas tabelas do financeiro, como `DISABLE TRIGGER`.
5. **Hash v2** para lançamentos novos, incluindo `dados`, `aprovado_por_nome` e `dispositivo`.

## Papel × cargo (caso `garcom123`)
**O que o servidor usa:** o **papel** junto com os **acessos marcados na Equipe** (`usuarios.acessos`). O **cargo**
(0128) é só rótulo e modelo: preenche papel e acessos ao criar ou trocar o cargo na tela, e o servidor nunca o lê
para liberar ações.

**Ações sensíveis do financeiro** (aprovar com PIN, sangria, estorno, exportar, `podeFin`):
- dono pode tudo;
- com acessos próprios, só o que estiver **marcado**;
- sem acessos, vale o padrão do **papel**: gerente quase tudo; atendente (caixa) abrir/fechar caixa, receber,
  acerto do motoboy e reimprimir; logística só o acerto.

**Reabrir caixa:** sempre só o dono, mesmo marcado.

**Banco (RLS):** usa só o **papel**. Um papel "gerente" lê e escreve no banco como gerente, seja qual for o cargo.

**Divergências em produção (só leitura, todas as lojas):**

| Loja | Usuário | Papel | Cargo | Papel do cargo | Acessos sensíveis marcados |
|---|---|---|---|---|---|
| Angus Burguer (Menuzia, teste) | garcom123 | gerente | garcom | garcom | 12: financeiro, abrir/fechar caixa, receber, sangria, despesa, acerto, Pix, estornar, reimprimir, cancelar pedido, desconto |

Só esse caso. Os outros 16 usuários com cargo batem com o papel. Os 4 sem cargo são contas anteriores à 0128 e o
sistema deriva o cargo do papel. **Nada foi alterado.**

**Proposta de regra (não aplicada):**
1. **O cargo define o papel.** Ao salvar na Equipe, o servidor grava o papel do cargo (caixa e cozinha → atendente,
   garçom → garçom, motoboy → logística, gerente → gerente). Papel diferente só com o cargo **Personalizado**.
2. **A tela da Equipe avisa** quando o papel dá mais poder que o cargo (ex.: "Garçom com papel de Gerente: acessa
   como gerente"), com um botão "Ajustar ao cargo".
3. **Ações sensíveis do financeiro deixam de ser liberadas pelo padrão de papel gerente** quando o cargo não for
   gerente. Valem só as permissões marcadas.
4. O `garcom123` da Menuzia seria ajustado pela tela, depois da sua autorização.

## Exportar pelo perfil padrão (teste)
A 0140 não marca ninguém em produção. Quem exporta vem do perfil padrão. O `e2e-financeiro-fluxo` (Parte 1g) confere:
- **dono** exporta (200);
- **gerente** sem acessos próprios exporta (200);
- **caixa**, **garçom**, **cozinha** (modelo Cozinha) e **motoboy** recebem 403.

## Testes
| Suíte | Resultado |
|---|---|
| **e2e-financeiro-fluxo** (novo: Parte 0, conciliação, filtros, CSV/PDF, antifraude, tela) | **86/86** |
| financeiro fase 1 (auditoria) / fase 2 (caixa, movimentações) / fase 3 (motoboy, Pix) / integrado | 66/66 · 55/55 · 106/106 · 52/52 |
| pdv-pagamento / pdv-atendimento / pdv-v2 / balcão-entrega (delivery) | 57/57 · 97/97 · 70/70 · 84/84 |
| garçom (mesas) / estabilidade (logística) / regressão geral / impressão v2 | 47/47 · 53/53 · 52/52 · 40/40 |
| kanban-card / kanban-topo / kanban-topo-v2 / responsivo / cozinha | 72/72 · 48/48 · 121/121 · 24/24 · 26/26 |
| agendamento (fora da meia-noite) / cardapio-ordem-qr (favorito no "Mais Pedidos") | 25/25 · 111/111 |
| Vitest | 1969 ok (rótulos de auditoria com tempo limite de 30 s) |

**Antifraude** (no e2e):

| Tentativa | Resultado |
|---|---|
| turno, extrato ou reimpressão de OUTRA loja pelo ID | 404, sem dados |
| garçom ou motoboy chamando a API do fluxo | bloqueado |
| caixa sem "ver financeiro" | 403 |
| ver sem permissão de exportar | vê (200), exportar → 403 |
| exportar pelo perfil padrão: dono e gerente | 200 |
| exportar pelo perfil padrão: caixa, garçom, cozinha, motoboy | 403 |
| PATCH, PUT ou DELETE no fluxo e no extrato | 405 (não existe edição) |
| editar ou apagar lançamento direto no banco (gerente) | recusado, valor intacto |
| editar ou apagar lançamento com o acesso do servidor (`service_role`) | recusado pelo banco |
| CSV com fórmula maliciosa na observação | sai como texto (`'=HYPERLINK…`) |

**Suítes que apagavam a semente umas das outras:** o `kanban-card` agora recria a própria semente, que usa uma mesa
própria. O `kanban-topo` não cancela mais os pedidos "TESTE Card" e mede os avisos a partir do que já existe. Rodados
em sequência (topo → card): os dois passam.

**Prints:** `fase4-prints/`:
- `depois-desktop.png`, `depois-extrato-desktop.png`;
- `depois-celular.png`, `depois-extrato-celular.png`.
