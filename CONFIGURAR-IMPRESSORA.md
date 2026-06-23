# Como configurar a impressora (passo a passo)

Guia simples para deixar os pedidos saindo direto na impressora da loja.
Não precisa entender de informática — é só seguir na ordem.

---

## Antes de começar: entenda a ideia (1 minuto de leitura)

O painel do Menuzia funciona **no navegador**, e o navegador **não consegue
falar direto com a impressora**. Por isso existem **duas partes** que você vai
ligar uma na outra:

1. **O painel** (o site do Menuzia, em `Ajustes > Impressão`) → onde você
   cadastra a impressora e gera uma **senha de conexão** (chamada de "token").
2. **O Assistente de Impressão** → um **programinha que fica no computador da
   loja**, ligado na impressora. É ele que recebe o pedido do painel e manda
   imprimir.

> Pense assim: o **token** é a "senha" que faz o programinha do computador
> reconhecer a sua loja. Sem o programa instalado e pareado, configurar só no
> painel **não imprime nada**.

**Você só precisa fazer essa configuração uma vez.** Depois disso, é só deixar
o computador ligado com o programa aberto que os pedidos imprimem sozinhos.

---

## O que você precisa ter

- O **computador da loja** com **Windows**.
- A **impressora já instalada nesse computador** (aquela que aparece em
  *Configurações do Windows > Bluetooth e dispositivos > Impressoras e
  scanners*). Se ela imprime uma página de teste pelo Windows, está pronta.
- Acesso ao **painel do Menuzia** (seu login de dono/gerente).

---

# PARTE 1 — No painel do Menuzia (pode ser em qualquer aparelho)

### Passo 1. Abra a tela de impressão
No menu lateral, vá em **Ajustes** e clique na aba **Impressão**.

### Passo 2. Gere a senha de conexão (token)
Na primeira caixa ("Assistente de Impressão Menuzia"), procure a área de
**token de pareamento** e clique em **"Gerar token de pareamento"**.
Vai aparecer um código. Clique em **"Copiar"** (ou deixe essa tela aberta —
você vai usar esse código daqui a pouco no computador).

> ⚠️ Se um dia você clicar em "Gerar novo token", o token antigo para de
> funcionar e você precisa colar o novo no Assistente de novo.

### Passo 3. Ligue as opções de impressão
Ainda nessa caixa, ligue (deixe azul) os botões:

- **Ativar uso do Assistente de Impressão**
- **Impressão automática de pedidos** — *este é o mais importante*: é o que faz
  o pedido imprimir sozinho assim que chega. Se ele estiver desligado, nada
  imprime automaticamente.

### Passo 4. Cadastre a impressora
Mais abaixo, na caixa **"Impressoras"**, clique em **"+ Nova impressora"** e
preencha:

- **Nome**: um apelido qualquer pra você se achar (ex.: `Cozinha` ou `Balcão`).
- **Largura**: a largura do papel da sua impressora térmica. O padrão é
  **80mm** (algumas menores são 58mm). Na dúvida, deixe 80mm.
- **Cópias**: quantas vias imprimir de cada pedido (normalmente **1**).

Clique em **Salvar**. Pronto, a Parte 1 está feita.

---

# PARTE 2 — No computador da loja (o que está ligado na impressora)

> Faça esta parte **no computador onde a impressora está conectada**.

### Passo 5. Baixe o Assistente de Impressão
Na mesma tela **Ajustes > Impressão**, clique no botão amarelo
**"⬇ Baixar Assistente de Impressão (Windows)"**.

Vai baixar um arquivo **.zip** (cerca de 105 MB). Espere terminar.

### Passo 6. Extraia o arquivo
1. Abra a pasta **Downloads**.
2. Clique com o **botão direito** no arquivo que baixou
   (`AssistenteImpressaoMenuzia-win...zip`) e escolha **"Extrair tudo..."** →
   **"Extrair"**.
3. Vai aparecer uma **pasta** com o mesmo nome. Abra ela.

> Importante: não dá pra rodar de dentro do .zip. Tem que **extrair** primeiro.

### Passo 7. Abra o programa
Dentro da pasta extraída, dê **dois cliques** no arquivo
**`Assistente de Impressão Menuzia.exe`**.

- Se o Windows mostrar um aviso azul **"O Windows protegeu o computador"**,
  clique em **"Mais informações"** e depois em **"Executar assim mesmo"**.
  (É só porque o programa ainda não é assinado digitalmente — pode confiar.)

### Passo 8. Preencha os dados de conexão
Na janela do Assistente vão aparecer alguns campos. Preencha:

- **URL do seu Menuzia**: o endereço do seu painel, começando com `https://`
  (o mesmo que aparece na barra do navegador quando você usa o Menuzia).
  Ex.: `https://app.suapizzaria.com`
- **Token de pareamento**: **cole aqui** o código que você copiou no Passo 2.

Clique em **"Testar conexão"**. Se aparecer mensagem de sucesso, está ligado
na sua loja. ✅
(Se der erro, confira se a URL está certa e se o token é o mais recente —
veja a seção "Deu problema?" no fim.)

### Passo 9. Escolha a impressora
No campo **"Impressora (instalada no Windows)"**, abra a lista e selecione a
impressora da loja (ex.: **Cozinha**). Se ela não aparecer, clique em
**"Atualizar lista"**.

Em **"Configuração de impressão (cadastrada no painel)"**, escolha o nome que
você cadastrou no Passo 4 (ex.: `Cozinha`).

### Passo 10. Salve e teste
1. Clique em **"Salvar"**.
2. Clique em **"Imprimir teste"** — deve sair um papel de teste na impressora.

Se saiu o teste, **está tudo pronto**. 🎉

---

## Deixando funcionando no dia a dia

- Deixe o **computador ligado** e o **Assistente de Impressão aberto** durante
  o expediente. Pode minimizar a janela — ele continua trabalhando.
- A partir de agora, **todo pedido novo imprime sozinho**.
- Se desligar o computador, é só abrir o programa de novo quando ligar
  (os dados já ficam salvos — não precisa colar o token toda vez).

---

## Deu problema? (soluções rápidas)

**Não imprime nada quando chega pedido**
- O Assistente está **aberto** no computador? (Tem que estar.)
- No painel, o botão **"Impressão automática de pedidos"** está **ligado**?
- No Assistente, a impressora certa está selecionada e o **"Imprimir teste"**
  funciona?

**"Testar conexão" dá erro**
- Confira a **URL** (tem que começar com `https://` e ser a mesma do navegador).
- O **token** pode ter sido trocado. Volte no painel, gere um token novo,
  copie e cole de novo no Assistente.

**A impressora não aparece na lista do Assistente**
- Confirme que ela está instalada no Windows (imprime página de teste pelo
  próprio Windows). Depois clique em **"Atualizar lista"** no Assistente.

**Saiu o teste mas o papel vem cortado / fonte estranha**
- Ajuste a **Largura** (80mm ou 58mm) no cadastro da impressora no painel
  (Passo 4) e salve.

**Aviso "O Windows protegeu o computador" ao abrir o .exe**
- Normal. Clique em **"Mais informações" > "Executar assim mesmo"**.

---

## Resumo de bolso

1. Painel → **Ajustes > Impressão** → **Gerar token** e **copiar**.
2. Ligar **"Impressão automática de pedidos"**.
3. Cadastrar a impressora (**+ Nova impressora**).
4. **Baixar** o Assistente, **extrair** e **abrir** o `.exe`.
5. No Assistente: colar **URL** + **token** → **Testar conexão**.
6. Escolher a **impressora** → **Salvar** → **Imprimir teste**.
7. Deixar o computador ligado com o programa aberto. ✅
