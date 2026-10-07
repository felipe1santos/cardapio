# Preparar a remoção do Assistente antigo (0.1.23) — plano, NÃO executado

Noite 5 (2026-10-07). Nada foi removido: o Assistente antigo continua funcionando em todas as
lojas. Este documento lista o que precisa acontecer antes e o que sai do código quando o dono
mandar.

## Quem ainda depende do antigo (produção, leitura de 07/10 07:35)

| Loja | Modo do Beta | Antigo ativado / último sinal | Beta (computador, versão, sinal) | Pedidos 7 dias |
|---|---|---|---|---|
| estancia-burger | teste (comanda pelo antigo) | sim · 04/10 22:35 | nenhum | 28 |
| ponto-400-hamburgueria | teste (comanda pelo antigo) | sim · 06/10 23:31 | DESKTOP-3POGG3V beta.6 · 06/10 23:31 | 52 |
| villa-lanches | teste (comanda pelo antigo) | sim · 06/10 23:38 | PC-PRINCIPAL beta.9, NOTEBOOK-BALCÃO beta.9 | 38 |
| menuzia | caixa (MISTO: comanda no antigo, pré-conta no Beta) | sim · 07/10 07:32 | DESKTOP-BIE4TTM beta.9 | 37 (testes) |
| pizza-do-rosa | caixa (MISTO) | **desativado** | DESKTOP-BIE4TTM beta.6 · 28/09 | 0 |
| db-doces, mama-pizza, nossa-cozinha, teste, w-lanches-reviver | teste | desativado, nunca conectou | nenhum | 0–2 |

Antes de remover, TODA loja que imprime precisa estar em "Cozinha e Caixa" (Assistente novo
para comanda e pré-conta), com o computador no beta.10 ou mais novo e uma semana sem falha.

## Ordem proposta (cada passo com o dono)

1. Publicar o beta.10 (checklist abaixo) e pedir às lojas que instalem por cima.
2. Loja a loja, no horário sem movimento: Impressão › Assistente novo › conectar (link ou
   instalador da loja) › escolher Cozinha e Recibo/Extrato › "Passar a comanda para o novo".
   Ordem sugerida: Villa (2 PCs já no beta.9), Ponto 400 (PC no beta.6), Estância (sem Beta).
   Menuzia e Pizza do Rosa: sair do modo misto (ver relatório da noite 5).
3. Uma semana com as lojas imprimindo só pelo novo (acompanhar `impressao_trabalhos` com erro
   e pedidos com `impresso=false`).
4. Esconder a opção "Assistente antigo" da tela para lojas que já passaram (sem apagar dados).
5. Só então, num commit próprio, remover o código abaixo.

## O que sai do código no passo 5

- Painel: opção "Assistente antigo" em `components/impressao/painel-impressao.tsx` (cartão,
  impressoras do antigo, token, "Voltar ao antigo"); `situacaoAntigo` em `lib/impressao/opcao.ts`.
- `DOWNLOAD_ASSISTENTE_ATUAL` (`lib/impressao/rotulos.ts`) e o guia do antigo.
- Rotas do token da loja: `app/api/admin/impressao/token`, o caminho `legado` de
  `identificarAgente` (`lib/impressao/credenciais.ts`) e o ramo legado de
  `app/api/agente/pedidos/route.ts` (reserva da cozinha para quem não é agente pareado).
- No Assistente (`printer-agent/src/main.js`): os ramos `!EH_BETA` (token, impressora única,
  `imprimirTexto` com `print.ps1`). **`recibo.js` e `print.ps1` não são alterados** (CLAUDE.md §7);
  saem inteiros só quando nenhum computador os usar.
- Banco (migration própria, depois de tudo): `restaurantes.impressao_agente_token`,
  `impressao_agente_visto_em`, tabela `impressoras` do antigo — só depois de backup e com o
  código antigo já fora do ar. Modo `caixa` do `impressao_beta_modo` deixa de existir.

## Rollback

Até o passo 4, voltar é um clique por loja ("Voltar ao antigo" grava "Somente teste"). Depois do
passo 5, rollback = redeploy do commit anterior + reinstalar o 0.1.23 nas lojas.

---

# Checklist — publicar o Assistente beta.10 e trocar o link

Instalador gerado localmente (NÃO publicado):
`printer-agent/dist-beta/AssistenteMenuziaBeta-Setup-0.2.0-beta.10.exe`, 82.173.507 bytes,
SHA-256 `b5061e0676af360184943228b8c1017e7153b594facb7bb329bab384e9a58431`.

1. Instalar por cima num computador de teste (não o da Menuzia) e conferir: abre a tela simples
   ("Conectado à sua loja" / "ainda não está conectado"); registro técnico recolhido.
2. Painel da loja de teste › Impressão › "Conectar este computador": o Windows pergunta se abre o
   Assistente → conecta sozinho; o bloco do computador mostra "Computador X conectado".
3. "Desconectar" no painel: o computador para de imprimir; conectar de novo com o link.
4. Impressora em "Automático" (Impressão › Avançado): imprimir teste; conferir "Última impressão
   saiu direto pela fila USB (ESC/POS)" e, numa impressora sem ESC/POS, "pelo driver".
5. Criar a pré-release (o dono roda, com `!`):
   `gh release create printer-agent-v0.2.0-beta.10 printer-agent/dist-beta/AssistenteMenuziaBeta-Setup-0.2.0-beta.10.exe --prerelease --title "Assistente Menuzia Beta 0.2.0-beta.10" --notes "Pareamento sem código, envio automático, tela simples"`
6. Trocar o link: `DOWNLOAD_ASSISTENTE_BETA` em `lib/impressao/rotulos.ts` para o beta.10 (isso
   também liga os botões "Conectar este computador" e "Baixar instalador da loja") e, se quiser
   o aviso de atualização, `VERSAO_IMPRESSAO_V3` em `lib/avisos-painel.ts`. Commit, deploy.
7. Conferir na Menuzia: baixar o instalador da loja (nome termina em `-c<convite>.exe`), Impressão
   abre sem erro, botões aparecem.
8. Remover o antigo: NÃO faz parte deste checklist (ver plano acima).
