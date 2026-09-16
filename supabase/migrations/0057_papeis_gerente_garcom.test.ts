import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0057_papeis_gerente_garcom.sql'), 'utf8')

const comandos = (texto: string) =>
  texto
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)

describe('0057 — papéis gerente e garçom', () => {
  it('adiciona os DOIS valores', () => {
    expect(sql).toMatch(/alter type papel_usuario add value if not exists 'gerente'/)
    expect(sql).toMatch(/alter type papel_usuario add value if not exists 'garcom'/)
  })

  it('não faz mais nada no mesmo arquivo', () => {
    // O runner roda cada migration em begin/commit, e o Postgres não deixa USAR um valor
    // de enum na mesma transação em que ele nasceu. Qualquer comando extra aqui é risco.
    const cmds = comandos(sql)
    expect(cmds.length).toBe(2)
    for (const c of cmds) expect(c).toMatch(/^alter type papel_usuario add value/)
  })

  it('nenhuma migration anterior usa os valores novos', () => {
    // Usar 'garcom' antes da 0057 quebraria a aplicação do zero.
    const anteriores = readdirSync(aqui)
      .filter((f) => f.endsWith('.sql') && f < '0057')
      .map((f) => readFileSync(join(aqui, f), 'utf8'))
      .join('\n')
    expect(anteriores).not.toMatch(/'garcom'/)
    expect(anteriores).not.toMatch(/'gerente'/)
  })

  it('não mexe em dado nenhum', () => {
    for (const c of comandos(sql)) expect(c).not.toMatch(/^(insert|update|delete|truncate)\b/i)
  })
})
