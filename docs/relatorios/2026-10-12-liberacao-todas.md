# Relatório 12/10/2026 (madrugada) — Liberação para todas as lojas + pendências

Decisão do Felipe sobre `docs/auditoria-so-menuzia.md`. Main `ce75d57` (deploy finalizado 03:23). Próxima migração livre: **0187**.

## Liberado (todas as 10 lojas)

| Item | O quê | Como |
|---|---|---|
| 1, 2 | Letra iFood + foto da lista 110 px | **0186** (aplicada): `vitrine_fonte='ifood'`, `vitrine_imagem_tamanho=110` nas 9 lojas que faltavam; padrão da coluna mudou (loja nova já nasce assim). O dono troca em Ajustes › Aparência |
| 3 | Vitrine nova na firehouse | 0186; padrão `vitrine_nova=true` |
| 26 | Impressão nova na firehouse | 0186, conferido antes: 0 Assistentes e 0 pedidos (não fica sem imprimir); padrão `impressao_somente_nova=true` |
| 5 | Carrossel de fotos na ficha do item | `vitrine.tsx`: sem a chave Novidades |
| 12 | Links para divulgar | Ajustes › Perfil da loja (aba `loja`, existe nos dois menus) |
| 13 | Até 4 fotos no Gestor de Cardápio | `FotosDoItem` para todas; bloco antigo removido |
| 14 | Selo Direto / Sem origem no Kanban | sem a chave Novidades |
| 15 | Vendas por origem no Dashboard | sem a chave Novidades |
| 25 | Mensagens de status formatadas como padrão | `textoPadraoDaEtapa` (lib/mensagens-automaticas.ts) usado em `textoDaNotificacao`; "Restaurar padrão" mostra o formatado. Conferido no banco: só a Menuzia tinha texto próprio (não foi tocado); as outras 9 estavam no padrão. "Pedido aceito" (resumo) continua igual |

Rollback da 0186: `docs/rollback/0186_liberacao_todas_vitrine_impressao.down.sql`.

## Continua só na Menuzia (não liberado)

Menu reorganizado e o que depende dele (itens 8 a 11), Pix online, push para clientes, agendamento, despacho automático,
Agente de IA, Financeiro, Caixa nível 2, Disparos, PDV v2 (segue nas mesmas 6 lojas).

## Pendências feitas

- Bairros de teste da Menuzia apagados (DASDAS, DASDSA, SADASD, jabururna). Ficaram: Jaburuna, jardim asteca, jardim colorado.
  Para recriar: Ajustes › Entrega (taxas eram 2,40 / 2,00 / 3,00 / 2,50).
- `impressao_agente_token` da Estância anulado: nenhuma loja tem mais token do Assistente antigo.
- `public/guia-impressora.html` reescrito só para o Alfa 1 (baixar, parear por código, escolher impressoras, Cozinha e Caixa, alarme).
- Release `printer-agent-v0.1.23` apagado do GitHub (a tag git ficou). Ainda existem os releases 0.1.20–0.1.22 (não pedidos).
- Assistente antigo 0.1.23 desinstalado do PC da Menuzia (DESKTOP-BIE4TTM): processos fechados, desinstalador silencioso,
  pasta e item de inicialização do Windows removidos. Alfa 1 1.2.2 intacto (rodando e com inicialização automática).

## Conferência

- Vitrines públicas das 10 lojas: `vitrineNova:true`, `data-fonte-vitrine="ifood"`, `imagemTamanho:110` em todas.
- Carrossel visto na db-doces ("Cone Cravejado 150g G", setas e pontos). Itens com mais de uma foto hoje: db-doces 1, Menuzia 2, W Lanches 3.
- Menuzia (painel): "Vendas por origem" no Dashboard, selo de origem no Kanban, "Links para divulgar" em Ajustes › Perfil.
- **Loja real no painel: não conferido** — a sessão do navegador é só da Menuzia e não existe "entrar como loja". Nas lojas
  reais a mudança é a mesma linha de código sem a condição (testada no build e nos 2.665 testes).
- Pedido de teste #298 pela vitrine da Menuzia (retirada, cartão, R$ 22,00): criado normalmente; fechado "Não entregue".
- Assistentes: Menuzia 1.2.2 com sinal (< 1 s) depois do deploy. As outras lojas estavam fechadas (último sinal 3–4 h antes,
  Villa 1.1.0 há 1 dia) — conferir no primeiro pedido do dia.
- Testes: 2.665 passaram (261 arquivos); tsc e lint sem erro novo; Regra nº 1 ok. Nenhuma API paga nova.

## Estância: desinstalar o Assistente antigo (mandar à loja)

1. No computador do caixa, abra **Configurações › Aplicativos › Aplicativos instalados**.
2. Procure **"Assistente de Impressão Menuzia"** (o antigo, versão 0.1.x) → **⋯ › Desinstalar** → confirme.
3. **Não** desinstale o **"Assistente Menuzia Alfa 1"** — é ele que imprime.
4. Faça um pedido de teste para confirmar que continua imprimindo.
