# Painel da plataforma (/superadmin) — mais profissional, sem cadastro automático e com sublogins (2026-10-04)

## 1. Cadastro automático removido
- Saiu da tela o bloco "Cadastro automático" (checkbox, validade em dias e Salvar).
- Saiu do servidor:
  - `/api/cadastro/verificar-email` só diz "autorizado" para e-mail **pré-cadastrado**;
  - `completarPrimeiroAcesso` recusa e-mail sem pré-cadastro (não cria mais conta sozinho).
- A coluna `config_plataforma.cadastro_automatico` ficou no banco e não é mais lida. Em produção ela já estava
  **desligada**.
- O teste liga a coluna no banco local e confere que o `/cadastro` continua fechado.
- **Contas existentes não mudam**, inclusive as "Ativo até dd/mm/aa" (o teste confere a validade intacta).
  Convites pendentes continuam valendo.
- `/cadastro` com e-mail não autorizado: **"Cadastro disponível só por convite. Fale com o suporte."**, com o resto do
  formulário travado.

## 2. "+ Cadastrar cliente" (modal)
**Campos:**
- e-mail (obrigatório, validado, sem duplicar: "Este e-mail já está cadastrado.");
- nome da loja, responsável e telefone (opcionais);
- validade: "Sem validade" ou "Até [data]", que vale até 23:59 de São Paulo.

**Botões:** [Cancelar] [Pré-cadastrar]. Ao salvar, aparece o toast de sucesso e a linha nova entra como "Aguardando
1º acesso".

**No `/cadastro`:**
- o e-mail convidado chega com loja, responsável e telefone **já preenchidos** (editáveis);
- o cliente define login e senha;
- a validade escolhida no convite é mantida. Antes, todo pré-cadastro virava acesso permanente.

## 3. Linhas "—" e sublogins (investigação em produção, só leitura)
Contas com o nome da loja vazio:

| Nome / login | Papel | Loja | Conclusão |
|---|---|---|---|
| Administrador / `admin` | **dono** | Angus Burguer (slug `menuzia`) | **Não é sublogin:** é o dono da loja Menuzia, cadastrado direto, sem o nome da loja no perfil. Agora a linha usa o nome da loja. |
| garcom123 / `garcom123` | gerente (cargo garçom) | Angus Burguer (Menuzia) | sublogin |
| joao / `joao.silva` | garçom | Pizza do Rosa | sublogin |
| Carlos Feijao / `carlos` | atendente | Villalanches Gourmet | sublogin |
| jessica de sousa / `jessica` | garçom | Villalanches Gourmet | sublogin |
| Jose Eduardo / `dudu` | garçom | Villalanches Gourmet | sublogin |
| (sem nome) | dono | — | pré-cadastro pendente (gmail.com, 01/10), segue "Aguardando 1º acesso" |

Todos os sublogins usam e-mail técnico `…@equipe.menuzia.local` e foram criados pela tela Equipe. Repetiam o
faturamento da loja dona porque cada linha buscava as métricas pela loja.

**Agora:**
- **uma linha por loja** (conta principal = o dono; com mais de um dono, o que tem acesso e é mais antigo);
- coluna **Sublogins** com a quantidade. Ao clicar, abre um modal só leitura com nome, login, cargo/papel, status
  (ativo/pausado/bloqueado), último acesso e criado em. Funcionário excluído pela loja não conta.

**Números do topo em produção (2026-10-04):**

| | Antes | Depois |
|---|---|---|
| Cadastros | 17 (logins) | **12** (11 lojas + 1 pré-cadastro) |
| Ativos | 15 | **10** (a Belga Foods está sem acesso) |
| Aguardando 1º acesso | 1 | 1 |
| Faturamento / pedidos entregues | R$ 38.206,74 / 716 | igual (já somava por loja) |

- O faturamento agora é **paginado**. A consulta antiga parava calada em 1000 pedidos; produção tem 716 e
  passaria do limite em breve.
- No ambiente local o efeito é maior: 293 "cadastros" antes, 24–25 lojas depois (prints `antes-*`).

## 4. Visual
**Topo:** "Painel da plataforma" à esquerda; e-mail e **Sair** à direita, numa linha.

**Cartões de resumo** iguais aos de Clientes (ícone em círculo, rótulo pequeno, valor grande).

**Selos de status** com fundo vivo e texto branco:

| Selo | Cor |
|---|---|
| Ativo | verde `#15803D` |
| Ativo até dd/mm/aa | azul `#0369A1` |
| Aguardando 1º acesso | âmbar `#B45309` |
| Sem acesso / Expirou em | vermelho `#B91C1C` |

**Barra da lista:**
- busca por loja, responsável, e-mail, login (inclusive dos sublogins) e telefone;
- filtros (Todos, Ativos, Ativos com validade, Aguardando 1º acesso, Sem acesso), com contagem;
- botão **+ Cadastrar cliente**.

**Tabela:**
- cabeçalho fixo e coluna da loja fixa ao rolar para o lado;
- ordenação por loja, status, sublogins, faturamento, pedidos, ticket, cadastro e último acesso;
- paginação de 20.

**Menu ⋮ por loja** (por cima de tudo):
- ver detalhes, abrir vitrine, ver sublogins;
- **renovar/alterar validade** (nova: antes era preciso revogar e liberar de novo);
- bloquear e desbloquear (com validade opcional);
- liberar ou retirar a Impressão Beta;
- remover pré-cadastro;
- excluir dados, que exige digitar o nome da loja.

Todas as ações sensíveis pedem confirmação.

**Auditoria:**
- todas as ações gravam em `auditoria_plataforma` (migration **0139**), com quem fez, o quê e qual loja;
- as ações que mexem numa loja também gravam na auditoria da loja, com rótulos legíveis no grupo
  "Plataforma (Menuzia)".

**Proteções novas no servidor:**
- bloquear, alterar validade e excluir só agem na **conta principal**. Antes, "Excluir dados" numa linha de
  funcionário apagava a loja inteira;
- funcionários são geridos na tela Equipe da loja.

**Toasts sempre por cima:** a pilha de toasts do painel subiu para z 9998 (regra "avisos sempre por cima").

## 5. Celular
- Resumo em 2 colunas.
- **Um cartão por loja:** nome, status, responsável, telefone, e-mail/login, faturamento, pedidos, sublogins
  (tocável) e ⋮.
- Busca pela lupa, filtros em chips roláveis e **"+ Cadastrar cliente" fixo** embaixo.
- Modais em **tela cheia com "← Voltar"**.
- Testado em 360, 390, 414, tablet 1024 e desktop 1366/1920, sem rolagem lateral.

## 6. Segurança e testes
- A tela é protegida pelo layout do `/superadmin`, e **cada ação confere o superadmin no servidor**. Um lojista comum
  que abre `/superadmin` é mandado embora (testado).
- `lib/queries/plataforma.test.ts` (5):
  - uma linha por loja; sublogins (pausado/bloqueado/excluído);
  - dono sem nome de loja; dois donos; pré-cadastro;
  - números do topo; situações.
- `scripts/seguranca/e2e-superadmin.mjs` **76/76**:
  - /cadastro fechado sem convite, mesmo com a coluna antiga ligada;
  - lojista comum barrado;
  - números do topo iguais a uma conta feita direto no banco, menores que o total de usuários;
  - uma linha por loja; sublogins (contagem e modal só leitura);
  - busca por login de sublogin e por e-mail;
  - conta antiga "Ativo até" intacta; cores dos selos;
  - filtros, ordenação, paginação, cabeçalho e coluna fixos;
  - modal de cadastro (inválido, duplicado e válido, com validade), toast e linha nova;
  - primeiro acesso pré-preenchido mantendo a validade;
  - menu ⋮ por cima: validade, bloquear e desbloquear (auditoria da plataforma e da loja), remover, excluir com nome;
  - celular 360/390/414, tablet e desktop.
- Só dados TESTE (lojas "TESTE SA …", e-mails `@teste-sa.local`), apagados no fim.
- Vitest 1958 ok; `e2e-login-limite` 3/3. Despacho de rotas intocado.

## 7. Prints (`prints/`)
- `antes-desktop.png` e `antes-celular.png`: tela antiga com 293 "cadastros" no local e o bloco de cadastro automático.
- `depois-desktop.png`, `depois-tablet.png`, `depois-celular.png`.
- `depois-sublogins-*`, `depois-modal-cadastrar-*`, `cadastro-so-convite-celular.png`.
