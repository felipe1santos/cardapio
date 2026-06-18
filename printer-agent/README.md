# Assistente de Impressão Menuzia

Programa que roda no computador da loja (Windows) e liga o painel Menuzia (na nuvem) à
impressora física instalada nesse computador. Sem ele, o navegador não tem acesso a
impressoras — é por isso que todo SaaS de delivery (Brendi, Anota.ai, etc.) também exige
um programa local desse tipo.

## Como funciona

1. O lojista cadastra uma impressora e gera um **token de pareamento** em
   `Ajustes > Impressão` no painel Menuzia.
2. Abre este programa, cola a URL do painel e o token, escolhe (na lista de impressoras
   já instaladas no Windows) qual delas usar, e salva.
3. O programa consulta periodicamente (a cada poucos segundos) o endpoint
   `GET /api/agente/pedidos?token=...` perguntando se há pedidos novos não impressos.
4. Se "Impressão automática" estiver ativada nas configurações da loja, ele monta o
   recibo em texto simples e manda pra impressora escolhida via spooler do Windows
   (`Out-Printer`), depois avisa o servidor (`POST /api/agente/pedidos/:id/imprimir`)
   pra não imprimir o mesmo pedido de novo.

Não usa Supabase Realtime/anon key diretamente — toda comunicação passa pelos endpoints
HTTP do próprio Menuzia (`app/api/agente/*`), autenticados pelo token de pareamento, que
roda com a service_role no servidor (ver `lib/queries/impressao.ts`).

## Rodar em desenvolvimento

```
cd printer-agent
npm install
npm start
```

## Gerar instalador (Windows)

```
npm run dist
```

Gera o instalador NSIS (`.exe` único, com tela de instalação) em `printer-agent/dist/`.

**Pré-requisito no Windows:** sem isso, o build quebra na etapa de empacotamento
(`Cannot create symbolic link`) porque o usuário comum não tem permissão pra criar
links simbólicos — precisa de uma destas duas opções:

- Ativar o **Modo de Desenvolvedor**: Configurações → Privacidade e segurança → Para
  desenvolvedores → ligar "Modo de desenvolvedor". (Não precisa reiniciar.)
- Ou rodar o terminal/PowerShell **como Administrador** antes de `npm run dist`.

Sem isso, o `npm run dist` ainda gera um build funcional em
`printer-agent/dist/win-unpacked/Assistente de Impressão Menuzia.exe` — só não
empacota num instalador único (dá pra zipar essa pasta inteira e rodar o `.exe`
de dentro dela direto, sem instalar nada).

## Limitações desta primeira versão (MVP)

- Impressão é texto simples (sem ESC/POS bruto) — funciona com qualquer impressora com
  driver Windows instalado, inclusive térmicas configuradas como impressora de texto.
  Pra controle fino de fonte/corte de papel, o próximo passo é falar ESC/POS direto
  (ex.: lib `node-thermal-printer`) ao invés de `Out-Printer`.
- Não tem ícone de bandeja (tray) ainda — a janela só esconde ao fechar, mas o processo
  continua rodando e imprimindo em segundo plano.
- Pareamento é só por token colado manualmente (sem QR Code).
