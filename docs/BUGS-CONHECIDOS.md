# Bugs conhecidos — o que já aconteceu e como não deixar voltar

Cada bug aqui tem **causa**, **como evitar** e, quando dá, uma **checagem automática** em
`scripts/guardas/bugs-conhecidos.mjs`. Ela roda:

- no `npm run build` (prebuild, também no Coolify): **se falhar, o build falha e o deploy não sobe** — a versão
  anterior continua no ar;
- no `npm run test` (vitest, `lib/guardas/bugs-conhecidos.test.ts`), que também prova que a checagem pega o erro;
- no `npm run checar` (antes de publicar): guardas + `tsc --noEmit` + lint + vitest.

Achou um bug novo que pode voltar? Corrija com teste que falha primeiro, **acrescente aqui** e, se der, **uma
checagem B-n** no script.

---

## B1 — Regex com a barra perdida (`/^d{1,3}$/` em vez de `/^\d{1,3}$/`) · 22/10/2026 · checagem automática

- **Onde aconteceu:** 3 lugares, descobertos quando a checagem foi criada:
  - `app/api/agente/pedidos/route.ts`: `?alarme=N` do Assistente nunca era lido → o alarme não parava na hora
    quando aceitavam o pedido durante a espera;
  - `lib/robo-auto/classificador.ts`: o robô não ignorava palavras que são só número ("2 150" ia para a IA);
  - `lib/queries/analytics-vitrine.ts`: o filtro de "pedido teste" do Dashboard não pegava " Teste".
- **Causa:** código com regex escrito por script (`node -e "…"`, `sed`, heredoc) — a camada de escape **come a
  barra**: `\d` vira `d`, `\s` vira `s`.
- **Como evitar:** código com `\` (regex, caminhos Windows) **só com a ferramenta de edição direta** (Edit/Write),
  nunca por `node -e`/`sed`. Regex que valida entrada vira função pura com teste (ex.: `alarmeSabido()`).
- **Checagem:** B1 procura `/^d{`, `/^d+`, `/^s*`, `/^w+` no código.

## B4 — Caractere de controle invisível no código · 22/10/2026 · checagem automática

- **Onde aconteceu:** `lib/queries/analytics-vitrine.ts` — o `\b` de `/^\s*teste\b/i` virou um **backspace**
  (byte 0x08), invisível no editor. O filtro de pedido teste deixava passar o nome "Teste".
- **Causa:** a mesma do B1 (escape comido): `\b` → backspace, `\f` → form feed.
- **Como evitar:** igual ao B1.
- **Checagem:** B4 recusa qualquer caractere de controle (fora tab/quebra de linha) em código.

## B5 — Foto pesada no cardápio (subida sem otimizar) · 22/10/2026 · checagem automática

- **Onde aconteceu:** 301 imagens de todas as lojas fora do padrão — sabores de pizza (PNG de ~570 KB, até 1,1 MB),
  fotos e "miniaturas" de itens, complementos, categorias (até 3 MB). 106,4 MB no total.
- **Causa:** o painel SEMPRE otimizou (lib/imagem.ts: WebP, 1200 px produto / 400 px miniatura, qualidade 82%), mas
  os **scripts de importação** (Expresso/Pizza do Rosa, demo) subiam a foto crua — o comentário dizia "não vale trazer
  uma lib de imagem só pra este script", e a `sharp` já estava no projeto. Fotos antigas, de antes da otimização,
  também ficaram.
- **Correção (22/10):** `scripts/imagens/converter-existentes.mjs` converteu 282 imagens com as MESMAS regras do painel:
  **106,4 MB → 11,7 MB (89% menor)**, sem diferença visível (comparação lado a lado; transparência mantida). Originais
  NÃO apagados; lista antigo → novo em `~/menuzia-backups/imagens-2026-10-22-21-02.json`; desfazer com
  `node scripts/imagens/converter-existentes.mjs --desfazer <arquivo>`. Logos ficaram de fora (impressão).
- **Como evitar:** script que sobe foto usa `otimizarBuffer()` de `scripts/imagens/otimizar.mjs` (espelho de
  `PERFIS` do painel; `lib/imagem-scripts.test.ts` confere que os limites batem). Importação nova de cardápio: rodar
  depois `node scripts/imagens/converter-existentes.mjs` (ensaio) — tem que dar "0 imagens fora do padrão".
- **Checagem:** B5 falha se um arquivo de `scripts/` subir para o bucket `cardapio` sem chamar `otimizarBuffer`
  (`scripts/seguranca/` liberado: testes de impressão sobem logos pequenas de propósito).

## B2 — O mesmo trabalho em dois crons · 22/10/2026 · checagem automática

- **Onde aconteceu:** o ciclo do push (`cicloPush`) rodava no cron de campanhas **e** no cron próprio
  "Push do app" → 2× por minuto, dobrando ~30 requisições/min ao Supabase (egress estourado).
- **Causa:** o push nasceu "de carona" no cron de campanhas; depois ganhou cron próprio no Coolify e a carona
  ficou.
- **Como evitar:** cada trabalho agendado tem **um** cron. Ao criar um cron novo para algo que já rodava em
  outro, tire do antigo no mesmo commit.
- **Checagem:** B2 falha se uma função de `lib/` for importada por duas rotas de `app/api/cron/`
  (ajudantes como `lojasComFinanceiro` são permitidos — lista em `AJUDANTES`).

## B3 — Política RLS que roda uma vez POR LINHA · 22/10/2026 · checagem automática (migrations ≥ 0219)

- **Onde aconteceu:** as 69 políticas do `public` usavam `auth_restaurante_id()` / `auth_papel()` /
  `auth_e_gestor()` direto. Elas são SECURITY DEFINER: o Postgres não as embute e roda **para cada linha**
  (2 consultas a `usuarios` por linha; 56 milhões de leituras). Pedidos da Menuzia: 23,5 ms → 1,6 ms com a 0218.
- **Como evitar:** em política, sempre `(select public.auth_restaurante_id())`, `(select public.auth_papel())`,
  `(select public.auth_e_gestor())`.
- **Checagem:** B3 falha se uma migration nova (0219+) criar/alterar política com a chamada sem `select`.
- A 0218 (que corrige as antigas) foi **APLICADA em 22/10/2026** (69 políticas; 0 diferenças no que 16 usuários veem em
  63 tabelas; pedidos como dono: 23,5 → 1,54 ms com RLS de verdade).
- Conferência de migration de permissão: comparar antes/depois **na mesma transação em REPEATABLE READ** — foto tirada
  fora acusa "diferença" por visita/mensagem que chegou no meio (1ª tentativa da 0218).

## Testar conexão exigia a integração ligada · 22/10/2026 · teste

- **Onde:** `configProvedorPronta` recusava "está desligado" e o botão **Conectar** testa ANTES de ligar →
  com a integração desligada, ela nunca mais religava.
- **Como evitar:** fluxo "testa e depois liga" não pode passar por checagem de "ligado".
- **Teste:** `lib/entregas/provedores-pronta.test.ts`.

## Coluna nova em `restaurantes` sem grant · 19/10/2026 · teste (0204)

- O painel grava `restaurantes` com permissão **por coluna**; coluna nova sem `grant update (…) to authenticated`
  deixa o salvar quebrado. Ver memória/0204.

## Login falha na 1ª tentativa depois de deploy · 21–22/10/2026 · configuração

- **Causa:** Next 15 sorteia a chave das Server Actions a cada build → a tela de login aberta antes do deploy
  manda um ID que não existe mais (`404 x-nextjs-action-not-found`).
- **Correção:** `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` fixa no Coolify (Build + Runtime). Pendente do dono em 22/10.

## Egress do Supabase: o custo é o NÚMERO de requisições · 22/10/2026

- Cada resposta da API pesa ~1,2 KB, quase tudo cabeçalho. 300 mil requisições/dia ≈ 13 GB/mês (limite grátis: 5).
- **Como evitar:** antes de pôr algo em `setInterval`/cron/polling, contar requisições por minuto × lojas.
  Trava de "já fiz?" lida do banco a cada minuto custa o mesmo que o trabalho — junte numa consulta só ou guarde
  na memória do servidor.
