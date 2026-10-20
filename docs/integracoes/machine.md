# Machine (Gaudium) — entregadores da cidade pela logística Open Delivery

Pesquisa e decisão de 20/10/2026 (modo autônomo). A Machine é o aplicativo de centrais de motoboy/mototáxi do interior
(produto da Gaudium). No Menuzia ela entra como **provedor de entrega**, igual à Foody: botão no Kanban em "Pronto p/
Despacho" → cotação → confirmar → corrida; os eventos (aceita, a caminho, coletou, entregou, cancelada) movem o pedido
e o custo entra no Financeiro. Código: `lib/entregas/provedores.ts` (`'machine'`), cliente Open Delivery compartilhado
`lib/custo/foody-logistica.ts` (guarda `machine`, `LIMITE_MACHINE_DIA`), webhook `app/api/entregas/machine/webhook/[token]`.

## O que a pesquisa mostrou

- A Machine é a **primeira "Operadora Logística" verificada pelo Open Delivery** (Abrasel): aceita pedidos de entrega
  pelo padrão (módulo Logistics: disponibilidade/preço, criar entrega, status, cancelar) — o mesmo que usamos na Foody.
  Fonte: [matéria patrocinada pela Machine](https://55content.com.br/patrocinados/open-delivery-machine-e-a-primeira-tecnologia-a-conquistar-selo-de-operador-logistico/).
- **Não há documentação pública** da ponta Open Delivery da Machine (URL base, como gerar client id/secret). O que
  existe publicado é a **API nativa** ([Documentação Machine — Entregas, Postman](https://documenter.getpostman.com/view/30402848/2s9YkgDkKa)):
  cabeçalho `api-key` + login, `GET /api/integracao/estimarSolicitacao`, `POST /api/integracao/abrirSolicitacao`,
  `GET /api/integracao/solicitacaoStatus`, `POST /api/integracao/cancelar`, `POST /api/integracao/cadastrarWebhook`
  (tipo `status`/`posicao`), limite de 50–100 req/min. A própria documentação diz: **"Caso você seja um usuário de
  central, entre em contato com o nosso suporte. Caso contrário, entre em contato com a central responsável pela
  integração"** — ou seja, a credencial é da **central Machine da cidade**, não é autoatendimento do restaurante.
- Nos guias de outros cardápios ([Cardápio Web](https://ajuda.cardapioweb.com/automacao/integracoes/machine),
  [Machine › Open Delivery](https://suporte.machine.global/hc/pt-br/articles/31608831558427-Como-Ativar-a-Integra%C3%A7%C3%A3o-do-Card%C3%A1pio-Web-com-a-API-Open-Delivery),
  [Delivery Direto](https://suporte.machine.global/hc/pt-br/articles/21210113284507-Integra%C3%A7%C3%A3o-com-a-Delivery-Direto)) o fluxo
  termina sempre em "fale com a equipe da Machine" e usa credenciais do padrão Open Delivery; o webhook da Machine para
  eventos de pedido é `https://api.taximachine.com.br/integra/delivery/opendelivery/v1/newEvent`.

## Decisão

- Construído pelo padrão **Open Delivery Logistics** (reaproveita 100 % o cliente da Foody; só muda guarda e nome).
- Fica **"Em breve"** (`PROVEDOR_DISPONIVEL.machine = false`) porque depende de credencial/parceria: nenhuma loja tem
  URL base + client id/secret da Machine ainda. Quando a primeira chegar: aplicar a 0212 (já aplicada em 20/10), ligar
  o flag, salvar as credenciais no card, "Testar conexão", cotar um pedido de teste na Menuzia.
- Plano B, se a central só tiver a API nativa (`api-key`): escrever `lib/custo/machine.ts` com os 4 endpoints acima
  (mesmo contrato `cotar/criar/cancelar` do provedor) — ~1 dia de trabalho; a regra nº 1 já bloqueia
  `api.taximachine.com.br` fora de `lib/custo/`.

## O que o dono precisa fazer

1. Perguntar à central Machine da cidade (a empresa de motoboys) se ela aceita integração **Open Delivery — Logística**
   com o Menuzia e pedir: **URL base**, **Client ID** e **Client Secret**. Se a central não souber, ela pede à Machine
   (suporte da Gaudium) citando o selo de Operador Logístico Open Delivery.
2. Mandar essas três informações (ou dizer que só existe a API nativa com `api-key`) — a partir daí a Menuzia libera o
   card em Integrações › Entregas › Machine e faz o teste com um pedido real na Menuzia.
3. Passar à central a URL do webhook que aparece no card (eventos de status).
