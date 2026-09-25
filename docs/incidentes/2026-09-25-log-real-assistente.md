# 2026-09-25 — Teste escreveu 8 linhas no log real do Assistente 0.1.23

**O que aconteceu.** Durante o e2e `scripts/seguranca/e2e-impressao-v2.mjs` (servidor local,
loja de demonstração `cantina-demo`), os agentes virtuais rodaram o `printer-agent/src/main.js`
sem pasta temporária própria. A função `logArquivo` do Assistente grava em
`os.tmpdir()\menuzia-print.log` — o mesmo arquivo do Assistente 0.1.23 instalado neste
computador (`%TEMP%\menuzia-print.log`).

**O que foi escrito.** 8 linhas de diagnóstico, **linhas 1827 a 1834** do arquivo, das 02:04:03
às 02:04:43 (horário local), todas do tipo:

```
[02:04:03] [agente] CICLO: impressora='(nenhuma cadastrada)' tamanhoFonte='undefined' largura=48 (80mm) -> cols=26; imprimirLogo=true
[02:04:03] [agente] LOGO: nao baixada (imprimirLogo=true, logoUrl=AUSENTE)
```

SHA-256 das 8 linhas (1827–1834): `47c17fcf4d78d86567c4e8c3ae216faf586e81c7038df9fae6788a37d8e39a30`.

**Impacto.** Só texto de diagnóstico anexado ao fim do log. Configuração, token, fila,
impressora e instalação do 0.1.23 não foram tocados (conferido por hash). O 0.1.23 só
escreve nesse arquivo; não lê dele. As linhas **não foram apagadas**: ficam como registro.

**Correção permanente.**
- `scripts/impressao/isolamento-teste.cjs`: caminhos reais calculados da pasta do usuário
  (não de variável de ambiente) e `exigirIsolamento`, que aborta o teste ANTES de começar
  se a pasta temporária, os dados ou a saída apontarem para `%TEMP%` real, para
  `%APPDATA%\menuzia-printer-agent` / `menuzia-assistente-beta` ou para a instalação real.
- Usado por: `agente-virtual.cjs` (antes de criar qualquer pasta, e confere `os.tmpdir()`
  depois de trocar), `renderizar-virtual.mjs`, `golden-assistente-0123.mjs`,
  `e2e-impressao-v2.mjs` e `e2e-assistente-beta.mjs`.
- Os testes fotografam log, configuração e instalação reais (hash, tamanho e data) no
  início e conferem no fim.
