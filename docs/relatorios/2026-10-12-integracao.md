# Relatório 12/10/2026 (noite) — Teste de integração de ponta a ponta (Menuzia)

Só conferência e correção. Nenhum código de produção precisou mudar (nada quebrado no sistema); as correções foram nos
**scripts de teste** e no **comando do Semgrep** documentado. Scripts reaproveitáveis: `.medidas/e2e-acessos.mjs`,
`.medidas/e2e-fluxos.mjs` (fluxos 2–4; `SO=4` roda só a mesa), `.medidas/e2e-kds-kanban.mjs`, `.medidas/e2e-whatsapp.mjs`,
`.medidas/e2e-push-limite.mjs`. Todos usam usuários de teste com senha aleatória (nunca impressa) e limpam no fim.

## 0) Semgrep
- Estava "desligado" porque roda via Docker, e o Docker estava parado. **Docker ligado** (continua ligado — pesa uns 2 GB
  no PC de 8 GB; dá para desligar pelo ícone da bandeja quando não estiver usando).
- **Achado de processo (corrigido):** o comando do CLAUDE.md não varria nada nesta worktree — o `.git` aponta para um
  caminho do Windows que não existe dentro do container, o Semgrep não lista arquivos e diz "0 achados" (falso). Corrigido
  com `--no-git-ignore` + saída em JSON fora do repo (CLAUDE.md atualizado; conferir `paths.scanned`).
- Rodada real: **3.664 arquivos, 89 achados, nenhum real em código de produção**:
  - 31 `bypass-tls-verification`: scripts de teste/migração (`rejectUnauthorized:false` no pooler do Supabase) — não é produção.
  - 33 `unsafe-formatstring` (INFO): `console.log` com texto montado — sem risco.
  - 15 `path-join-resolve-traversal`: só em testes (`*.test.ts`), migração e no Assistente (não mexer).
  - 2 `detected-jwt-token` (ERRO): `supabase/.temp/start-secrets` = chaves do Supabase **local** de desenvolvimento, pasta
    no `.gitignore`, nunca foi para o repositório.
  - 2 `unknown-value-with-script-tag`: janela de impressão do QR da Cozinha antiga (nome já limpo) — sem risco.
  - 1 `hardcoded-hmac-key` (teste), 1 `spawn-shell-true` e 1 `incomplete-sanitization` (scripts de teste).

## Tabela

| Fluxo | Passos | Resultado | O que foi corrigido |
|---|---|---|---|
| 1. Equipe e acessos | Caixa, Garçom, Cozinha, Motoboy e Dono de teste; telas e APIs em produção; Disparos bloqueado por instantes | **OK** — 48/48: cada um só o permitido; proibido → "Sem acesso"/403; Motoboy só o app; Dono tudo; com Disparos bloqueado nem o Dono entra (API 403) e o push segue livre | — |
| 2. Vitrine entrega (pagamento na entrega) | checkout (#307, origem Instagram) → Caixa aceita no Kanban → KDS começar/pronto → motoboy (QR) pega, sai, entrega (dinheiro) | **OK** — origem Instagram no pedido; dinheiro com o motoboy R$ 14,00 = total; WhatsApp 5/5 (recebido, aceito, pronto, saiu, entregue); push "aceito" e "saiu" (o push só manda essas etapas na entrega, por projeto) | script: o filtro de avisos procurava o nº do pedido e o texto de "entregue" da Menuzia não tem o número |
| 2. Pix online | pedido com Pix online | **OK** — nasce "aguardando pagamento" com QR do Mercado Pago; cancelado sem pagar | — |
| 2. Cartão online | oferta na vitrine | **OK** (oferecido) / pagamento **precisa do Felipe** (antifraude do MP recusou hoje) | — |
| 3. PDV balcão (retirada) | Caixa abre balcão, lança 2 itens, cobra em dinheiro → aceito → KDS → entregue no balcão → comanda fechada | **OK** — gaveta R$ 22,00 = total | — |
| 4. Mesas e Comandas | Garçom abre a mesa e lança → KDS → servido → pré-conta (Caixa) → pagamento → fechar → mesa liberada | **OK** — recebido R$ 11,00 = conta | script: 1ª rodada fez o Garçom marcar "servido" (403: essa ação só existe no PDV/Caixa) e a conta não fechou; refeito no caminho real. A comanda que ficou aberta na Mesa 01 foi cancelada e a mesa liberada |
| 5. WhatsApp | saudação, taxa (Jaburuna), horário, troca de pagamento, atendente; IA criando pedido | **OK** — IA respondeu taxa R$ 3,00 e horário 08–22; troca de pagamento de pedido já impresso → chama atendente; central marcou "pediu atendente" (Alteração do pedido #306). Pedido pela IA: o **#306 foi feito pelo Felipe** pelo WhatsApp e entrou aceito | — |
| 6. Campanhas | disparo para o número do Felipe; push de campanha | **OK** — disparo **barrado** ("Recebeu outro disparo há menos de 3 dias": ele recebeu às 17:12); 2ª notificação de campanha no dia → **409** (limite 1/dia). SAIR/opt-out testado às 17:12 (opt-out removido; hoje 0) | — |
| 7. Cancelamento pago online | Devolver com PIN | **Simulado** — testes automáticos (27): pedido pago cancelado → "a devolver" + alerta, sem estorno sozinho. Estorno real **precisa do Felipe** | — |
| 8. Super Admin | gasto por loja, limites, módulos | **OK** — contadores de hoje: IA Menuzia 107 respostas (US$ 0,033), Maps 6 geocodificações + 6 mapas; limites 150/dia, 3 dias, 1 push/dia; módulos por loja corretos | — |

Pedidos de teste: #307 (entrega) e o do balcão/mesa ficaram **entregues** (era o fim do fluxo); Pix e os que não
terminaram → **Não entregue**. Usuários de teste: apagados; os que lançaram pedido (Caixa e Garçom) ficam no histórico do
pedido e foram **desativados e bloqueados** (não dá para apagar quem aparece num pedido). Motoboy de teste desativado.

## Observação (sem mudança — funcionalidade, não defeito)
- "Marcar servido" na mesa só existe na tela do PDV/Caixa; o perfil Garçom (só Mesas) não tem essa ação. Funciona porque
  quem fecha a conta (Caixa) marca servido. Se o Felipe quiser o garçom marcando "servido" no salão, é funcionalidade nova.

## Precisa do Felipe
1. **Cartão online** (passo a passo em `2026-10-12-tarde.md`): pagar R$ 15 com cartão de outra pessoa; se aprovar, Devolver
   com PIN em Integrações › Mercado Pago.
2. **Pix online pago**: pedido de teste com Pix online, pagar pelo app do banco (R$ ~11), ver o pedido entrar sozinho no
   Kanban e devolver com PIN.
3. **Push no celular**: inscrever o celular na vitrine da Menuzia (depois de um pedido) e conferir os avisos "aceito" e
   "saiu para entrega" chegando.
4. **#306** (seu teste pela IA) está "preparando": feche como "Não entregue" quando terminar.
