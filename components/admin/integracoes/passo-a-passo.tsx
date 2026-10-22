'use client'

/**
 * Passo a passo de cada parceiro de entrega (21/10/2026): só o caminho para copiar os campos obrigatórios. Prints
 * reais (valores borrados) em public/ajuda quando temos acesso ao painel do parceiro.
 */
type Provedor = 'uber' | 'lalamove' | 'foody' | 'machine' | 'ifood'

const PASSOS: Record<Provedor, { titulo: string; passos: string[]; prints?: { src: string; legenda: string }[] }> = {
  uber: {
    titulo: 'Onde copiar os 3 campos da Uber Direct',
    passos: [
      'Entre em direct.uber.com com a conta Uber da loja (se não tiver, crie: dados da empresa e aceite dos termos).',
      'Gerenciamento ➡ Pagamento ➡ Configurar: sem o pagamento configurado a Uber não libera entregas de verdade.',
      'Menu Desenvolvedor ➡ aba "Chaves de API": copie o "ID do usuário", o "ID de cliente do desenvolvedor" e o "Client Secret" (botão Copiar de cada um) e cole nos campos de mesmo nome aqui embaixo. Toque em Conectar.',
    ],
    prints: [
      { src: '/ajuda/uber-pagamento.webp', legenda: 'Página inicial: "Configurar o pagamento" (obrigatório para produção).' },
      { src: '/ajuda/uber-chaves.webp', legenda: 'Desenvolvedor › Chaves de API: use o botão "Copiar" de cada campo.' },
    ],
  },
  lalamove: {
    titulo: 'Onde copiar a API key e o Secret da Lalamove',
    passos: [
      'Crie a conta em partnerportal.lalamove.com com o e-mail da loja (país Brasil).',
      'Menu Developers ➡ seletor no canto superior direito em "Production" ➡ copie a API key (pk_prod_…) e o Secret (sk_prod_…).',
      'Coloque crédito na carteira (Wallet) da Lalamove — sem saldo ela recusa a corrida. Cole as chaves aqui e toque em Conectar.',
    ],
  },
  foody: {
    titulo: 'Onde copiar os campos da Foody',
    passos: [
      'No painel da Foody: Menu ➡ Minha conta ➡ APIs e Hooks ➡ "Criar credencial" (tipo "Open Delivery").',
      'Na lista de credenciais, menu "Ações" (três pontos): copie baseUrl, clientId e clientSecret. Cole aqui e toque em Conectar.',
      'Opcional (Modo avançado): criar o gatilho com a URL do webhook deixa o status mais rápido; sem ele o Menuzia consulta a Foody a cada minuto.',
    ],
  },
  machine: {
    titulo: 'Como conseguir os campos da Machine',
    passos: [
      'Peça à central Machine da sua cidade a integração "Open Delivery — Logística" para o Menuzia.',
      'Eles devolvem URL base, Client ID e Client Secret. Cole aqui e toque em Conectar.',
    ],
  },
  ifood: {
    titulo: 'Como ligar o entregador do iFood',
    passos: [
      'Conecte a loja ao iFood em Integrações › iFood. O entregador usa a mesma conexão.',
      'No Portal do Parceiro do iFood, o serviço "Sob Demanda / Entrega Fácil" precisa estar habilitado. Depois toque em Conectar.',
    ],
  },
}

export function PassoAPasso({ provedor }: { provedor: Provedor }) {
  const p = PASSOS[provedor]
  return (
    <details className="rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[13px] text-[#374151]" data-testid={`passo-a-passo-${provedor}`}>
      <summary className="cursor-pointer font-semibold">{p.titulo}</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px]">{p.passos.map((t, i) => <li key={i}>{t}</li>)}</ol>
      {p.prints && (
        <div className="mt-3 space-y-3">
          {p.prints.map((f) => (
            <figure key={f.src} className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.src} alt={f.legenda} loading="lazy" className="w-full rounded-[6px] border border-[#E5E7EB] bg-white" />
              <figcaption className="text-[11.5px] text-[#6B7280]">{f.legenda}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </details>
  )
}
