# Skills do projeto — de onde vieram (instaladas em 10/10/2026)

Copiadas de clones lidos antes (SKILL.md e todos os scripts), sem rodar o `npx skills add`.

| Pasta | Origem (commit) | Observação |
|---|---|---|
| semgrep, sarif-parsing | trailofbits/skills `plugins/static-analysis/skills/*` (442fc9d) | `--metrics=off` forçado pelo `run-scans.sh`; baixa regras do registro do Semgrep |
| vercel-react-best-practices, composition-patterns, web-design-guidelines | vercel-labs/agent-skills `skills/*` (063bee9) | web-design-guidelines lê `guidelines.md` LOCAL (cópia revisada), não baixa da internet |
| test-driven-development, systematic-debugging | obra/superpowers `skills/*` (bb92a77) | iguais às do plugin superpowers |
| handoff, grill-me, grilling | mattpocock/skills `skills/productivity/*` (49dd158) | grill-me chama a grilling |
| karpathy-guidelines | multica-ai/andrej-karpathy-skills (antigo forrestchang/…, autor Jiayuan "Forrest" Zhang) (2c60614) | só texto |

Não instaladas: trailofbits `differential-review` (grava relatório fora do projeto e faz `git checkout`),
`audit-context-building` (depende do plugin inteiro, até 40 subagentes), `supply-chain-risk-auditor` (envia nomes de
dependências para osv.dev/npm/GitHub/scorecard), CodeQL (pesado no Windows).
