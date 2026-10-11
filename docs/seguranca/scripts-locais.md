# Scripts locais com TLS sem verificação e shell (auditoria 10/10/2026)

**Conclusão: nenhum roda em produção.** Ficam documentados, sem mudança.

| O quê | Onde | Por que é aceitável |
|---|---|---|
| `ssl: { rejectUnauthorized: false }` | 28 scripts em `scripts/` (+ `.medidas/`, fora do repositório) | Ferramentas que rodamos à mão do computador do desenvolvedor para aplicar migração com ensaio, conferir dados e testes. A conexão vai ao pooler do Supabase por TLS (cifrado); só a cadeia do certificado não é conferida. Nada disso é importado por `app/`, `lib/`, `components/`, `middleware.ts` nem pelo Assistente. |
| `spawn(..., { shell: process.platform === 'win32' })` | `scripts/seguranca/servidor-local.mjs` | Sobe o Next LOCAL (127.0.0.1) com argumentos fixos do próprio script (`next build` / `next start -p 3999`); nenhum texto vem de fora. No Windows o `npx` precisa de shell. |

Conferência automática: `grep -rln "rejectUnauthorized:\s*false\|shell:\s*true" app lib components middleware.ts instrumentation.ts printer-agent/src`
tem que voltar vazio (voltou vazio em 10/10/2026). O `npm run build` só roda as guardas `scripts/custo/regra-1.mjs` e
`scripts/seguranca/guarda-isolamento.mjs` (sem rede).
