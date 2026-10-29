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

## Aviso do parceiro com preço zero apagava o preço da corrida · 22/10/2026 · teste

- **Onde:** 1ª corrida real da Uber (#581): no meio da corrida a Uber mandou um aviso com `fee: 0` e o preço cotado
  (R$ 12,40) virou R$ 0 — se o último aviso viesse assim, o custo NÃO seria lançado no Financeiro
  (`lancarCustoCorrida` ignora preço 0). O aviso seguinte trouxe 1240 de volta, por sorte.
- **Como evitar:** dado vindo de parceiro só substitui o nosso se for válido (`precoDoEvento`: só > 0).
- **Teste:** `lib/entregas/provedores-pronta.test.ts` (precoDoEvento).

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

## Cartão online recusado preso em "pendente" para sempre · 26/10/2026 · teste

- **Onde:** `verificarPendentes` (`lib/pagamentos/pix-online.ts`), cron do Pix a cada minuto.
- **Causa:** cartão recusado (`rejected`) devolve `recusado` na conferência e o cron só expirava o que voltava
  `pendente`. Três cobranças de teste de 12/10 foram conferidas ~19 mil vezes cada (1 chamada ao Mercado Pago por
  minuto) e os pedidos ficaram em "aguardando pagamento".
- **Como evitar:** todo resultado da conferência precisa de um destino depois do prazo — a regra fica em
  `acaoDaPendencia` (`lib/pagamentos/pendencias.ts`).
- **Teste:** `lib/pagamentos/pendencias.test.ts` e `lib/pagamentos/verificar-pendentes.test.ts` (cron inteiro com
  banco em memória; falha sem a correção).

## Pix pago com o pedido cancelado no meio virava "já confirmado" · 26/10/2026 · teste

- **Onde:** `confirmarPago` (`lib/pagamentos/pix-online.ts`).
- **Causa:** a cobrança era marcada `pago` ANTES de conferir o UPDATE condicional do pedido. Cancelado entre a leitura
  e a gravação → `ja_confirmado`: dinheiro recebido sem livro-caixa, sem "a devolver" e sem alerta.
- **Como evitar:** em toda passagem condicional, grave o efeito só depois de saber que a passagem aconteceu; se não
  aconteceu, releia o estado e decida.
- **Teste:** `lib/pagamentos/confirmar-corrida.test.ts` (simula a corrida; falha sem a correção).

## Pedido gravado sem itens quando a gravação dos itens falhava · 26/10/2026 · teste

- **Onde:** `criarPedido` (`lib/queries/pedidos.ts`), vitrine, mesa legada e IA.
- **Causa:** pedido e itens são dois INSERTs; falha no segundo deixava o pedido vazio com prêmio/cupom/cashback
  consumidos, e o reenvio com a mesma chave recebia esse pedido vazio como sucesso.
- **Como evitar:** toda escrita em duas etapas desfaz a primeira se a segunda falhar (aqui: apaga o pedido e devolve
  as reservas). O ideal futuro é uma RPC única, como `comanda_lancar` do PDV.
- **Teste:** `lib/queries/pedido-itens-falha.test.ts`.

## Pedido 99Food com entregador da 99 entrava com total R$ 0 e "a receber" · 26/10/2026 · teste

- **Onde:** `mapearPedido99` (`lib/canais/noventaenove/mapear.ts`).
- **Causa:** com entrega da 99 a 99Food manda o preço no "modelo 1" (sem `real_pay_price`/`delivery_price`); o total
  virava 0 e o desconto, o pedido inteiro. E dinheiro com entregador da 99 ficava "a receber", mas o roteiro de
  homologação manda tratar como pago (a loja recebe online). O CEP era lido de `postalCode` (a doc usa `postal_code`).
- **Como evitar:** testar os DOIS fluxos de entrega (loja e 99) com o JSON de exemplo da doc de cada modelo de preço.
- **Teste:** `lib/canais/noventaenove/mapear.test.ts`.

## Item só com vídeo aparecia sem imagem na lista da vitrine · 26/10/2026 · teste

- **Onde:** card da lista e dos destaques da vitrine (`ProductThumb`/`ProductImage` em `app/loja/[slug]/vitrine.tsx`).
- **Causa:** o card só tocava o vídeo com "No card da página inicial" marcado, e essa opção vem desmarcada. Item sem
  foto e com vídeo ficava sem imagem nenhuma na lista; o dono achou que o vídeo não tinha sido salvo.
- **Como evitar:** decisão de "o que mostrar no card" passa por `videoNoCard` (`lib/video-vitrine.ts`): vídeo quando
  marcado OU quando não há foto. Card nunca fica vazio se o item tem alguma mídia.
- **Teste:** `lib/video-vitrine.test.ts` (videoNoCard).

## Alerta "WhatsApp desconectado" repetia a cada 6 h por dias · 27/10/2026 · teste

- **Onde:** monitor do WhatsApp (`decidirMonitor` em `lib/whatsapp-monitor.ts`), push "🔴 WhatsApp desconectado".
- **Causa:** (1) a proteção da desconexão pelo painel valia só 30 min contados de AGORA; passado esse tempo, a loja
  desconectada de propósito (Menuzia, 23/10) virava "caiu sozinho" e alertava; (2) o alerta repetia a cada 6 h sem fim
  (Nossa Cozinha, fora desde 20/10, recebia 4 push por dia).
- **Como evitar:** "manual" compara a hora da QUEDA com a da desconexão pelo painel (não com agora). Alerta na queda +
  um lembrete depois de 24 h; queda com mais de 48 h não lembra mais (a faixa vermelha do painel continua).
- **Teste:** `lib/whatsapp-monitor.test.ts`.

## Enxurrada de eventos de conexão do WhatsApp (75 mil em 2 h) · 28/10/2026 · teste

- **Onde:** webhook da loja (`processarEntrada` em `lib/mensageria/entrada.ts`) e monitor (`monitorarLoja` em
  `lib/whatsapp-monitor.ts`).
- **Causa:** em 27/10, 16h–18h, a instância da Ponto 400 mandou ~75 mil CONNECTION_UPDATE ("connecting", "close" 440/503).
  Cada evento fazia ~5 consultas (config, loja, monitor, auditoria, registro) e, no "close", o monitor chamava
  `/instance/connect` — com motivo 440 (sessão aberta em outro lugar) a reconexão derrubava a outra sessão, que derrubava
  esta: 1.245 "reconectado" e 3.043 "caiu" em 7 dias. ~375 mil requisições em 2 h, no dia em que o Supabase bloqueou o
  projeto por egress (19h38).
- **Como evitar:** o mesmo evento (loja + estado + motivo) em 60 s sai antes de qualquer consulta; sem reconexão
  automática em 440/401; no máximo 3 reconexões automáticas por loja por hora (`lib/mensageria/conexao-repetida.ts`).
  O vigia (`lib/saude/vigia.ts`) avisa no WhatsApp do dono se as requisições passarem de 2× a média.
- **Teste:** `lib/mensageria/conexao-repetida.test.ts`, `lib/mensageria/entrada-conexao.test.ts`.

## Build quebrou: biblioteca só de servidor no código do navegador · 28/10/2026 · teste (B6)

- **Onde:** `lib/custo/alerta-whatsapp.ts` (importado pela guarda de custo, que entra na tela de Ajustes pelo frete).
- **Causa:** o alerta passou a importar o envio do vigia → push → `web-push` → `net`. tsc e vitest passaram; o `next build`
  do Coolify falhou ("Can't resolve 'net'") e a versão anterior ficou no ar.
- **Como evitar:** quem roda no navegador só grava (alerta pendente em `sistema_alertas`); o envio é do cron
  (`despacharPendentes` em `lib/saude/vigia.ts`). O teste segue os imports a partir de frete/guarda/geocodificação e
  falha se chegar em web-push, ffmpeg-static, sharp, pg ou net.
- **Teste:** `lib/guardas/bundle-cliente.test.ts`.
