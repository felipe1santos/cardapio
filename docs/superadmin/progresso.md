# Superadmin — painel da plataforma: progresso (2026-10-04)

Regras permanentes seguidas: botões do sistema à direita, cores vivas, popups por cima (Flutuante, z 9999) e
"Despacho de rotas" sem nenhuma mudança.

- [x] Mapeado o código: `/superadmin` (Server Component + Server Actions), lista saindo de `usuarios` linha a linha,
  cadastro automático em `config_plataforma` (0040), `/cadastro` + `verificar-email`.
- [x] Investigadas em produção (só leitura) as linhas "—" (relatório, seção 3).
- [x] **Cadastro automático removido**:
  - saiu da tela e do servidor (`verificar-email` e `completarPrimeiroAcesso`);
  - a coluna `config_plataforma` fica no banco, mas não é mais lida;
  - contas existentes e convites pendentes continuam valendo.
- [x] `/cadastro` sem convite: "Cadastro disponível só por convite. Fale com o suporte." Com convite: pré-preenchido.
- [x] Pré-cadastro por modal: e-mail validado e sem duplicar; loja, responsável e telefone opcionais; validade
  opcional (sem validade ou até uma data). A validade é mantida no primeiro acesso.
- [x] Uma linha por loja (conta principal) + coluna Sublogins com modal só leitura.
- [x] Números do topo só de lojas; faturamento paginado (antes parava no limite de 1000 linhas).
- [x] Visual:
  - cartões iguais aos de Clientes e selos vivos;
  - busca e filtros;
  - tabela com cabeçalho e loja fixos, ordenação e paginação de 20;
  - menu ⋮ com confirmações.
- [x] Celular: cartões, lupa, chips roláveis, botão fixo, modais em tela cheia com "← Voltar".
- [x] Auditoria: migration **0139** `auditoria_plataforma` + registro na auditoria da loja nas ações por loja.
- [x] Proteções novas no servidor:
  - "Excluir dados", "Bloquear" e "Validade" só agem na conta principal. Antes, "Excluir dados" numa linha de
    funcionário apagava a loja inteira.
  - "Excluir dados" exige digitar o nome da loja.
- [x] Testes: unitários (`plataforma.test.ts`, 5) + `e2e-superadmin.mjs` 76/76 + vitest 1958.
- [x] Publicação: 0139 em produção (backup), main dbd1e12, build 23:58. Conferência da tela pendente (sem sessão de superadmin no Chrome).
