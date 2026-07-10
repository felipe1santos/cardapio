# Bairro obrigatório + lista fechada de bairros no checkout da vitrine

Data: 2026-07-10 · Status: aprovado

## Objetivo

Garantir que a loja só receba pedidos de entrega em áreas que ela atende. Bairro passa a
ser campo obrigatório no checkout; quando a loja cadastra bairros, eles viram **lista
fechada** (não há mais fallback silencioso para a taxa padrão); quando não atende, o
cliente vê contato da loja (telefone + WhatsApp) em vez de conseguir fechar o pedido.

## Regra de entregabilidade (server-side, fonte da verdade)

Aplicada tanto em `POST /api/loja/[slug]/frete` quanto em `calcularTaxaEntrega`
(`lib/queries/pedidos.ts`), que passam a compartilhar a mesma semântica:

| Configuração da loja | Regra |
|---|---|
| Só bairros cadastrados | Bairro obrigatório, match exato case-insensitive contra `taxas_entrega_bairro`. Sem match → **não entregável**. Taxa padrão não entra. |
| Bairros + raio | Tenta bairro primeiro (taxa do bairro). Sem match → geocode do endereço (CEP/rua via Google) e compara com faixas de `taxas_entrega_raio`. Dentro de faixa → taxa da faixa. Fora de tudo (ou geocode falhou) → **não entregável**. Taxa padrão não entra. |
| Só raio | Como hoje: dentro da faixa → taxa da faixa; fora → não entregável. Geocode falhou → não entregável (loja optou por restringir área). |
| Nada cadastrado | Como hoje: taxa padrão, aceita qualquer endereço. |

`criarPedido` **rejeita** (erro) pedido de entrega não entregável — hoje ele nunca
bloqueia e caía na taxa padrão. Pedidos de retirada não são afetados.

Entrega grátis (`frete_gratis_acima`) continua zerando a taxa **depois** da regra acima —
não torna entregável o que não é.

## API / payload

- `POST /api/loja/[slug]/frete` continua retornando `{entregavel, taxa, fonte,
  distanciaKm, motivo}`; `fonte: 'padrao'` só ocorre no cenário "nada cadastrado".
- O payload inicial da vitrine (onde hoje chega a lista de bairros de
  `taxas_entrega_bairro`) passa a incluir `temRaio: boolean` (existe registro em
  `taxas_entrega_raio`) para o client decidir o modo do campo bairro.

## UI do checkout (step 2, `app/loja/[slug]/page.tsx`)

- **Bairro obrigatório** quando tipo = entrega, junto de nome/rua/número.
- **Modo lista fechada** (tem bairros e `!temRaio`): campo bairro vira autocomplete
  estrito — ao digitar, dropdown filtra os bairros cadastrados (substring
  case-insensitive, ex.: "Ja" → "Jardim Colorado", "Jardim Marilandia"); só valor da
  lista é aceito (clique ou texto que case exato, aí normalizado para a grafia
  cadastrada). Autofill do ViaCEP tenta casar o bairro retornado com a lista
  (case-insensitive); sem match, campo fica vazio para o cliente escolher.
- **Modo bairros+raio ou só raio:** campo livre com sugestões (datalist atual);
  validação pelo endpoint de frete como hoje.
- **Fora de área:** card de aviso no lugar do resumo de frete — "A loja não entrega
  neste endereço. Entre em contato com a loja:" + ícone de telefone com o número
  (`restaurantes.telefone`) + botão atalho para WhatsApp (`wa.me/<dígitos>`). Botão
  de avançar bloqueado (já é hoje quando `!entregavel`). Se a loja não tem telefone
  cadastrado, mostra só a mensagem.

## Impressão

Nenhuma mudança no printer-agent: taxa de entrega e bairro já saem no recibo
(`printer-agent/src/recibo.js:78` e `:90`). Com o server resolvendo a taxa do bairro
exato, o valor impresso fica correto por consequência. Verificar num pedido de teste.

## Riscos / observações

- Lojas existentes com bairros cadastrados passam a bloquear bairros fora da lista
  imediatamente após o deploy — comportamento desejado, mas vale avisar os donos.
- Geocode usa a chave `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Google Geocoding REST
  server-side), com BrasilAPI como tentativa gratuita — infra já existente em
  `lib/frete.ts`.
