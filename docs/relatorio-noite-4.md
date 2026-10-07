# Relatório — noite 4 (2026-10-07)

## Resumo (10 linhas)

1. **#164 e #165** encerrados como "Não entregue" pela Logística; pedidos de teste #164–#170 todos encerrados.
2. **Hotfix do loop (Integrações)**: regressão completa verde; novo teste pega o loop se ele voltar (`685d9cb`, `761da48`).
3. **Pix: horário** — a tela mostrava o contador como se fosse hora; agora "Pague até 04:50 (horário de Brasília)" + "Faltam mm:ss", pelo relógio do servidor. Conferido em produção (#170).
4. **Pix: prazo** — o MP cancela Pix com vencimento < 30 min; ele recebe no mínimo 31 min e o pedido vence pelo prazo da loja.
5. **Pix: chave** — sem chave Pix: aviso amarelo, vitrine sem "Pagar agora", pedido recusado; "Verificar de novo" libera (`3be1f45`).
6. **Pix: notificações** antigas do MP (sem assinatura e sem type) ignoradas sem gravar; aviso "conectada" uma vez só.
7. **Menus por cima** (regra 3): "Pausar" da Equipe e os dois "Atribuir" da Logística no portal (`675aa08`), conferido em produção.
8. **Vitrine** publicada: ilustrações deslogado, perfil novo, ficha "Sobre a loja" + migration 0154 com backup e conferência (`93a2f86`).
9. **Guia da loja piloto** do Pix em `docs/pix-online/loja-piloto.md`.
10. **Pendências**: teste de push só depois das 8h (regra de horário); falha antiga no teste de Mesas (aviso "somente visualização", da tela compacta de 06/10).

---

## Item 0 — #164 e #165

Marcados Pronto no Kanban, atribuídos aos entregadores de teste (jose, pedro) e encerrados com
**Não entregue** na Logística. Status final no banco: `cancelado`. #166, #168, #169, #170
cancelados pelo sistema (Pix sem pagamento); #167 (o pago de R$ 1,00) entregue.

## Item 1 — Regressão do hotfix do loop

Ambiente: WSL religado; o Docker tinha subido também o Supabase de outro projeto
("painel-engenharia"), parado para liberar memória; portas do WSL não respondiam após o
reinício — reiniciados os contêineres do Kong e do Postgres da Menuzia.

| Lote | Resultado |
|---|---|
| Integrações (menus + modelo) | 41/41 (com a nova checagem: 8 s parada, sem releituras) |
| Integrações fase 1 (Pixel, robô) | 26/26 |
| Pix online (MP simulado) | 54/54 |
| Robô WhatsApp | 107/107 |
| Central de atendimento | 71/71 |
| Campanhas | 72/72 |
| Pixel / API de Conversões | 48/48 |
| Ajustes (salvar) | ok |
| Push do app | 36/56 — **horário**: marketing por push não sai antes das 8h (`INICIO_PERMITIDO`); passou 68/68 às 23:50. Rodar de novo depois das 8h. |
| vitest | 2095/2095 |

## Item 2 — Correções do Pix online (`3be1f45`)

- **a) Horário**: `components/vitrine/tela-pix-online.tsx`. "Pague até HH:MM (horário de
  Brasília)" com `Intl` em `America/Sao_Paulo`; "Faltam mm:ss" separado; o desvio do relógio
  do aparelho é corrigido pelo cabeçalho `Date` de cada consulta. Teste de componente com
  aparelho 10 min adiantado. Produção (#170): 04:35 → "Pague até 04:50", "Faltam 14:52".
  Print: `Downloads/revisao-pix-correcoes/producao-qr-pedido-170.jpg`.
- **b) Prazo**: `vencimentoNoMp()` manda ao MP `max(prazo, 31 min)`; o pedido vence pelo prazo da
  loja (mínimo 5) e a verificação periódica cancela no MP o que passar. MP simulado agora imita
  o real (vencimento < 30 min nasce cancelado). Produção: #170 venceu às 04:50:17 e às 04:52 já
  estava `cancelado` / `pix_expirado`, cobrança `cancelled` no MP.
- **c) Chave Pix**: o MP não lista chaves; ao conectar (e em "Verificar de novo") uma cobrança de
  sondagem de R$ 1,00 é criada e **cancelada na hora**. Erro "without key enabled for QR render"
  → `pagamentos_contas.erro = 'sem_chave_pix'` (sem migration). Com a marca: aviso amarelo
  (#92400E sobre #FEF3C7, 6,6:1), `pixOnlineDaLoja` → inativo, pedido com Pix recusado. Pix real
  criado com sucesso limpa a marca. Não rodei a sondagem na conta real da Menuzia (já tem chave;
  a sondagem cria e cancela uma cobrança lá).
- **d)** Aviso de conexão uma vez só (ref no cartão) e sem loop (hotfix) — conferido no e2e.
- **e)** Notificação no formato antigo do MP (`?topic=…`, sem `x-signature` e sem `type`) → 200
  sem gravar. Com `type` e sem assinatura continua 401 e registrada (sinal de fraude).

Testes: `scripts/pix-online/e2e-correcoes.mjs` 19/19; e2e-pix-online 54/54; vitrine p9 54/54;
vitest 2098 (uma rodada de 4 teve 1 falha intermitente que não se repetiu e não deixou o nome).

## Item 3 — Menus por cima (`675aa08`)

- Equipe: menu "Pausar/Bloquear" agora em `Flutuante` (portal, camada máxima); só a cópia
  visível (tabela ou cartão do celular) abre. e2e equipe 76/76 com checagem "inteiro na tela e
  por cima". Produção: conferido na Menuzia (menu por cima, dentro da tela), sem clicar em Pausar.
- Logística: os dois "Atribuir" (por pedido e em lote) no `Flutuante`; o remendo de "abrir para
  cima" saiu. e2e estabilidade: passos de Logística ok.
- Varredura: os outros menus de tabela (Clientes CSV, Superadmin, cardápio, ⋮ do celular) já
  usavam o `Flutuante`. Ficaram como estão (fora de tabela): filtro e calendário de Campanhas,
  paleta de cor da descrição e o aviso das notificações de pedido.
- **Pré-existente, sem relação**: `e2e-estabilidade-operacional` 48/49 — o aviso de mesa em
  "somente visualização" fica escondido desde a tela compacta de Mesas (`9f4140e`, 06/10).

## Item 4 — Vitrine (`93a2f86`)

- Pedidos e Cupons deslogado com as ilustrações; perfil (avatar, "Confirmado", só "Editar dados"
  e "Sair da conta"; telefone fixo na edição); ficha "Sobre a loja" com logo, status, WhatsApp e
  Instagram com ícones oficiais, endereço com mapa e taxa.
- **0154** (leitura anônima de `instagram_url`): ensaio local, **backup** das permissões em
  `C:\Users\felipe\menuzia-backups\privilegios-restaurantes-antes-0154-2026-10-07.json`,
  aplicada em produção em transação **antes** do deploy, conferida pela API pública.
- Testes: perfil-ficha-vazios 36/36 (360/390/1366), checkout 13/13, item 57 34/34, resumo
  desktop 9/9, celular sem código 11/11. Produção: ficha conferida na Menuzia.

## Item 5 — Loja piloto

`docs/pix-online/loja-piloto.md`: conta MP, chave Pix (CNPJ), conectar em Integrações, prazo,
teste de R$ 1,00 e o que fazer em cada problema.

## Estado da Menuzia no fim

- Loja **fechada manual** (como estava; reaberta só durante a conferência do QR).
- Item "TESTE Pix R$ 1" **pausado**; Gerente TESTE **pausado**; validade do Pix **15 min**.
- Pedidos abertos que **não** são meus: #160 (mesa/PDV de ontem) e #171 (Pix aguardando, 04:43,
  "FELIPE PERONE SANTOS" — vence sozinho às 04:58).

## Observações

- Memória da máquina: o Supabase local fica no WSL; para testar local é preciso ~2 GB livres.
  WSL desligado no fim (religar: `npx supabase start` na pasta do projeto). O Supabase do
  "painel-engenharia" foi parado (religar na pasta dele).
- Nenhuma outra loja teve configuração alterada.

## Fechamento (início da noite 5, 2026-10-07 ~05:00)

- **#170**: venceu às 04:50:17 e às 04:52 estava `cancelado` / `pix_expirado`, cobrança
  `cancelled` no MP. Tela do QR em produção: às 04:35 mostrou "Pague até 04:50 (horário de
  Brasília)" e "Faltam 14:52" — horário e contador corretos.
- **#171** (teste do dono pelo celular, 04:43): venceu às 04:58:20 e foi cancelado sozinho
  (`pix_expirado`, MP `cancelled`).
- **Checagem da chave Pix em produção**: "Verificar de novo" na Menuzia (Angus Burguer /
  Administrador) respondeu `{"resultado":"ok"}` — sondagem criada e cancelada no MP.
- Menuzia: loja **fechada manual**, item de teste **pausado**, Gerente TESTE **pausado**.
