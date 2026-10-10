import { redirect } from 'next/navigation'

/** O Agente de IA foi para Ajustes › WhatsApp e notificações (10/10/2026). O cadeado do módulo continua (middleware + submenu). */
export default function AgenteIaAntigo() {
  redirect('/admin/ajustes?aba=agente')
}
