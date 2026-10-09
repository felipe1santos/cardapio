'use client'

import { TopBar } from '@/components/layout/topbar'
import { GuiaFinanceiro } from '@/components/financeiro/guia/guia'

/**
 * Guia do Financeiro: texto de ajuda para o dono e a equipe. Não lê nem grava dados, então qualquer pessoa
 * logada no painel pode ler (o layout do /admin já cuida do login). As telas do Financeiro apontam para
 * /admin/financeiro/guia#<id> — ids em components/financeiro/guia/conteudo.tsx.
 */
export default function GuiaFinanceiroPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar title="Guia do Financeiro" breadcrumb="Financeiro › Como usar" />
      <GuiaFinanceiro />
    </div>
  )
}
