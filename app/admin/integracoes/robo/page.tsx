import { redirect } from 'next/navigation'

/** O robô de atendimento ganhou uma tela única em Ajustes (10/10/2026). */
export default function RoboAntigo() {
  redirect('/admin/ajustes?aba=robo')
}
