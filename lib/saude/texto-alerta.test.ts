import { describe, expect, it } from 'vitest'
import { lerTextoAlerta } from './texto-alerta'

describe('texto do alerta em partes (tela do Super Admin)', () => {
  it('alerta do vigia: título, o que aconteceu, quanto e o que fazer', () => {
    const t = '🔴 Menuzia — processador da VPS sobrecarregado\nO processador está quase no máximo.\nQuanto: 95% há 15 min\nO que fazer: ver no Coolify se há build rodando.'
    expect(lerTextoAlerta(t)).toEqual({ titulo: 'processador da VPS sobrecarregado', oQue: 'O processador está quase no máximo.', quanto: '95% há 15 min', fazer: 'ver no Coolify se há build rodando.' })
  })
  it('alerta da guarda de custo (sem Quanto/O que fazer)', () => {
    expect(lerTextoAlerta('🟡 Menuzia — custo de API\ngeocoding — atencao: 80% do limite diário (240/300).')).toEqual({ titulo: 'custo de API', oQue: 'geocoding — atencao: 80% do limite diário (240/300).', quanto: null, fazer: null })
  })
  it('texto solto', () => {
    expect(lerTextoAlerta('algo')).toEqual({ titulo: 'algo', oQue: '', quanto: null, fazer: null })
  })
})
