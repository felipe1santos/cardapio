'use client'

/**
 * Ajustes › Robô de atendimento — UM robô só (11/10/2026, ordem do dono): o robô de atendimento (0177), com interruptor
 * Ligado/Desligado e as configurações dele, para todas as lojas (menu antigo e novo). O robô simples (v1) deixou de
 * existir como opção (0182); o Agente de IA (pago) tem a tela própria.
 */
import { PainelAutoatendimento } from '@/components/admin/robo/painel-autoatendimento'

export function RoboAtendimentoAjustes() {
  return (
    <div data-testid="robo-ajustes">
      <PainelAutoatendimento />
    </div>
  )
}
