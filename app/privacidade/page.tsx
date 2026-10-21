import type { Metadata } from 'next'
import { SUPORTE_MENUZIA } from '@/lib/suporte'

export const metadata: Metadata = { title: 'Política de Privacidade · Menuzia' }

/**
 * Política de Privacidade pública (20/10/2026). O Google exige o link para publicar o "Entrar com Google" do painel;
 * também vale para quem pede pelo cardápio. Texto curto e verdadeiro sobre o que o sistema guarda hoje.
 */
export default function PrivacidadePage() {
  const h2 = 'mt-7 mb-2 text-[16px] font-semibold text-[#1F2937]'
  return (
    <main className="min-h-screen bg-[#EDEEF1] px-4 py-10">
      <article className="mx-auto max-w-[720px] rounded-[3px] border border-[#E5E7EB] bg-white px-5 py-8 text-[14px] leading-[22px] text-[#1F2937] sm:px-8">
        <h1 className="text-[22px] font-semibold">Política de Privacidade — Menuzia</h1>
        <p className="mt-1 text-[12px] text-[#6B7280]">Atualizada em 20/10/2026</p>

        <p className="mt-5">
          A Menuzia é uma plataforma de cardápio digital e gestão de pedidos usada por restaurantes e lojas de delivery.
          Esta política explica quais dados tratamos, para quê e como você pode exercer seus direitos (Lei 13.709/2018 — LGPD).
        </p>

        <h2 className={h2}>Quem usa o painel (lojas e equipes)</h2>
        <p>
          Guardamos nome, e-mail ou nome de usuário, cargo e registros de acesso (data, aparelho e endereço IP) para permitir o
          login, controlar permissões e manter a segurança da conta. Ao entrar com o Google, recebemos apenas seu nome, e-mail
          e o identificador da conta Google — usados somente para confirmar que você já tem uma conta Menuzia com o mesmo e-mail.
          Não acessamos Gmail, Drive, contatos nem qualquer outro dado da sua conta Google.
        </p>

        <h2 className={h2}>Quem faz pedidos (clientes das lojas)</h2>
        <p>
          Para entregar o pedido, a loja recebe nome, telefone, endereço de entrega, itens, forma de pagamento e observações.
          Esses dados pertencem à loja onde o pedido foi feito, que é a responsável por eles; a Menuzia os processa em nome dela.
        </p>

        <h2 className={h2}>Com quem compartilhamos</h2>
        <p>
          Só com os serviços necessários para o sistema funcionar (hospedagem e banco de dados, envio de mensagens de WhatsApp,
          pagamentos online e entregas, quando a loja usa esses recursos). Não vendemos dados pessoais nem os usamos para
          publicidade de terceiros.
        </p>

        <h2 className={h2}>Por quanto tempo</h2>
        <p>
          Enquanto a conta da loja estiver ativa ou pelo prazo exigido por lei (por exemplo, registros fiscais e de acesso).
          Depois disso, os dados são excluídos ou anonimizados.
        </p>

        <h2 className={h2}>Seus direitos</h2>
        <p>
          Você pode pedir acesso, correção, exclusão ou portabilidade dos seus dados, ou retirar o consentimento do login com o
          Google a qualquer momento (em myaccount.google.com › Segurança › Apps de terceiros). Clientes de uma loja podem falar
          diretamente com ela ou com a Menuzia.
        </p>

        <h2 className={h2}>Contato</h2>
        <p>
          Suporte Menuzia pelo WhatsApp{' '}
          <a className="font-semibold text-[#0688D4] hover:underline" href={`https://wa.me/${SUPORTE_MENUZIA.whatsapp}`}>{SUPORTE_MENUZIA.exibicao}</a>.
        </p>
      </article>
    </main>
  )
}
