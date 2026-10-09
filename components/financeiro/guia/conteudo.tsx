import type { ReactNode } from 'react'
import { B, Bloco, Dica, Erros, IlustracaoContagem, IlustracaoNiveis, Lista, Passos, Pergunta, Termos } from './pecas'

/**
 * Texto do Guia do Financeiro, uma entrada por seção. Os ids são âncoras ESTÁVEIS: as telas do Financeiro
 * apontam para /admin/financeiro/guia#<id>. Não renomear sem trocar os links.
 *
 * Público: o dono da loja. Português simples, sem termo técnico. As regras seguem o código em
 * lib/financeiro (limites padrão: saída sem PIN R$ 100,00; conta paga pela empresa sem PIN R$ 300,00;
 * mesas/comandas abertas no fechamento R$ 100,00; caixa aberto há 14 h; motoboy com dinheiro há 3 h).
 */
export type GrupoGuia = 'Primeiros passos' | 'Telas do Financeiro' | 'No dia a dia'

export interface SecaoDoGuia {
  id: string
  titulo: string
  grupo: GrupoGuia
  resumo?: ReactNode
  corpo: ReactNode
}

export const GRUPOS: GrupoGuia[] = ['Primeiros passos', 'Telas do Financeiro', 'No dia a dia']

export const SECOES: SecaoDoGuia[] = [
  {
    id: 'comecando',
    titulo: 'Começando',
    grupo: 'Primeiros passos',
    resumo: 'O Financeiro junta num lugar só tudo o que entra e sai de dinheiro da loja: vendas, despesas, contas, compras, motoboys e o lucro.',
    corpo: (
      <>
        <Bloco titulo="O que é o Financeiro">
          <p>Cada venda feita no PDV, nas mesas, no delivery ou no cardápio online entra sozinha no livro do caixa. Você não precisa digitar as vendas de novo.</p>
          <p>Com isso, o Financeiro mostra quanto a loja vendeu, quanto gastou, quanto custou o que foi vendido e quanto sobrou de lucro — por dia, semana ou mês.</p>
        </Bloco>
        <Bloco titulo="Dois níveis">
          <p>O Financeiro funciona em dois níveis. Você começa no primeiro e, quando a loja estiver pronta, liga o segundo.</p>
          <IlustracaoNiveis />
          <p>Veja a diferença em <a href="#niveis" className="font-semibold underline">Os dois níveis</a> e como ligar o segundo em <a href="#ativacao" className="font-semibold underline">Ativar o controle de caixa</a>.</p>
        </Bloco>
        <Bloco titulo="Por onde começar">
          <Passos itens={[
            <>Crie o seu PIN (veja <a href="#pin" className="font-semibold underline">PIN e aprovações</a>).</>,
            <>Cadastre o preço de custo dos itens que mais vendem, para ver o lucro de verdade (veja <a href="#cmv" className="font-semibold underline">Precificação / CMV</a>).</>,
            <>Lance as contas fixas da loja (aluguel, luz, fornecedores) em <a href="#contas-pagar" className="font-semibold underline">Contas a pagar</a>.</>,
            <>Acompanhe o resultado no <a href="#dashboard" className="font-semibold underline">Dashboard</a> e no <a href="#dre" className="font-semibold underline">DRE</a>.</>,
          ]} />
        </Bloco>
      </>
    ),
  },
  {
    id: 'niveis',
    titulo: 'Os dois níveis',
    grupo: 'Primeiros passos',
    resumo: 'Nível 1 organiza os números sem mudar a rotina. Nível 2 controla o dinheiro da gaveta, com abertura e fechamento de caixa.',
    corpo: (
      <>
        <Bloco titulo="Nível 1 — Financeiro ligado">
          <Lista itens={[
            'Você usa o menu do Financeiro, os relatórios, as contas a pagar e a receber, as compras, a precificação e o DRE.',
            <>As vendas entram no livro do caixa por um <B>caixa automático</B>: ninguém precisa abrir nem fechar caixa.</>,
            'PDV, mesas e delivery vendem exatamente como antes. Nada muda para a equipe.',
          ]} />
        </Bloco>
        <Bloco titulo="Nível 2 — Controle de caixa ativo">
          <Lista itens={[
            'Abrir o caixa no começo do turno e fechar no fim passa a ser obrigatório.',
            <>O fechamento é feito com <B>contagem às cegas</B>: quem fecha conta o dinheiro sem ver quanto deveria ter.</>,
            'A gaveta trava: ninguém tira mais dinheiro do que existe nela.',
            'Diferenças grandes e estornos pedem o PIN de outra pessoa (gerente ou dono).',
          ]} />
        </Bloco>
        <Dica>Comece pelo nível 1. Quando a equipe estiver acostumada e as pendências antigas estiverem resolvidas, ligue o nível 2.</Dica>
      </>
    ),
  },
  {
    id: 'ativacao',
    titulo: 'Ativar o controle de caixa',
    grupo: 'Primeiros passos',
    resumo: 'Só o dono liga o nível 2, dentro do Financeiro, no botão "Ativar controle de caixa". O sistema guia você por estes passos.',
    corpo: (
      <>
        <Bloco titulo="Passo a passo">
          <Passos itens={[
            <><B>Criar o seu PIN</B> (ou ter pelo menos um gerente com PIN). Sem alguém para aprovar, as diferenças não teriam quem liberar.</>,
            <><B>Fechar as contas antigas abertas</B> — mesas e comandas esquecidas abertas.</>,
            <><B>Acertar os motoboys pendentes</B> — dinheiro de entregas que ainda está com eles.</>,
            <><B>Definir o fundo de caixa e a tolerância</B> — o troco que fica na gaveta na abertura e até quanto de diferença no fechamento aceita só uma explicação.</>,
            <><B>Cadastrar o preço de custo dos 15 itens mais vendidos</B> (opcional, recomendado) — assim o lucro aparece certo desde o primeiro dia.</>,
            <>Tocar em <B>Ativar controle de caixa a partir do próximo turno</B>.</>,
          ]} />
          <p>Os passos 1 a 4 são obrigatórios. O passo 5 pode ficar para depois.</p>
        </Bloco>
        <Bloco titulo="Desligar">
          <p>O dono pode voltar ao nível 1 em <B>Desativar controle de caixa</B>. O sistema pede confirmação antes. As vendas continuam entrando pelo caixa automático.</p>
        </Bloco>
        <Erros itens={[
          'Ativar no meio de um turno movimentado: a mudança vale a partir do próximo turno, então avise a equipe antes.',
          'Pular o acerto dos motoboys: o dinheiro antigo deles ficaria misturado com o do primeiro turno controlado.',
        ]} />
      </>
    ),
  },
  {
    id: 'pin',
    titulo: 'PIN e aprovações',
    grupo: 'Primeiros passos',
    resumo: 'O PIN é uma senha curta e pessoal, de 4 a 6 números, usada para aprovar ações sensíveis.',
    corpo: (
      <>
        <Bloco titulo="Como criar">
          <Passos itens={[
            <>Toque no seu nome, no canto de cima à direita, e escolha <B>Criar meu PIN</B>. Também dá para criar no primeiro passo da ativação, dentro do Financeiro.</>,
            'Digite de 4 a 6 números que só você saiba. Não use data de nascimento nem 1234.',
          ]} />
        </Bloco>
        <Bloco titulo="Quem aprova">
          <Lista itens={[
            <>O dono da conta aprova como gerente — na lista aparece como <B>Gerente (você)</B>.</>,
            'Um gerente que tenha PIN também aprova.',
            <><B>Quem pede nunca aprova.</B> Se o caixa pediu a sangria, outra pessoa precisa digitar o PIN.</>,
            'Quando o próprio dono faz a ação, o sistema não pede PIN.',
          ]} />
        </Bloco>
        <Bloco titulo="Aprovar de longe">
          <p>Se o gerente ou o dono não estiver na loja, toque em <B>Pedir pelo celular do gerente/dono</B>. Ele aprova no celular dele, com o PIN dele. A aprovação vale uma vez só, para aquela ação e aquele valor, por 10 minutos.</p>
        </Bloco>
        <Bloco titulo="PIN bloqueado ou esquecido">
          <Lista itens={[
            'Cinco PINs errados seguidos bloqueiam o PIN por 15 minutos, e o dono recebe um alerta.',
            <>Se um gerente esqueceu o PIN, o dono apaga o PIN dele em <B>Equipe</B> e a pessoa cria um novo.</>,
          ]} />
        </Bloco>
        <Erros itens={[
          'Passar o PIN para o caixa "para agilizar": tudo o que for aprovado fica registrado no seu nome.',
          'Ninguém com PIN na loja: as ações acima do limite ficam travadas até alguém criar o PIN.',
        ]} />
      </>
    ),
  },
  {
    id: 'dashboard',
    titulo: 'Dashboard',
    grupo: 'Telas do Financeiro',
    resumo: 'O resumo do dinheiro da loja no período escolhido. A tela se atualiza sozinha a cada 30 segundos.',
    corpo: (
      <>
        <Bloco titulo="Para que serve">
          <p>Ver de uma vez quanto entrou, quanto saiu e quanto sobrou. Cada número mostra também se subiu ou desceu em relação ao período anterior do mesmo tamanho.</p>
        </Bloco>
        <Bloco titulo="O que significa cada número">
          <Termos itens={[
            ['Faturamento', 'O que entrou no caixa pelas vendas no período.'],
            ['Vendas', 'Quantas vendas foram feitas.'],
            ['Ticket médio', 'Quanto cada venda deixou, em média (faturamento ÷ vendas).'],
            ['Despesas', 'Contas pagas e despesas tiradas da gaveta.'],
            ['Sangrias', 'Dinheiro tirado da gaveta para o cofre ou o banco. Não é gasto: o dinheiro continua da loja.'],
            ['Diferenças de caixa', 'Sobras menos faltas dos fechamentos de caixa.'],
            ['Com motoboy agora', 'Dinheiro de entregas que ainda está com os motoboys, esperando acerto.'],
            ['CMV %', <>Quanto do valor vendido foi gasto com ingredientes. Conta só as vendas de itens com custo cadastrado. Se faltar custo em parte das vendas, aparece o aviso &quot;X% das vendas do período sem custo cadastrado&quot;. Se nenhum item tiver custo: &quot;Cadastre o custo dos itens para ver o CMV&quot;.</>],
            ['Lucro bruto', 'Faturamento menos o custo do que foi vendido.'],
            ['Lucro líquido', 'Lucro bruto menos as despesas, mais ou menos as diferenças de caixa.'],
            ['Por origem e por forma', 'De onde vieram as vendas (balcão, mesas, delivery, cardápio online) e como foram pagas (dinheiro, Pix, cartão).'],
            ['Produtos', 'O item mais vendido, o que mais dá lucro e o de pior margem.'],
          ]} />
        </Bloco>
        <Bloco titulo="Como usar">
          <Passos itens={[
            'Escolha o período no botão com o calendário.',
            'Compare os números com o período anterior (setas ▲ ▼).',
            'Se o CMV estiver sem custo, cadastre o custo dos itens em Precificação / CMV.',
          ]} />
        </Bloco>
        <Erros itens={[
          'Achar que sangria é prejuízo: é só dinheiro mudando de lugar.',
          'Olhar o lucro sem ter cadastrado custo: o CMV fica incompleto e o lucro parece maior do que é.',
        ]} />
      </>
    ),
  },
  {
    id: 'caixa',
    titulo: 'Caixa / Turno',
    grupo: 'Telas do Financeiro',
    resumo: 'Abrir e fechar o caixa do turno (nível 2). A tela se atualiza sozinha a cada 15 segundos.',
    corpo: (
      <>
        <Bloco titulo="Para que serve">
          <p>Garantir que o dinheiro da gaveta bate com o que foi vendido. Cada turno tem um responsável, um fundo de abertura e uma contagem no fechamento.</p>
        </Bloco>
        <Bloco titulo="Abrir o caixa">
          <Passos itens={[
            <>Conte o dinheiro que está na gaveta (o fundo de troco).</>,
            <>Toque em <B>Abrir caixa</B> e digite o valor contado.</>,
          ]} />
        </Bloco>
        <Bloco titulo="Fechar o caixa (contagem às cegas)">
          <IlustracaoContagem />
          <Passos itens={[
            <>Toque em <B>Fechar caixa</B>.</>,
            'Conte o dinheiro da gaveta e some o total da maquininha. O sistema não mostra quanto deveria ter antes de você contar.',
            'Digite os valores. Se bater, o caixa fecha.',
            'Se houver qualquer diferença, escreva uma explicação.',
            'Se a diferença passar da tolerância da loja (definida na ativação, por exemplo R$ 5,00), outra pessoa precisa aprovar com o PIN e o dono recebe um alerta grave.',
          ]} />
        </Bloco>
        <Bloco titulo="Fechar com pendências">
          <Lista itens={[
            'Mesas ou comandas abertas passam para o próximo turno com uma explicação. Acima de R$ 100,00 em aberto, pede também o PIN de outra pessoa.',
            'Motoboy sem acerto ou entrega marcada como não paga pedem explicação e PIN de outra pessoa.',
            'Pix a conferir não trava o fechamento: vai para a lista do dono em Conferir Pix.',
            'O dono nunca precisa de PIN; a explicação vale para todos.',
          ]} />
        </Bloco>
        <Bloco titulo="Reabrir e caixa esquecido">
          <Lista itens={[
            'Só o dono reabre um caixa fechado, e precisa escrever o motivo. Não dá para reabrir se já houver outro caixa aberto.',
            'Caixa aberto há mais de 14 horas gera alerta (o dono pode mudar esse tempo em Regras e limites).',
          ]} />
        </Bloco>
        <Erros itens={[
          'Contar o dinheiro com pressa e corrigir depois: a contagem informada fica registrada como foi digitada.',
          'Esquecer a maquininha: o total do cartão também é conferido.',
        ]} />
      </>
    ),
  },
  {
    id: 'movimentacoes',
    titulo: 'Movimentações da gaveta',
    grupo: 'Telas do Financeiro',
    resumo: 'Todo dinheiro que entra ou sai da gaveta fora das vendas.',
    corpo: (
      <>
        <Bloco titulo="Os cinco tipos">
          <Termos itens={[
            ['Sangria', 'Tirar dinheiro da gaveta para o cofre ou o banco.'],
            ['Reforço', 'Colocar troco na gaveta.'],
            ['Despesa', 'Pagar algo com dinheiro da gaveta (ex.: gás, entregador de gelo).'],
            ['Retirada', 'O dono tirou dinheiro para uso próprio.'],
            ['Perda', 'Dinheiro que sumiu ou nota falsa.'],
          ]} />
        </Bloco>
        <Bloco titulo="Regras">
          <Lista itens={[
            <>Nenhuma saída pode ser maior que o dinheiro que há na gaveta. O sistema avisa: <B>&quot;Só há R$ X na gaveta.&quot;</B></>,
            'Saída acima do limite da loja (R$ 100,00, se você não mudar) pede o PIN de outra pessoa.',
            'Reforço nunca pede PIN: é dinheiro entrando.',
            'Clique duplo não lança duas vezes.',
          ]} />
        </Bloco>
        <Bloco titulo="Como usar">
          <Passos itens={[
            'Toque no botão do tipo (Sangria, Reforço, Despesa, Retirada ou Perda).',
            'Digite o valor e o motivo.',
            'Se pedir PIN, chame o gerente ou o dono, ou peça pelo celular dele.',
          ]} />
        </Bloco>
        <Erros itens={[
          'Lançar como despesa o dinheiro que foi para o cofre: isso é sangria e não diminui o lucro.',
          'Pegar dinheiro da gaveta sem lançar: vira falta no fechamento.',
        ]} />
      </>
    ),
  },
  {
    id: 'motoboys',
    titulo: 'Acerto de motoboys',
    grupo: 'Telas do Financeiro',
    resumo: 'Controla o troco que o motoboy leva e o dinheiro das entregas que ele traz de volta.',
    corpo: (
      <>
        <Bloco titulo="O que significa cada valor">
          <Termos itens={[
            ['Troco levado', <>O dinheiro que sai da gaveta com o motoboy (<B>Entregar fundo</B> ou <B>Complementar troco</B>).</>],
            ['Dinheiro das entregas', 'O que os clientes pagaram em dinheiro nas entregas dele.'],
            ['Pendente', 'O que ele ainda deve devolver à loja.'],
          ]} />
        </Bloco>
        <Bloco titulo="Como acertar">
          <Passos itens={[
            <>Toque em <B>Acertar</B> no nome do motoboy.</>,
            'Conte o dinheiro que ele trouxe e digite. É às cegas: quem conta não vê quanto deveria ser.',
            'Se faltar, a diferença fica como dívida do motoboy e o dono recebe um alerta.',
            <>Só o dono dá baixa numa pendência, em <B>Dar baixa</B>, com motivo.</>,
          ]} />
        </Bloco>
        <Bloco titulo="Entregas automáticas">
          <Lista itens={[
            <>Entrega que ninguém confirmou vira <B>Entregue (automático)</B> depois de 1h30. O dinheiro dela fica pendente com o motoboy até o acerto.</>,
            <>Pedido marcado como <B>Não entregue</B> não vira venda, e o troco dele volta no acerto.</>,
            'Motoboy com dinheiro há mais de 3 horas sem acerto gera alerta.',
          ]} />
        </Bloco>
        <Erros itens={[
          'Deixar o acerto para o dia seguinte: o fechamento do caixa vai pedir PIN por causa do motoboy sem acerto.',
          'Receber o dinheiro do motoboy sem lançar o acerto: o valor continua aparecendo com ele.',
        ]} />
      </>
    ),
  },
  {
    id: 'pix',
    titulo: 'Conferir Pix',
    grupo: 'Telas do Financeiro',
    resumo: 'Confirma que o Pix recebido na loja caiu mesmo na conta.',
    corpo: (
      <>
        <Bloco titulo="Pix no balcão ou na mesa">
          <p>Fica <B>a conferir</B> até alguém abrir o aplicativo do banco e marcar que caiu.</p>
          <Passos itens={[
            'Abra o extrato no aplicativo do banco.',
            <>Para cada Pix da lista, toque em <B>Caiu</B> se encontrou o valor.</>,
            <>Se não encontrou, escreva o motivo e toque em <B>Não caiu</B>.</>,
          ]} />
        </Bloco>
        <Bloco titulo="Pix online (pago no cardápio)">
          <p>É confirmado sozinho pelo Mercado Pago, sem ninguém conferir.</p>
          <p>Se o cliente pagar depois do prazo, o pedido continua cancelado e o valor fica <B>a devolver</B>, com alerta grave para o dono.</p>
        </Bloco>
        <Erros itens={[
          'Marcar "Caiu" pelo comprovante que o cliente mostrou: confira sempre no extrato do banco.',
        ]} />
      </>
    ),
  },
  {
    id: 'fluxo',
    titulo: 'Fluxo de caixa',
    grupo: 'Telas do Financeiro',
    resumo: 'O histórico dos turnos de caixa, um turno por linha.',
    corpo: (
      <>
        <Bloco titulo="O que significa cada coluna">
          <Termos itens={[
            ['Esperado', 'Quanto deveria haver no fechamento, pelas vendas e movimentações.'],
            ['Informado', 'Quanto foi contado e digitado por quem fechou.'],
            ['Diferença', 'Informado menos esperado. Negativo é falta; positivo é sobra.'],
          ]} />
        </Bloco>
        <Bloco titulo="Como usar">
          <Passos itens={[
            'Filtre por data, forma de pagamento, origem da venda ou situação.',
            'Toque num turno para ver tudo o que aconteceu nele.',
            'Exporte em planilha (CSV) ou PDF para o contador.',
          ]} />
        </Bloco>
        <Bloco titulo="Turno que passa da meia-noite">
          <p>Aparece no dia em que o caixa abriu, com o aviso &quot;Turno aberto em DD/MM, inclui vendas até HHhMM de DD/MM&quot;. Já o DRE e o Dashboard contam cada venda no dia em que ela aconteceu.</p>
        </Bloco>
        <Erros itens={[
          'Estranhar que o total do dia no Fluxo não bate com o Dashboard num dia de turno até a madrugada: veja a explicação acima.',
        ]} />
      </>
    ),
  },
  {
    id: 'contas-pagar',
    titulo: 'Contas a pagar',
    grupo: 'Telas do Financeiro',
    resumo: 'Aluguel, luz, fornecedores, salários: tudo o que a loja tem para pagar.',
    corpo: (
      <>
        <Bloco titulo="Como usar">
          <Passos itens={[
            'Crie a conta com descrição, valor, vencimento e categoria.',
            'Se ela se repete todo mês, marque como recorrente: ao pagar, o sistema já gera a próxima.',
            'Na hora de pagar, diga de onde saiu o dinheiro: do caixa (gaveta) ou da conta da empresa.',
          ]} />
        </Bloco>
        <Bloco titulo="Regras">
          <Lista itens={[
            'Contas vencidas aparecem em destaque.',
            <>Conta paga com dinheiro do caixa respeita a gaveta: <B>&quot;Só há R$ X na gaveta.&quot;</B> Acima do limite de saída (R$ 100,00, se você não mudar) pede PIN.</>,
            'Conta paga pela conta da empresa acima de R$ 300,00 (se você não mudar) pede PIN de outra pessoa.',
            'Pagou errado? Estorne a baixa. Estornar pede PIN de outra pessoa, menos para o dono.',
            'Conta paga não pode ser cancelada nem editada: estorne a baixa antes.',
          ]} />
        </Bloco>
        <Erros itens={[
          'Pagar com dinheiro da gaveta e marcar como "conta da empresa": o caixa vai fechar com sobra.',
        ]} />
      </>
    ),
  },
  {
    id: 'contas-receber',
    titulo: 'Contas a receber',
    grupo: 'Telas do Financeiro',
    resumo: 'Dinheiro que a loja ainda vai receber fora das vendas do sistema: fiado, eventos, aluguel de espaço.',
    corpo: (
      <>
        <Bloco titulo="Como usar">
          <Passos itens={[
            'Crie a conta com quem deve, valor e vencimento.',
            'Quando receber, dê a baixa dizendo para onde foi o dinheiro (caixa ou conta da empresa).',
            'Recebeu errado? Estorne a baixa (pede PIN, menos para o dono).',
          ]} />
        </Bloco>
        <Bloco titulo="Venda lançada à mão">
          <p>As vendas do sistema já entram sozinhas. Se você lançar à mão uma conta que cita um pedido do sistema (por exemplo &quot;#152&quot;), ela é bloqueada para a venda não contar duas vezes. Só passa com explicação e PIN de outra pessoa.</p>
          <p>Se o valor for igual ao de um pedido do mesmo dia, o sistema só avisa — confira se não é a mesma venda.</p>
        </Bloco>
        <Erros itens={[
          'Lançar aqui a venda do dia "para garantir": o faturamento fica dobrado.',
        ]} />
      </>
    ),
  },
  {
    id: 'compras',
    titulo: 'Compras',
    grupo: 'Telas do Financeiro',
    resumo: 'Notas de compra de ingredientes e embalagens.',
    corpo: (
      <>
        <Bloco titulo="Como usar">
          <Passos itens={[
            'Registre a nota com o fornecedor, os insumos, as quantidades e os valores.',
            'Pague na hora ou deixe para depois, como numa conta a pagar.',
            'Comprou errado? Cancele a compra ou estorne o pagamento.',
          ]} />
        </Bloco>
        <Bloco titulo="O que acontece depois">
          <Lista itens={[
            'O custo de cada insumo é atualizado com o preço da compra, e o custo das fichas técnicas acompanha.',
            'A compra não entra direto no lucro do mês: o ingrediente vira custo (CMV) quando o produto é vendido.',
          ]} />
        </Bloco>
        <Erros itens={[
          'Lançar a compra de insumo também como despesa: o gasto conta duas vezes.',
        ]} />
      </>
    ),
  },
  {
    id: 'cmv',
    titulo: 'Precificação / CMV',
    grupo: 'Telas do Financeiro',
    resumo: 'CMV é o custo do que foi vendido. Aqui você vê o custo, a margem e o preço sugerido de cada item.',
    corpo: (
      <>
        <Bloco titulo="De onde vem o custo">
          <Lista itens={[
            <>Da <B>ficha técnica</B> do item (os ingredientes e quanto vai de cada um), quando existir.</>,
            <>Se não houver ficha, do <B>Preço de custo</B> cadastrado no Gestor de Cardápio.</>,
            'A tela mostra a origem de cada custo: Ficha ou Cardápio.',
          ]} />
        </Bloco>
        <Bloco titulo="O que significa cada número">
          <Termos itens={[
            ['Custo', 'Quanto custa fazer uma unidade do item.'],
            ['Margem', 'Quanto do preço sobra depois de pagar o custo, em %.'],
            ['Preço sugerido', 'O preço que dá a margem desejada. Você decide se aplica — nunca muda sozinho.'],
          ]} />
        </Bloco>
        <Bloco titulo="Importante">
          <p>O custo é guardado no momento de cada venda. Mudar o custo depois não muda as vendas antigas — só as próximas.</p>
        </Bloco>
        <Erros itens={[
          'Deixar itens sem custo: o CMV e o lucro ficam incompletos.',
          'Esperar que mudar o custo hoje corrija o lucro do mês passado.',
        ]} />
      </>
    ),
  },
  {
    id: 'dre',
    titulo: 'DRE (resultado do período)',
    grupo: 'Telas do Financeiro',
    resumo: 'A conta do lucro, linha por linha, como o contador faz.',
    corpo: (
      <>
        <Bloco titulo="Como ler">
          <Termos itens={[
            ['(+) Faturamento', 'O que entrou pelas vendas.'],
            ['(−) CMV', 'O custo do que foi vendido.'],
            ['(=) Lucro bruto', 'Faturamento menos CMV.'],
            ['(−) Despesas', 'Contas pagas e despesas da gaveta, por categoria.'],
            ['(±) Diferenças de caixa', 'Sobras menos faltas dos fechamentos.'],
            ['(=) Lucro líquido', 'O que realmente sobrou.'],
          ]} />
        </Bloco>
        <Bloco titulo="Detalhes">
          <Lista itens={[
            'Taxas e descontos — do pedido e da conta — aparecem nas linhas Taxas e Descontos.',
            'Compras de insumo ficam fora do resultado: entram no CMV quando o produto é vendido.',
          ]} />
        </Bloco>
        <Erros itens={[
          'Achar que o lucro caiu no mês de uma compra grande: a compra só pesa quando o estoque é vendido.',
        ]} />
      </>
    ),
  },
  {
    id: 'alertas',
    titulo: 'Alertas',
    grupo: 'Telas do Financeiro',
    resumo: 'O que o sistema vigia por você. Ficam em Auditoria e Alertas; os graves também vão para o WhatsApp do dono.',
    corpo: (
      <>
        <Bloco titulo="O que gera alerta">
          <Lista itens={[
            'Fechamento de caixa com diferença acima da tolerância (grave).',
            'Pix online pago depois do prazo, a devolver (grave).',
            'Caixa aberto há muito tempo ou loja aberta sem caixa aberto.',
            'Motoboy com dinheiro há muito tempo sem acerto, ou com falta no acerto.',
            'PIN bloqueado por erros seguidos.',
            'Desconto alto, muitas ações sensíveis da mesma pessoa no turno, venda lançada à mão parecida com pedido do sistema, estorno de conta.',
          ]} />
        </Bloco>
        <Bloco titulo="Como usar">
          <Passos itens={[
            'Leia o alerta: ele diz quem fez, quanto e quando.',
            <>Depois de resolver, toque em <B>Marcar lido</B>.</>,
          ]} />
        </Bloco>
        <Dica>Gravidade: <B>Grave</B> (vermelho) pede atenção hoje; <B>Atenção</B> (laranja) vale olhar; <B>Info</B> (azul) é só aviso.</Dica>
      </>
    ),
  },
  {
    id: 'risco',
    titulo: 'Risco por funcionário',
    grupo: 'Telas do Financeiro',
    resumo: 'Cancelamentos, descontos, estornos, reimpressões, diferenças e ajustes de cada pessoa no período. Só o dono e o gerente veem.',
    corpo: (
      <>
        <Bloco titulo="Como ler">
          <p>A tela destaca quem foge do padrão da equipe — por exemplo, quem cancela muito mais que os colegas. Não acusa ninguém: é um sinal para olhar a auditoria com calma.</p>
        </Bloco>
        <Erros itens={[
          'Tirar conclusão só pelo número: quem trabalha mais turnos naturalmente faz mais ações.',
        ]} />
      </>
    ),
  },
  {
    id: 'auditoria',
    titulo: 'Auditoria',
    grupo: 'Telas do Financeiro',
    resumo: 'O registro de quem fez o quê, de qual aparelho e quem aprovou.',
    corpo: (
      <>
        <Bloco titulo="O que aparece">
          <Termos itens={[
            ['Integridade dos registros', <>Toque em <B>Verificar integridade</B>. Se nada foi alterado ou apagado, aparece <B>Tudo íntegro</B>.</>],
            ['Alertas', 'A lista de alertas (veja a seção Alertas).'],
            ['Acessos recentes', 'Quem entrou no painel, de qual aparelho e quando.'],
            ['Aprovações por PIN', 'Quem aprovou cada ação acima do limite e quem pediu.'],
          ]} />
        </Bloco>
        <Erros itens={[
          'Ignorar um problema de integridade: fale com o suporte da Menuzia no mesmo dia.',
        ]} />
      </>
    ),
  },
  {
    id: 'regras',
    titulo: 'Regras e limites',
    grupo: 'Telas do Financeiro',
    resumo: 'As configurações do Financeiro. Só o dono altera; os outros só veem.',
    corpo: (
      <>
        <Bloco titulo="O que dá para ajustar">
          <Termos itens={[
            ['Tolerância no fechamento', 'Diferença até este valor: só explicação. Acima: PIN de gerente ou dono.'],
            ['Saída do caixa sem aprovação', 'Sangria, despesa, retirada, perda e conta paga com dinheiro do caixa acima disto pedem PIN (padrão R$ 100,00).'],
            ['Conta paga pela empresa sem aprovação', 'Acima disto, pagar conta ou compra pela empresa pede PIN (padrão R$ 300,00).'],
            ['Mesas/comandas abertas no fechamento', 'Acima deste total em aberto, passar para o próximo turno pede PIN (padrão R$ 100,00).'],
            ['Fundo de caixa', 'O troco que fica na gaveta na abertura.'],
            ['Desconto alto', 'Acima deste valor ou % o dono recebe alerta.'],
            ['Avisos de tempo', 'Caixa sem abrir, caixa aberto há muitas horas, motoboy com dinheiro há muitas horas.'],
            ['WhatsApp dos alertas', 'O número que recebe os alertas graves.'],
            ['Meta de faturamento por dia', 'Opcional: desenha a linha de meta no gráfico do Dashboard.'],
          ]} />
        </Bloco>
        <Erros itens={[
          'Colocar o limite de saída muito alto: o PIN deixa de proteger as sangrias.',
        ]} />
      </>
    ),
  },
  {
    id: 'situacoes',
    titulo: 'Situações do dia a dia',
    grupo: 'No dia a dia',
    resumo: 'Respostas rápidas para o que mais acontece.',
    corpo: (
      <div className="space-y-2">
        <Pergunta pergunta="Faltou dinheiro no fechamento, e agora?">
          <p>Conte de novo antes de digitar. Se a falta continuar, digite o valor contado e explique o que pode ter acontecido (troco errado, sangria não lançada...). Se passar da tolerância, outra pessoa aprova com o PIN e o dono recebe alerta. A falta aparece no DRE em Diferenças de caixa.</p>
        </Pergunta>
        <Pergunta pergunta="Cliente pediu estorno">
          <p>Cancele o pedido onde ele foi feito (PDV, mesa ou Pedidos) — o cancelamento fica registrado com o nome de quem fez. Se o valor estava numa conta a receber ou a pagar já baixada, use <B>Estornar baixa</B> na conta: pede o PIN de outra pessoa, menos para o dono. Tudo aparece na Auditoria.</p>
        </Pergunta>
        <Pergunta pergunta="Motoboy voltou com troco errado">
          <p>Faça o acerto normalmente e digite o que ele trouxe. A diferença fica como dívida dele e o dono recebe alerta. Só o dono dá baixa na pendência, com motivo.</p>
        </Pergunta>
        <Pergunta pergunta="Esqueci de fechar o caixa ontem">
          <p>Feche agora, contando a gaveta como está. O sistema já avisa quando o caixa passa de 14 horas aberto. Se as vendas de hoje já entraram nele, explique na justificativa.</p>
        </Pergunta>
        <Pergunta pergunta="Pix não caiu">
          <p>Em Conferir Pix, escreva o motivo e toque em <B>Não caiu</B>. Fale com o cliente. Pix online é conferido sozinho pelo Mercado Pago.</p>
        </Pergunta>
        <Pergunta pergunta="Como vejo meu lucro?">
          <p>No Dashboard (lucro bruto e líquido) ou no DRE (linha por linha). Para o número sair certo, cadastre o custo dos itens em Precificação / CMV.</p>
        </Pergunta>
        <Pergunta pergunta="Caixa passou da meia-noite">
          <p>Normal. No Fluxo de caixa o turno aparece no dia em que abriu, com o aviso de até quando foi. No Dashboard e no DRE cada venda conta no dia dela.</p>
        </Pergunta>
      </div>
    ),
  },
]
