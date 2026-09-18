/**
 * `describe`, `it`, `expect` e `vi` são globais porque o vitest.config.ts liga
 * `globals: true`. Sem esta referência o `tsc --noEmit` reprova todo arquivo de teste
 * por nome não encontrado — ruído que esconderia erro de tipo de verdade.
 */
/// <reference types="vitest/globals" />
