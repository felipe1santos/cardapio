# Relatório — noite 5 (2026-10-07)

## Resumo (10 linhas)

1. **Noite 4 fechada**: #170/#171 expiraram sozinhos; relatório da noite 4 finalizado (`86c2e2a`).
2. **Pix online liberado para todas as lojas** (0155, 05:14): nada muda para quem não conectou o Mercado Pago; mensagem pronta em `docs/pix-online/mensagem-lojistas.md`.
3. **Sacola com item indisponível** (05:54, `89f5fb7`): a sacola confere cada item antes de "Fazer pedido", marca "Indisponível no momento" e oferece "Remover". Conferido na Menuzia.
4. **Auditoria de abrir/fechar a loja** (0156, 06:25, `47c3e2b`): quem, quando, de→para e de onde (Kanban/Ajustes/sistema/horário). Conferido na Menuzia.
5. **Campanhas sem o botão "Envio automático"** (06:54, `44579c9`): nenhuma loja tinha o envio desligado. Conferido na Menuzia.
6. **Menu principal no desenho dos submenus**: pronto e testado, enviado à main (`c862fd1`), **não publicado** — o build falhou: **disco do servidor cheio**.
7. **Impressão (item 6)**: sem modo misto escondido, envio automático (0157), pareamento sem código e tela simples do Assistente — pronto e testado na branch `noite5-item6-impressao`, **não publicado** (mesmo motivo). 0157 só ensaiada em produção.
8. **Assistente beta.10** gerado só no computador (sem release, link não trocado). Checklist e plano de remoção do antigo em `docs/impressao/remocao-assistente-antigo.md`.
9. **Modo misto**: Menuzia e Pizza do Rosa. Pizza do Rosa está com o antigo desativado — se voltar a imprimir, **a comanda não sai**. Nenhuma configuração de loja foi mudada.
10. **Precisa de você**: liberar espaço no servidor (Coolify) e redeploy; aplicar a 0157 antes do deploy do item 6; decidir o modo das duas lojas mistas; publicar o beta.10.

Nenhum rollback foi necessário. Pedidos de teste: nenhum criado nesta noite (conferências só olhando telas).

---

## Item 0 — Fechar a noite 4
- #170 e #171 terminaram como `pix_expirado` (o MP cancelou); QR mostrava "Pague até 04:50 (horário de Brasília)".
- Chave Pix verificada em produção: `{"resultado":"ok"}`. Relatório da noite 4: `86c2e2a`.

## Item 1 — Pix online para todas as lojas
- **Publicado** 05:14 (BRT). Commit `56fd25c`. Migration **0155** (flag ligada nas lojas, padrão `true` para lojas novas). Rollback: `docs/rollback/0155_pix_online_todas_as_lojas.down.sql`.
- Backup: `C:\Users\felipe\menuzia-backups\pix-flag-antes-0155-2026-10-07.json`. Sem deploy (só banco e docs).
- Conferência: só a Menuzia tem conta conectada; as outras lojas não mostram "Pagar agora" (API e tela).
- Testes: `scripts/pix-online/e2e-todas-as-lojas.mjs` 8/8. Acompanhamento 20 min: sem problema (só erros de robô "Server Reference ID").
- Prints: `Downloads/revisao-noite-5/item1`. Mensagem aos lojistas: `docs/pix-online/mensagem-lojistas.md`.

## Item 2 — Sacola com item indisponível
- **Publicado** ~05:54. Commit `89f5fb7`. Sem migration.
- Nova rota `POST /api/loja/[slug]/sacola/conferir` com a MESMA regra de preço do pedido (`precificarLinhas`). Vitrine nova e clássica: linha "Indisponível no momento" + "Remover", "Continuar" travado com motivo, banner "Remover e continuar"; preço mudado atualiza com aviso.
- Conferência na Menuzia: item pausado aparece indisponível com "Remover" (print `item2/producao-menuzia-sacola.jpg`); sacola do navegador limpa depois.
- Testes: `scripts/vitrine/e2e-sacola-indisponivel.mjs` 22/22; vitest ok. Acompanhamento 20 min ok.

## Item 3 — Auditoria de abrir/fechar a loja
- **Publicado** ~06:25. Commit `47c3e2b`. Migration **0156** (gatilho em `restaurantes.status_loja`, nunca bloqueia a mudança). Backup dos gatilhos: `menuzia-backups/triggers-restaurantes-antes-0156-2026-10-07.json`; ensaio em savepoint antes. Rollback: `docs/rollback/0156_auditoria_abrir_fechar_loja.down.sql`.
- Nova tarefa Coolify "Loja aberta/fechada (horário)" a cada minuto (registra abriu/fechou pela grade, sem repetir).
- Conferência na Menuzia: fechar/abrir pelo Kanban gerou 2 eventos "Administrador · kanban · computador"; loja voltou a "fechada (manual)". Cron registrou as 7 lojas automáticas às 06:33.
- Limitação: o IP gravado quando a mudança vem pelo Kanban é o do servidor (a rota grava por ele). Melhoria futura: mandar o IP do navegador num cabeçalho.
- Testes: `scripts/seguranca/e2e-auditoria-loja.mjs` 10/10. Acompanhamento 20 min ok (09:33–09:53 UTC).

## Item 4 — Menus + Integrações
- 4a/c/d/e/f: já estavam publicados (64e5a77 + hotfix 685d9cb); regressão `e2e-menus-integracoes` 41/41.
- 4b **Publicado** 06:54. Commit `44579c9`. Sem migration. Botão "Envio automático ligado" saiu de Campanhas; em Ajustes › Mensagens automáticas não há mais chave geral (título "Avisos de status do pedido"). Loja que já estivesse com envio desligado continuaria igual e veria "envio pausado — fale com o suporte".
- Conferência na Menuzia (Angus Burguer): Campanhas sem o botão; Mensagens automáticas sem a chave; nada clicado. WhatsApp não foi conectado.
- Testes: campanhas 72/72, menus 41/41, vitest 2100. Acompanhamento 20 min ok (09:58–10:23 UTC). Prints (local): `item4/`.

### Lojas com "envio automático" desligado
**Nenhuma.** Todas estavam com o padrão (ligado). O comportamento delas não mudou.

## Item 5 — Menu principal no desenho dos submenus
- **NÃO publicado** — enviado à main (`c862fd1`), mas o build do Coolify falhou às 10:33 UTC com `No space left on device` (disco do servidor cheio). Produção continua no `44579c9` (item 4), no ar normalmente (cron e páginas respondendo).
- O que muda: fonte Nunito, ícones Material cinza 20 px, item ativo com fundo cinza-claro arredondado (sem a borda azul), mesmos espaçamentos dos submenus; letra 14 px e respiro 10 px para "Painel de Pedidos" e "Ver meu cardápio" não cortarem. Ordem, nomes, selos ("Novo", contador) e a gaveta do celular iguais; selos em peso 600 (regra do peso máximo).
- Prints antes/depois: `Downloads/revisao-noite-5/item5` (1366 Dashboard e Campanhas; celular 390).
- Testes: sidebar 8/8, vitest 2100, `e2e-menu-lateral` 16/16, `e2e-celular-p7` 31/31, menus 41/41, `e2e-responsivo-kanban` 3/4 (a falha é do botão `balcao-novo` do PDV, sem relação com o menu — dado local).
- Para publicar: liberar o disco e clicar Redeploy (a main já tem o commit).

## Item 6 — Impressão
**NÃO publicado** (disco cheio). Branch `noite5-item6-impressao` (último commit da branch, sobre o item 5).

### 6a — Modo misto
O produto não deixa mais **escolher** "Somente Caixa" (API devolve `modo_misto_descontinuado`); loja que já está nele continua igual e vê **"Modo misto"** escrito em destaque, em vermelho quando o antigo está desligado ou sem sinal ("a comanda da cozinha não está saindo"), com "Passar a comanda para o novo". Print: `item6/modo-misto-1366.png`. Nenhuma loja real foi alterada.

| Loja | Situação hoje | Risco | Correção proposta (você decide) |
|---|---|---|---|
| **pizza-do-rosa** | Modo misto; antigo **desativado**; Beta (DESKTOP-BIE4TTM, beta.6) sem sinal desde 28/09; 0 pedidos em 7 dias | Se a loja voltar a vender, **a comanda não imprime** | Antes de reabrir: instalar o beta.10 no PC da loja e "Passar a comanda para o novo" (ou "Voltar ao antigo" e ativar o antigo) |
| **menuzia** | Modo misto; antigo ativo e com sinal; Beta beta.9 com sinal | Baixo (loja de teste), mas confunde quem testa | "Passar a comanda para o novo" quando quiser testar o fluxo completo do Beta |

As demais lojas estão em "Somente teste" (tudo pelo antigo) — sem modo misto.

### 6b — Envio direto automático
- Migration **0157** (aditiva): `envio = 'auto'` + `envio_caminho/_em/_obs`. Nenhuma impressora muda (padrão segue "driver"). Rollback: `docs/rollback/0157_impressao_envio_automatico.down.sql`.
- Em Impressão › Avançado, opção **"Automático — direto (ESC/POS) e, se falhar, pelo driver"**. O Assistente beta.10 escolhe: rede (IP:9100) se a impressora tem IP; fila USB (RAW) se o driver é de térmica (POS-80, Generic/Text Only, Epson TM, Elgin, Bematech…); impressora virtual ou comum → driver. Falhou o direto → imprime pelo driver na hora e evita o direto por 10 min. O caminho usado aparece em Avançado ("Última impressão saiu direto pela fila USB…").
- Compatível: beta.6–beta.9 tratam `auto` como driver (o printer.js antigo só conhece fila/rede); o antigo não lê esse campo.
- 0157 em produção: **só ensaio** (backup `menuzia-backups/impressao-dispositivos-antes-0157-2026-10-07-ensaio.json`, 40 impressoras, 3 colunas criadas, 0 impressoras mudadas, desfeito). Aplicar com `ENSAIO=0 node .medidas/aplicar-0157.mjs` **antes** do deploy do item 6 (o painel novo lê as colunas novas).

### 6c — Pareamento sem código
- Convite de **24 h e uso único**, na mesma tabela do código (sem migration). Dois caminhos: link `menuzia://parear?c=…` ("Conectar este computador") e **instalador da loja** (o mesmo instalador, com o convite no nome do arquivo; o Assistente acha em Downloads na primeira abertura). O código de 8 letras continua valendo.
- No painel: "Computador X conectado" + **Desconectar** no bloco do computador.
- Os botões novos só aparecem quando o link oficial for o beta.10 — até lá a tela é a mesma de hoje (publicar o servidor agora não muda nada para as lojas).
- Auditoria: "Gerou link/instalador para conectar computador (sem código)" — sem o valor do convite.

### 6d — Tela simples do Assistente (beta.10)
Um estado grande ("Conectado à sua loja" / "ainda não está conectado"), o que fazer, a última impressão e "Desconectar este computador"; código e registro técnico recolhidos.

### 6e — Remoção do antigo (preparada, NÃO feita)
Plano e inventário em `docs/impressao/remocao-assistente-antigo.md`.

### Testes do item 6
- Novo `scripts/impressao/e2e-noite5-impressao.mjs` **26/26**.
- `e2e-assistente-beta` 49/49 (atualizado para o modo misto), `e2e-impressao-v2` 41/41 (agentes virtuais rodando o `main.js` novo — compatibilidade de pareamento por código), `e2e-tela-impressao` ok (sozinho; rodando logo após o v2 falha 1 por computador virtual ainda "online" — ordem dos testes).
- Unitários: `envio-auto` 5, `convite` 3, impressão 151; vitest completo 2108 (após o rótulo da auditoria).

### Instalador beta.10 (local, sem release)
`printer-agent/dist-beta/AssistenteMenuziaBeta-Setup-0.2.0-beta.10.exe` — 82.173.507 bytes — SHA-256 `b5061e0676af360184943228b8c1017e7153b594facb7bb329bab384e9a58431`. Não instalado neste PC (o Beta daqui imprime a Menuzia) e não publicado.

---

## Checklist — publicar o beta.10 e remover o antigo
1. Liberar o disco do servidor e publicar itens 5 e 6 (abaixo).
2. Instalar o beta.10 por cima num computador de teste (não o da Menuzia): tela simples ok.
3. Painel › Impressão › "Conectar este computador" → conecta sozinho; "Desconectar" funciona.
4. Impressora em "Automático": imprimir teste, ver o caminho em Avançado (térmica = direto; PDF = driver).
5. `gh release create printer-agent-v0.2.0-beta.10 printer-agent/dist-beta/AssistenteMenuziaBeta-Setup-0.2.0-beta.10.exe --prerelease --title "Assistente Menuzia Beta 0.2.0-beta.10" --notes "Pareamento sem código, envio automático, tela simples"` (você roda com `!`).
6. Trocar `DOWNLOAD_ASSISTENTE_BETA` (`lib/impressao/rotulos.ts`) para o beta.10 → commit → deploy. Isso liga os botões de conectar sem código.
7. Remover o antigo: só seguindo o plano (todas as lojas no novo + 1 semana sem falha). **Não feito.**

## Decisões tomadas sozinho
- **Disco cheio**: não limpei o servidor (apagaria imagens usadas para rollback) — parei as publicações 5 e 6. Produção ficou no item 4, no ar.
- Item 5: letra 14 px e respiro 10 px (e não 14,5/12 dos submenus) — com a medida exata, "Painel de Pedidos" e "Ver meu cardápio" cortavam em 232 px.
- Modo misto: bloqueado só para **novas escolhas**; o recuo automático de segurança (quando some a impressora da cozinha, a cozinha volta ao antigo e a pré-conta segue no Beta) foi mantido — senão a pré-conta pararia de sair.
- Envio automático: a escolha direto/driver fica no Assistente (ele sabe o driver da impressora); impressora virtual nunca vai direto.
- Instalador da loja: o servidor entrega o instalador oficial com o convite no nome (não gera um instalador por loja). Só aparece com o beta.10 no link oficial.
- Conferências da noite só olhando telas na Menuzia (sem pedidos de teste).

## O que precisa de você
1. **Liberar espaço no servidor** (Coolify › Servidor › Docker Cleanup, ou disco maior). A limpeza automática roda às 00:00 e não deu conta de hoje. Depois: **Redeploy** (publica o item 5, já na main).
2. Item 6: `ENSAIO=0 node .medidas/aplicar-0157.mjs` (backup + 0157), depois `git push origin noite5-item6-impressao:main` e Redeploy; conferir Impressão na Menuzia (deve mostrar "Modo misto" em amarelo).
3. Decidir o modo da **Pizza do Rosa** (comanda não sai se ela voltar a vender) e da Menuzia.
4. Publicar o beta.10 (checklist acima).
5. Teste de push do app: rodar depois das 8h (regra de horário).
6. Melhoria do IP na auditoria de abrir/fechar (opcional).

---

# Publicação da manhã (07/10, 08:30–09:50 BRT)

## 0 — Disco do servidor (limpeza autorizada pelo dono)
- Antes: 96 GB, **95 GB usados, 985 MB livres (99%)**; imagens 97,5 GB (62 GB recuperáveis), cache de build 40 GB. Produção na imagem `44579c9`.
- Coolify › Servidor › Docker Cleanup › Run Cleanup (11:34 UTC, 4 min 57 s, sucesso), mantendo volumes, redes e imagens retidas.
- Depois: **25 GB usados, 72 GB livres (26%)**; imagens 21,4 GB, cache de build 0, volumes 16 → 16 (intactos). Do app ficaram a imagem de produção e a anterior. Site 200 e tarefas agendadas ok durante toda a limpeza.
- Automático: limpeza a cada 6 h (`0 */6 * * *`, era 1×/dia), mantendo as imagens retidas (o app guarda 2 = produção + anterior) e limpando o cache de build; checagem do disco a cada hora (`0 * * * *`, era 1×/dia) com alerta acima de 80%.
- **Alerta**: o Coolify não tem nenhum canal de aviso ligado (e-mail, Telegram etc. desligados) — falta configurar um (precisa de token/senha: feito por você).
- Não precisa aumentar o disco agora: 25 GB em uso normal; o que encheu foram ~40 GB de cache de build + imagens de vários deploys no mesmo dia, com limpeza só 1×/dia.

## 1 — Item 5 publicado
- Deploy `g7w0zsl8…` concluído 11:52 UTC (main `4e1a794`). Fontes ok (classes `fonte-*` no CSS, arquivos `/fontes/*.woff2` 200).
- Conferência na Menuzia (Angus Burguer): menu em Nunito, ativo "Dashboard" com fundo #EEF0F3, mesmos 15 itens e selo "Novo". Print `item5/producao-menuzia-menu.jpg`.
- Acompanhamento 20 min (11:58–12:13 UTC): sem problema.

## 3 — Item 6 publicado
- 0157 aplicada antes do deploy: backup `menuzia-backups/impressao-dispositivos-antes-0157-2026-10-07.json` (40 impressoras), ensaio ok, aplicada, 0 impressoras mudadas.
- main `867b765` (fast-forward da `noite5-item6-impressao`), deploy `jo8xj5if…` concluído 12:27 UTC. Fontes ok; `/api/agente/caminho` sem credencial = 401.
- Conferência na Menuzia: aviso "Modo misto" em amarelo (antigo com sinal), "Computador DESKTOP-BIE4TTM conectado"; botões de conectar sem código escondidos (link ainda é o beta.9). Print `item6/producao-menuzia-modo-misto.jpg`.

## 4 — Menuzia no Assistente novo completo
- Cozinha e Recibo/Extrato estavam no pareamento antigo deste PC (sem sinal desde 05:23 UTC); passados para o pareamento ativo (mesma impressora "Microsoft Print to PDF") e modo "Cozinha e Caixa". Tela: Cozinha pronta, Caixa pronto, sem aviso de modo misto. Print `item6/producao-menuzia-beta-completo.jpg`.
- Atenção: a comanda dos pedidos de teste da Menuzia agora sai pelo Beta neste PC, numa impressora PDF (abre a janela de salvar).
- O pareamento antigo do mesmo PC (sem sinal) continua lá; dá para "Desconectar" depois.

## 5 — Teste de push
Não rodado: a memória do PC estava em 0,1–0,2 GB livres.

## Pizza do Rosa
Ignorada a pedido do dono (só usa o cardápio pelo QR Code). Configuração não mexida.
