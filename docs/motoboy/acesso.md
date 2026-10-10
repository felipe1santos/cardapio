# Acesso do motoboy (10/10/2026)

**Um cadastro só, um jeito só de entrar.**

- **Cadastro:** motoboy = UM usuário (cargo Motoboy, papel `entregador`) ligado a UM registro em `entregadores`
  (`lib/motoboy/cadastro.ts`). Criar pela Equipe cria o entregador; criar em Pedidos › Entregadores cria o login
  (aparece na Equipe). Editar, pausar, desativar e excluir em um reflete no outro.
- **Sem painel:** o cargo Motoboy não tem nenhuma permissão. O middleware manda a sessão de motoboy de `/admin` para
  `/motoboy` e responde 403 em `/api/admin`. A tela de usuário esconde as permissões e mostra o aviso do app.
- **Entrar:** `app.menuzia.com.br/login` (login e senha) ou o QR da comanda (`/r/<código>` → app no pedido; sem
  sessão pede o login e volta ao pedido). Dono/gerente logado que escaneia o QR confere a rota em `/admin/rota-qr/<pedido>`.
- **Senha:** gerada pelo servidor (4 letras + 4 números), aparece UMA vez na tela Acesso (copiar / WhatsApp). Nunca é
  guardada nem exibida de novo; "Gerar nova senha" invalida a anterior.
- **Sessão:** fica até o motoboy sair ou a loja pausar/desativar — o app confere o cadastro a cada ação (`quem()` em
  `app/api/motoboy/[[...rota]]`), então pausar derruba na próxima ação.
- **App (PWA):** "Menuzia Entregador" (`/api/motoboy/manifest`, `start_url /motoboy`). Android: botão "Instalar app";
  iPhone: "Compartilhar › Adicionar à Tela de Início" (no iPhone o app instalado pede o login uma vez).

## Fim do link mágico (`/entregador/<token>`, sem senha)

- Vale até o motoboy entrar pela 1ª vez com login e senha (o login troca o token) e, para todos, até
  **17/10/2026 23:59 (Brasília)** — `lib/motoboy/link-magico.ts` (`LINK_MAGICO_ATE` no Coolify muda o prazo).
- Enquanto vale, o app avisa: "Peça seu login e senha ao restaurante. Em breve este link deixa de funcionar."

### Quem ainda depende do link (10/10, entregadores ativos sem login)

| Loja | Motoboy | Último acesso pelo link |
|---|---|---|
| Estância Burger | Helder | 21/08 |
| Estância Burger | Miguel | 13/08 |
| Ponto 400 | Cleyverson | 01/10 |
| Ponto 400 | Guilherme o 01 | 03/10 |
| Ponto 400 | Junin Motoboy | nunca |
| Ponto 400 | ld motoboy | nunca |
| Ponto 400 | Lucas 2 | 15/07 |
| Villa Lanches | Carlos F | 23/09 |
| Menuzia (teste) | Jose, pedro | — |

A loja cria o login em Pedidos › Entregadores › Acesso › **Criar login** e envia pelo WhatsApp.
