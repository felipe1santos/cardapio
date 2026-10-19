# Auditoria do atendimento (robô + Agente de IA) — 19/10/2026

Base: conversas reais da Ponto 400 de 16 a 18/10 (46 conversas, 736 mensagens). O relatório completo tem dados de cliente e
fica FORA do git: `C:\Users\felipe\menuzia-relatorios\ponto400-atendimento-2026-10-19\` (relatorio.md, conversas.md,
testes-menuzia.md). Extração: `.medidas/extrair-conversas-ponto400.mjs` (só leitura).

## Números
15 pedidos fechados sozinhos (todos robô → link → vitrine), 12 com ajuda do dono, 11 desistiram/sem resposta, 8 não eram
pedido. A IA por texto não fechou nenhum pedido sozinha; chegou ao resumo 1 vez e a loja interrompeu.

## O que mudou (todas as lojas)
- **Tempo de entrega/retirada** no Perfil (0203: `restaurantes.tempo_entrega`, `tempo_retirada`). Robô e IA leem
  Perfil → tempo do robô (legado, Integrações) → média real dos entregues nos últimos 30 dias (`lib/tempo-entrega.ts`,
  a mesma conta do Dashboard, amostra ≥ 5) → atendente. Nunca "não sei".
- **Falhas humanizadas** (`lib/agente-ia/falhas.ts`): retirada desligada → "No momento estamos só com entrega 🛵 Posso
  mandar pro seu endereço?" (e o pedido vira entrega); loja fechada → pedido fica anotado + quando abre; fora da área ou
  erro → atendente (conversa amarela) com o resumo do que o cliente queria. `FalhaPedido` com código em `pedido.ts`.
- **Pedido em andamento** (`rascunho.ts`): "tudo bem…" não marca todos os adicionais; "quero não"/"não quero" = não;
  pagamento/entrega/troco ditos na pergunta dos adicionais são anotados e a pergunta se repete; tipo que a loja não aceita
  é trocado com aviso (`ajustarTipoAceito`).
- **Loja fechada na mão** (`textoFechadaManual`): "fechados hoje (fora do horário normal), abre amanhã às X" no robô e na
  IA (bloco AGORA + regra). Antes: "abre hoje às 18:00" às 18:50.
- **Mensagem já respondida** (`jaRespondida`): duas mensagens no mesmo segundo não geram "Não recebi nenhuma mensagem".
- **Prompt da IA**: mensagens "[atendente da loja]" são de uma pessoa (não pedir desculpas por elas); nunca erro técnico;
  tempo só pelos dados; loja fechada dita na primeira mensagem.
- **Robô**: frase não é bairro (`bairroPlausivel`; "entrega ainda" = está aberto?); "acerta depois"/fiado, "precisando de
  gente", "vamos trocar" → atendente; pergunta sobre item ("esse combo não tem refrigerante?") → IA (`perguntaSobreCardapio`).
- **Tempo sem dado nenhum** → atendente direto (antes caía em "não entendi").

## Testes
`casos-ponto400-c`, `rascunho-ponto400`, `falhas`, `tempo-entrega` + suíte do robô/IA (507). Antes/depois na Menuzia
pelo webhook local: `.medidas/testes-atendimento-menuzia.mjs` (8/8; só caminhos sem a chave da IA — o `.env.local` não
tem `ANTHROPIC_API_KEY`; os caminhos da IA foram cobertos por teste de unidade).

## Decisões pendentes do dono (Ponto 400 — NÃO alterado)
- Ligar "Aceitar pedidos para retirada" (a loja aceita na prática; está desligado).
- Preencher "Tempo de entrega" (a loja responde 30–45 min) e "Tempo de retirada" no Perfil.
- Áudio: 26 áudios em 3 dias atendidos à mão — transcrição é uma rodada à parte (custo).
- WhatsApp da Ponto 400 caiu 18/10 23:16 (avisos automáticos falharam) — falta monitor.
