'use client'

import { createContext } from 'react'

/**
 * Como a barra de topo abre a gaveta do menu.
 *
 * Existe por um motivo só: abaixo de `lg` a sidebar sai do fluxo, e quem tem o botão de
 * abrir é a `TopBar` — que é renderizada por cada tela do painel, não pelo layout. Sem
 * contexto, a função de abrir teria de atravessar as 14 telas como prop.
 *
 * `null` = fora do layout administrativo (a TopBar simplesmente não mostra o botão).
 */
export const MenuLateralContext = createContext<{ abrir: () => void } | null>(null)
