# Instâncias da Evolution (2026-09-25, só leitura)

Consulta por GET (`/instance/fetchInstances`) e leitura do banco. Nada foi alterado,
reconectado ou apagado. Sem números de telefone. O estado é o do momento da consulta
(muda sozinho: Estância apareceu `close` às 21:3x e `open` depois).

| Instância | Loja vinculada | Status | Mensagens guardadas | Última atividade |
|---|---|---|---|---|
| `menuzia-824468ae-a16a-43d6-ab82-37e23fbecb38` | menuzia | open | ~112 mil | 2026-09-25 |
| `menuzia-48ecbd08-9ed0-428e-be66-cc90c53067f7` | estancia-burger | open | ~22 mil | 2026-09-25 |
| `nr13-leads` | órfã — outro sistema | close | ~9 mil | 2026-07-01 |
| `menuzia-4708e978-51e4-4cb5-93ba-c7ec7a6ca788` | órfã (loja não existe mais) | connecting | 0 | 2026-08-25 |
| `menuzia-7a4f5262-a865-4a99-b37e-31ea58eb435a` | belgas | connecting | 0 | 2026-09-09 |
| `menuzia-e0b3df6c-846c-4d43-8965-b02369ea1918` | villa-lanches | close | ~4 mil | 2026-09-25 |
| `menuzia-7124835b-713f-4020-8edc-4a851ebd5191` | órfã (loja não existe mais) | connecting | ~14 mil | 2026-07-23 |
| `menuzia-5fd77a33-cbe2-4a31-9f08-02c55ccc75c8` | órfã (loja não existe mais) | connecting | 0 | 2026-07-24 |
| `menuzia-ad1edb77-a62c-4389-ba84-eb392a190f5e` | órfã (loja não existe mais) | connecting | ~8 mil | 2026-07-04 |
| `disparos` | órfã — outro sistema | close | ~32 mil | 2026-07-15 |

- 4 instâncias `menuzia-<id>` são de lojas que não existem mais no banco; duas guardam
  histórico de conversas (~14 mil e ~8 mil mensagens).
- `nr13-leads` (com webhook para `n8n.nr1sistema.com.br`) e `disparos` não são da Menuzia.
- `connecting` há semanas = instância esperando QR que ninguém vai ler.

## Retenção na Evolution (NÃO aplicado — só como fazer)

A Menuzia não depende do histórico guardado na Evolution: o robô grava o que precisa no
nosso banco (90 dias). Para reduzir dados pessoais lá, na ordem:

1. **Parar de guardar mensagens novas** (variáveis do servidor Evolution v2, conferir os
   nomes na versão instalada antes): `DATABASE_SAVE_DATA_NEW_MESSAGE=false`,
   `DATABASE_SAVE_MESSAGE_UPDATE=false`, `DATABASE_SAVE_DATA_CONTACTS=false`,
   `DATABASE_SAVE_DATA_CHATS=false`. Reinicia o container da Evolution (reconexão
   automática das sessões; fazer fora do horário de pico).
2. **Apagar o antigo** direto no Postgres da Evolution, com backup antes:
   `delete from "Message" where "messageTimestamp" < extract(epoch from now() - interval '90 days')`
   (idem `"MessageUpdate"`), rodando por instância e em lotes.
3. **Instâncias órfãs:** `DELETE /instance/delete/<nome>` só depois de confirmar que não
   há loja a religar (apaga sessão e histórico daquela instância).

## Separação do servidor e rotação da chave global (proposta, NÃO executada)

Hoje uma chave global (`AUTHENTICATION_API_KEY`) abre todas as instâncias — da Menuzia e
dos outros sistemas — no mesmo servidor.

1. **Servidor próprio da Menuzia:** subir outra Evolution (outro container e banco, outro
   domínio, ex.: `wa.menuzia.com.br`) só para as lojas. Os outros sistemas ficam no
   servidor atual.
2. **Migração loja a loja** (fora do horário): criar a instância no servidor novo, pedir
   ao dono para escanear o QR, trocar `EVOLUTION_API_URL` só quando todas estiverem lá
   (ou guardar a URL por loja durante a transição). Cada loja reconecta uma vez.
3. **Rotação da chave:** gerar chave nova no servidor novo; configurar
   `EVOLUTION_API_KEY` no Coolify; a chave antiga deixa de existir para a Menuzia. No
   servidor antigo, trocar a `AUTHENTICATION_API_KEY` e atualizar só os sistemas dele.
4. **Chave por instância:** usar o token de cada instância (`hash`/`token`) para envio,
   em vez da chave global, onde a versão permitir.
5. **Rede:** Evolution acessível só pelo app (firewall/rede interna), sem porta pública
   de administração.
