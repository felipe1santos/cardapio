# Financeiro Fase 5 — Precificação / CMV (+ decisões da Fase 4): relatório

Regras detalhadas em [fase5-cmv.md](fase5-cmv.md). Migrations **0141** (Parte 0-A) e **0142** (CMV).

## Parte 0 — Decisões autorizadas

### A) Usuário postgres

**(a) Âncora externa — FEITO.**
- Todo dia, um cron grava **fora do banco** o último `seq` + `hash` do livro-caixa (`fin_lancamentos`) e da auditoria
  (`eventos_auditoria`) de cada loja. O arquivo `ancoras.jsonl` fica num volume persistente do servidor, em
  `/app/dados/ancoras`, e só recebe linhas novas.
- Rota: `POST /api/cron/ancora-integridade`, com o cabeçalho `x-cron-secret`. Sem o segredo, a resposta é 401.
- O botão "Verificar integridade" da Auditoria confere a cadeia e também **cada âncora gravada**. Uma âncora acusa
  problema em dois casos:
  - o `seq` existe, mas o hash mudou: "cadeia reescrita";
  - a linha sumiu do banco.
- O teste simula o ataque que antes passava: altera uma linha e recalcula a cadeia inteira. A verificação interna
  passa, e a âncora acusa (`e2e-integridade`, 7/7).

**(d) pgaudit — FEITO.**
- `UPDATE`, `DELETE` e `TRUNCATE` em `fin_lancamentos`, `eventos_auditoria` e `fin_entregas_pagamento` ficam
  registrados no log do Postgres. Valem para o usuário `postgres` e para o `authenticator`, por onde passa o
  service_role.
- O registro usa auditoria por objeto, através da role `menuzia_auditoria`.
- Para o `postgres`, também ficam registrados DDL e mudanças de role: `ALTER TABLE`, `DISABLE TRIGGER`, `GRANT`.
- Por que por role e não por banco: o Supabase não deixa `ALTER DATABASE … SET pgaudit.*`. A configuração foi feita
  com `ALTER ROLE … SET`.
- O log fica no painel do Supabase: Logs › Postgres; buscar por `AUDIT:`.
- Testado localmente: as linhas `AUDIT: OBJECT … UPDATE … fin_lancamentos` e `AUDIT: SESSION … DDL … ALTER TABLE`
  aparecem.

**(b) Senha do postgres — passo a passo para você.** Eu NÃO troquei a senha.

Conferido:
- O `.env.local` nunca foi commitado. Está no `.gitignore` e, em todo o histórico do git, só aparece o
  `.env.local.example`, com valores fictícios.
- A senha real do postgres e a service key aparecem em **0 commits**.
- O app em produção **não usa** a senha do postgres; ele fala com o banco pela API, com a service key. Quem usa a
  senha são só os scripts de manutenção desta máquina (migrations e conferências), pela linha `DATABASE_URL` do
  `C:\projetos\cardapio-estab\.env.local`.

Passo a passo:
1. Abra o seu gerenciador de senhas (Bitwarden, 1Password ou o do Google) e crie um item **"Menuzia — Postgres
   (produção)"**.
2. No Supabase, entre no projeto: **Project Settings › Database › Database password › Reset database password**.
   Gere uma senha nova e forte e salve-a **primeiro** no item do gerenciador.
3. Confirme a troca no Supabase. O app continua no ar, porque não usa essa senha.
4. No `C:\projetos\cardapio-estab\.env.local`, **apague** a linha `DATABASE_URL=...`. A senha antiga deixa de valer
   no passo 3, mas não deve ficar no disco.
5. Quando precisar rodar uma migration ou conferência:
   - copie a connection string do gerenciador e cole só naquela sessão do terminal
     (`$env:DATABASE_URL = "…"` no PowerShell);
   - feche o terminal no fim.

   Assim a senha nunca fica gravada em arquivo.
6. Se em algum momento eu precisar da string, você cola no terminal com `! $env:DATABASE_URL="…"`. Eu não a escrevo
   em arquivo nem no chat.
7. Opcional: ative o 2FA da conta Supabase (Account › Security), se ainda não estiver ligado. É quem tem essa conta
   que consegue trocar a senha.

**(c) e (e) — explicados abaixo, NÃO aplicados.** Aguardam a sua resposta.

**(c) Usuário só-leitura para as conferências (`menuzia_leitura`).**
- Hoje, os scripts que só **leem** produção, como as conferências e os relatórios, entram com o `postgres`, que pode
  tudo.
- A proposta é criar uma role com `LOGIN` e `SELECT` nas tabelas, sem `INSERT`, `UPDATE`, `DELETE` ou DDL, com senha
  própria guardada no gerenciador.
- Os scripts de leitura passariam a usar essa role, e o `postgres` ficaria só para aplicar migration, com a senha
  colada na hora (passo 5 acima).
- Ganho: se a string das conferências vazar, quem a tiver só lê; não altera nada.
- Custo: uma senha a mais para guardar e ajustar `ler-prod` para a nova string.
- Risco para as lojas: nenhum, porque o app não usa essa role.

**(e) Hash v2 do livro-caixa.**
- Hoje o hash de cada lançamento cobre os campos de dinheiro e de identidade: loja, tipo, valor, conta, data, autor,
  origem e o hash anterior.
- Ficam **fora do hash** três colunas: `dados` (detalhes em JSON), `aprovado_por_nome` e `dispositivo`.
- A proposta é uma versão 2 do hash que inclui também essas três colunas, só para lançamentos **novos**.
  - Os antigos continuam conferidos pela v1. Não se recalcula o passado, pela regra de não converter formato de dado
    existente.
  - Uma coluna `hash_versao` diz qual fórmula vale para cada linha.
- Ganho: quem tem o `postgres` não consegue trocar o nome do aprovador ou o dispositivo sem quebrar a cadeia.
- Custo: mudança no gatilho do livro-caixa, que é o ponto mais sensível do financeiro, com teste completo de
  integridade antes.

**Os dois limites do hash (de hoje):**
1. **Quem tem o `postgres` pode reescrever a cadeia inteira.** Dá para alterar uma linha e recalcular todos os hashes
   seguintes, e a verificação interna continua "íntegra", porque a cadeia só prova coerência consigo mesma.
   → **Coberto agora pela âncora externa (a):** o hash de ontem, guardado fora do banco, não bate mais com o
   reescrito. O pgaudit (d) registra quem fez.
2. **`dados`, `aprovado_por_nome` e `dispositivo` estão fora do hash.** Alterar só essas colunas não quebra a cadeia.
   → O pgaudit (d) já registra qualquer `UPDATE` nelas. Quem resolve de vez é a **v2 (e)**, que aguarda a sua
   resposta.

### B) Papel × cargo — FEITO

**Regra nova:** o cargo define o papel.
- Com um cargo fixo (garçom, caixa, cozinha, motoboy, atendente, gerente), o papel é sempre o do cargo.
- Pedir uma área que o cargo não tem → **400**: "O cargo X não inclui: …. Para liberar, escolha o cargo
  Personalizado."
- Só o cargo **Personalizado** aceita papel diferente.

**Aviso na Equipe:** selo âmbar **"⚠ Papel de X"** ou **"⚠ Permissões de gestor"**.
- Aparece quando alguém tem permissão sensível (financeiro, sangria, estorno, aprovar, exportar) sem ser gerente ou
  dono.
- Ao passar o mouse ou tocar, o selo explica o motivo.

**Lojas reais:** nada muda sozinho. A regra vale só quando alguém salva. Contas que já divergem continuam como estão
e só ganham o aviso.

**garcom123 (Menuzia):** em produção, é a única conta divergente (papel gerente, cargo garçom, 12 sensíveis). Ajuste
feito na conferência pela própria tela/API da Equipe: papel garçom, área Mesas, sem sensíveis. Fica auditado.

## Regra de tamanhos e meio a meio
- **Produto sem tamanho:** ficha do produto.
- **Tamanho (P/M/G de `tamanhos_item`):** ficha própria do tamanho. Se o tamanho não tem ficha, usa a do produto.
- **Pizza:** uma ficha por **sabor × tamanho da loja**.
  - Meio a meio = **média das fichas dos sabores naquele tamanho**: com 2 sabores, ½ de cada; com 3, ⅓ de cada.
  - Vale mesmo quando o preço segue "o mais caro": o custo é a fração real.
  - Se faltar a ficha de algum sabor, a pizza fica "sem ficha". O sistema não inventa custo.
  - Sabor antigo cujo nome já contém " / " conta como um sabor só, a mesma regra do preço.
- **Borda e massa:** ficha própria, somada à pizza. Borda sem ficha deixa a linha "parcial".
- **Adicional:** ficha própria, somada uma vez por unidade escolhida. Adicional sem ficha soma 0 e aparece no detalhe.

## Momento em que o custo é guardado
**No instante em que a linha do pedido é gravada** (`INSERT` em `pedido_itens`), por um gatilho do banco. Cobre:
- o pedido da vitrine;
- o PDV (balcão e mesa);
- o garçom;
- a cópia da transferência entre mesas.

Detalhes:
- Grava o custo unitário com 6 casas e em centavos, a situação (ok, parcial, sem ficha ou erro) e o detalhe.
- Se o cálculo falhar, o gatilho captura o erro, grava a situação `erro` com a mensagem e o pedido segue normal.
- O CMV de um período usa só esse custo guardado. Vendas anteriores à Fase 5 aparecem como "sem custo registrado".
- Só grava nas lojas com o financeiro ligado (Menuzia).

## Fórmulas
| Conta | Fórmula |
|---|---|
| Custo por unidade base | custo da compra ÷ (quantidade × base por unidade) ÷ (aproveitamento ÷ 100) |
| Sub-receita | Σ(quantidade × custo do componente) ÷ rendimento ÷ aproveitamento |
| CMV da ficha | Σ quantidade × custo por base, arredondado ao centavo só no fim |
| Lucro bruto | preço − CMV |
| Margem | lucro ÷ preço × 100 |
| **Preço sugerido** | **CMV ÷ (1 − margem-alvo − custos variáveis)**, arredondado **para cima** no final escolhido (,90 / ,99 / ,00 / ,50 / sem). Impossível (soma ≥ 100%) → sem sugestão |
| CMV do período | Σ custo guardado × quantidade |

Exemplo do enunciado, conferido à mão (teste automático):

| Componente | Conta | Custo |
|---|---|---|
| tomate | 30 g × 0,8 c/g | 24 c |
| carne | 120 g × 3,2 c/g | 384 c |
| pão | 1 × 100 c | 100 c |
| queijo | 40 g × 4 c/g | 160 c |
| embalagem | | 80 c |
| **Total (CMV)** | | **R$ 7,48** |

Com preço de R$ 25,00: lucro R$ 17,52, margem 70,08%.

## Migrations (com rollback em `docs/rollback/`)
| # | O quê |
|---|---|
| 0141 `integridade_ancora_e_pgaudit` | função `fin_ancora_integridade()` (service_role), extensão pgaudit, role `menuzia_auditoria` + grants, `ALTER ROLE postgres/authenticator SET pgaudit.*` |
| 0142 `cmv_precificacao` | tabelas `cmv_insumos`, `cmv_insumo_componentes`, `cmv_custos_historico` (imutável), `cmv_fichas`, `cmv_ficha_componentes`, `cmv_config`, `cmv_config_categoria`, `pedido_itens_custo`; RLS sem políticas; funções de custo; gatilho de custo na venda; ajuste das permissões dos gerentes que já tinham "editar" |

## Arquivos
- **Banco:** `supabase/migrations/0141_…`, `0142_…` e os `.down.sql` correspondentes.
- **Regras:**
  - `lib/financeiro/cmv-regras.ts` (+ teste);
  - `lib/financeiro/cmv.ts`;
  - `lib/financeiro/ancora.ts`;
  - `lib/equipe-cargos.ts` (+ teste);
  - `lib/acessos.ts`, `lib/financeiro/permissoes.ts`, `lib/queries/auditoria.ts`.
- **API:**
  - `app/api/admin/financeiro/cmv/**`: lista, insumos, ficha, importar, preço, config, exportar e vendas;
  - `app/api/cron/ancora-integridade`;
  - `app/api/admin/financeiro/auditoria`;
  - `app/api/admin/equipe/**`.
- **Tela:**
  - `components/financeiro/cmv/secao-cmv.tsx`, `insumos.tsx`, `ficha-custo.tsx`;
  - `app/admin/financeiro/page.tsx`;
  - `app/admin/equipe/page.tsx`.
- **Testes:** `scripts/seguranca/e2e-financeiro-cmv.mjs`, `e2e-integridade.mjs`.

## Testes
- `e2e-financeiro-cmv`: **61/61**. Cobre:
  - Parte 0-B;
  - insumos e conversões;
  - sub-receita;
  - exemplo à mão;
  - P/M/G;
  - meio a meio;
  - adicional;
  - importação;
  - custo na venda;
  - recálculo + histórico;
  - venda antiga intacta;
  - falha → pedido entra;
  - sugestão + arredondamento;
  - aplicar preço (vitrine, PDV, auditoria);
  - CSV;
  - tela no desktop e no celular.
- `e2e-integridade` (Parte 0-A): **7/7**.
- Regressão completa: ver o resultado no relatório final do chat.

### Tabela de antifraude
| Tentativa | Resultado |
|---|---|
| Garçom lendo custos pela API (lista, insumos, ficha, CMV) | 403 em todas |
| Caixa/atendente lendo custos pela API | 403 em todas |
| Motoboy lendo custos | bloqueado |
| Aplicar preço sem a permissão própria | 403, preço intacto |
| Aplicar com "preço atual" manipulado ou desatualizado | 409, nada muda |
| Preço novo inválido (0) | 400 |
| Editar insumo sem "editar insumos" | 403 |
| Editar ou apagar o histórico de custos (até com o acesso do servidor) | recusado pelo banco |
| Insumo de outra loja pelo ID (ler, editar, usar na ficha) | 404 |
| Loja ou custo enviados no corpo | ignorados: vale a loja da sessão e o custo é calculado |
| Sem sessão | 401 |
| DELETE em insumo | 405 (não existe exclusão) |
| Reescrever a cadeia do livro-caixa recalculando os hashes | âncora externa acusa "cadeia reescrita" |
| Cron da âncora sem o segredo | 401 |
| Garçom criado com sensíveis de gestor | papel garçom; área fora do cargo → 400 |

## Prints
Em `docs/financeiro/fase5-prints/`:
- `depois-precificacao-desktop.png`;
- `depois-precificacao-celular.png`;
- `depois-ficha-desktop.png`;
- `depois-ficha-celular.png`;
- `depois-equipe-aviso.png`.
