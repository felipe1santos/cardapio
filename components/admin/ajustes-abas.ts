import type { ItemSubmenu } from '@/components/admin/submenu-vertical'

/**
 * Seções de Ajustes (submenu). Reorganização 10/10/2026 (ordem do dono) — SÓ com "Novidades em teste" (0178);
 * sem a chave, a lista é exatamente a de antes (abasAntigas):
 *  - Impressão saiu do menu principal e virou item daqui (página própria /admin/ajustes/impressao, mesma
 *    permissão de antes: dono e gerente).
 *  - Agente de IA saiu do menu principal e fica logo abaixo do Robô de atendimento (cadeado sem o módulo).
 *  - "Modelos de mensagem" e "Notificações do app" foram para Campanhas (são das campanhas, para clientes).
 */
export type AbaAjustes = 'loja' | 'entrega' | 'mesas' | 'qrcode' | 'conta' | 'impressao' | 'mensagens' | 'robo' | 'agente' | 'modelos' | 'notificacoes'

export const HREF_IMPRESSAO = '/admin/ajustes/impressao'

/** Abas que mudaram de lugar → para onde vão (com e sem as novidades). */
export function abasMovidas(novidades: boolean): Record<string, string> {
  return novidades
    ? { impressao: HREF_IMPRESSAO, cozinha: '/admin/kds', modelos: '/admin/campanhas?aba=modelos', notificacoes: '/admin/campanhas?aba=notificacoes' }
    : { impressao: '/admin/impressao', cozinha: '/admin/kds' }
}

/** A lista de sempre (antes de 10/10). */
const ABAS_ANTIGAS: ItemSubmenu<AbaAjustes>[] = [
  { id: 'loja', label: 'Perfil da loja', icone: 'store' },
  { id: 'entrega', label: 'Entrega', icone: 'delivery_dining' },
  { id: 'mesas', label: 'Mesas', icone: 'table_restaurant' },
  { id: 'qrcode', label: 'QR Code', icone: 'qr_code_2' },
  { id: 'conta', label: 'Conta', icone: 'manage_accounts' },
  { id: 'mensagens', label: 'Mensagens automáticas', icone: 'chat', grupo: 'WhatsApp e notificações' },
  { id: 'modelos', label: 'Modelos de mensagem', icone: 'description' },
  { id: 'notificacoes', label: 'Notificações do app', icone: 'notifications' },
  { id: 'robo', label: 'Robô de atendimento', icone: 'smart_toy' },
]

export function abasDoAjustes(o: { podeAjustes: boolean; podeImpressao: boolean; agenteLiberado: boolean; novidades: boolean }): ItemSubmenu<AbaAjustes>[] {
  if (!o.novidades) return o.podeAjustes ? ABAS_ANTIGAS : []
  const todas: ItemSubmenu<AbaAjustes>[] = [
    { id: 'loja', label: 'Perfil da loja', icone: 'store' },
    { id: 'entrega', label: 'Entrega', icone: 'delivery_dining' },
    { id: 'mesas', label: 'Mesas', icone: 'table_restaurant' },
    { id: 'qrcode', label: 'QR Code', icone: 'qr_code_2' },
    { id: 'conta', label: 'Conta', icone: 'manage_accounts' },
    { id: 'impressao', label: 'Impressão', icone: 'print' },
    { id: 'mensagens', label: 'Mensagens automáticas', icone: 'chat', grupo: 'WhatsApp e notificações' },
    { id: 'robo', label: 'Robô de atendimento', icone: 'smart_toy' },
    { id: 'agente', label: 'Agente de IA', icone: 'auto_awesome', bloqueado: !o.agenteLiberado },
  ]
  // Sem os Ajustes (gerente): só a Impressão, que ele já configurava antes.
  if (!o.podeAjustes) return o.podeImpressao ? todas.filter((t) => t.id === 'impressao') : []
  return o.podeImpressao ? todas : todas.filter((t) => t.id !== 'impressao')
}
