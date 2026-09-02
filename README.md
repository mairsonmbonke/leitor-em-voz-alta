# Leitura de Textos em Voz Alta

Página web que lê um texto em voz alta, em **português, inglês, espanhol ou
alemão**,
destacando na tela o trecho que está sendo falado — para acompanhar com os olhos
enquanto se ouve.

O texto pode ser colado, digitado, aberto de um arquivo **PDF, Word (`.docx`),
OpenDocument (`.odt`) ou de texto (`.txt`, `.md`, `.csv`)**, trazido do **Google
Drive**, ou **reconhecido dentro de fotos e PDFs digitalizados**. E pode ser
**traduzido** entre os quatro idiomas, com o original preservado ao lado.

Quase tudo roda no navegador de quem usa: a voz, a leitura dos arquivos e o
reconhecimento de texto acontecem na própria máquina. Duas exceções, e só
quando pedidas: a **tradução** no Safari e no iPhone passa pelo MyMemory (o
texto vai para lá), e o **Google Drive** conversa com o Google para trazer o
arquivo que você escolher. O texto nunca é enviado a servidor nenhum durante a
leitura.

**No ar em:** https://mairsonmbonke.github.io/leitor-em-voz-alta/

## Como usar

1. Cole ou digite o texto — ou toque em **Arquivo** para abrir um documento (no
   computador também dá para arrastar o arquivo para cima do texto).
2. Escolha o **idioma**, a **voz** e a **velocidade** (de 0,5× a 2×).
3. Um botão só comanda a leitura: **Ouvir**, que vira **Pausar** e depois
   **Continuar** — sempre do ponto exato em que parou. **Parar** é o único que
   volta ao começo do texto (assim como abrir outro arquivo ou clicar numa
   palavra para começar dali).
4. Durante a leitura, **um clique em qualquer palavra continua dali** — serve
   para pular um trecho ou voltar e ouvir de novo.
5. A frase em leitura fica realçada e a palavra falada, destacada; a página rola
   sozinha para acompanhar.

O texto, o idioma, a voz e a velocidade ficam salvos no navegador para a próxima
visita. `espaço` alterna entre ouvir e pausar, e `Esc` para.

## A voz

Na primeira vez, a voz é escolhida sozinha, da mais natural para a menos: a
**Microsoft Thalita Multilingual** quando existe no aparelho (Windows com o Edge
instalado), senão outra voz neural do português do Brasil — as antigas, de
sonoridade mecânica (`Desktop`, `Compact`, eSpeak), ficam no fim da lista.
Vozes do dialeto certo vêm antes: para um texto brasileiro, uma voz de pt-BR
soa melhor que uma de Portugal, mesmo que a de Portugal seja mais natural.

Escolher outra voz na lista guarda a preferência para as próximas visitas, uma
por idioma. Se a voz guardada sumir do aparelho, a escolha automática volta a
valer.

Funciona no computador e no celular. No celular, vale usar "Adicionar à tela de
início" pelo menu do navegador: a página abre como um aplicativo.

## A voz natural (a que não depende do aparelho)

No iPhone, as vozes boas da Siri não são entregues à web: só sobram as
mecânicas. Para não ficar refém disso, a página oferece uma **voz natural que
roda no próprio aparelho** — um modelo do [Piper](https://github.com/rhasspy/piper),
de código aberto, baixado uma vez (~60 MB por idioma) e guardado no navegador.
Depois disso ela funciona até sem internet. Não custa nada, não pede cadastro e
não usa chave nenhuma.

O que a página baixa, e de onde:

| Peça | Tamanho | De onde vem |
| --- | --- | --- |
| Modelo da voz (`.onnx`) e seus ajustes (`.onnx.json`) | ~60 MB | `huggingface.co/rhasspy/piper-voices`, com `diffusionstudio/piper-voices` como reserva |
| Motor de inferência (WebAssembly do ONNX) | ~14 MB | a própria página |
| Conversor de letras em sons e dados do espeak-ng | ~18 MB | a própria página (`motor/`) |

**Só o modelo vem de fora.** Durante o download a tela mostra quantos megabytes
já vieram de quantos, e dá para cancelar.

Quando alguma coisa dá errado, a mensagem diz **o que** deu errado — o endereço
que respondeu 404, o servidor que recusou, a rede que bloqueou, a falta de
espaço, o download interrompido no meio, a página de erro que veio no lugar do
modelo — e o botão *Ver detalhes* mostra o pedido que falhou. Em qualquer falha:

- dá para **tentar de novo**, e a segunda tentativa começa limpa;
- o **texto continua na tela** e a leitura **fica no mesmo ponto**;
- a **velocidade e o idioma** escolhidos ficam como estavam;
- a voz escolhida **não muda sozinha** — quem troca é você, no botão
  *Usar a voz do aparelho*, que retoma exatamente de onde a outra parou.

Um modelo que tenha sido guardado pela metade (ou corrompido) é descartado
sozinho na próxima visita, para não falhar de novo pelo mesmo motivo.

### iPhone e Safari

A voz natural funciona no Safari e no iPhone recentes: precisa de WebAssembly e
do armazenamento privado do navegador (OPFS), presentes desde o iOS 17. Onde a
gravação moderna não existe, a página grava por outro caminho, o que o Safari
oferece (`createSyncAccessHandle`, dentro de um *worker*). Onde faltar o
essencial, o botão da voz natural nem aparece e as vozes do aparelho seguem
funcionando.

Duas ressalvas honestas, que dependem do aparelho de cada um: são ~90 MB para
guardar (a página confere o espaço antes de começar) e o modelo roda na memória
do navegador — em iPhones antigos ele pode não caber, e nesse caso a mensagem
diz isso, sem travar a leitura.

## Acompanhar a leitura sem perder o lugar

A área do texto rola sozinha atrás do trecho falado. Quando alguém rola com o
dedo ou com a roda do mouse para procurar outra parte, **o acompanhamento é
solto na hora**: a leitura continua, o destaque continua, mas a tela fica onde
foi deixada. Um botão discreto — *Voltar ao trecho atual* — traz a tela de volta
e retoma o acompanhamento. Clicar numa palavra para ler dali também retoma.

## Reconhecer texto em fotos e PDFs digitalizados

Fotos com palavras (`.jpg`, `.png`, `.webp`) e PDFs sem texto por baixo passam
pelo reconhecimento óptico do [Tesseract](https://tesseract.projectnaptha.com/),
que roda no navegador — sem servidor, sem cadastro e sem chave. Os dados de cada
idioma são baixados na primeira vez e ficam no cache.

- Reconhece **português, inglês, espanhol e alemão** (segue o idioma escolhido).
- Mostra o andamento e dá para **cancelar** a qualquer momento.
- Num PDF digitalizado, cada página vira imagem e é reconhecida em sequência,
  até 50 páginas.
- Sem palavras legíveis, explica o que fazer em vez de falhar em silêncio.
- Fotos **HEIC** do iPhone: alguns navegadores não as abrem. Nesse caso a página
  orienta a trocar o formato em *Ajustes → Câmera → Formatos → Mais compatível*,
  ou compartilhar como JPEG.

O texto reconhecido entra na área de leitura como qualquer outro: dá para
revisar, corrigir, traduzir e ouvir.

## Traduzir

O botão **Traduzir** abre um painel com dois campos e um botão:

- **Idioma original** — *Detectar automaticamente* (mostrando qual idioma foi
  identificado) ou português, inglês, espanhol e alemão, para corrigir à mão.
- **Traduzir para** — os mesmos quatro idiomas, menos o do original.
- **Traduzir** — verte o texto inteiro, parágrafo a parágrafo, que é o que
  mantém original e tradução alinhados.

No computador o painel já vem aberto; no celular ele abre no botão *Traduzir*,
para não roubar a altura que o texto precisa.

- O idioma do texto é **descoberto sozinho** a cada mudança — digitado, colado,
  aberto de um arquivo ou reconhecido numa foto — e pode ser corrigido tanto no
  painel quanto nos botões PT/EN/ES/DE.
- O idioma de destino nunca pode ser igual ao de origem.
- **Ouvir original** e **Ouvir tradução** escolhem qual das duas versões é lida.
- A tradução pode ser **corrigida à mão** no botão *Editar*, sem tocar no
  original.
- No computador, original e tradução aparecem **lado a lado**; no celular, em
  duas **abas**.
- A versão escolhida é a que se lê, **com a voz do idioma dela** — nunca as duas
  ao mesmo tempo. Trocar de versão encerra a leitura anterior.
- O original nunca é apagado: dá para voltar a ele, ou traduzir de novo para
  outro idioma, sem reabrir o arquivo.
- Textos grandes mostram o andamento e podem ser cancelados.

De onde vem a tradução, nesta ordem:

| Origem | Custo | Limite | Onde funciona |
| --- | --- | --- | --- |
| Tradutor embutido do navegador (`Translator`) | grátis | sem limite | Chrome e Edge recentes, no computador |
| [MyMemory](https://mymemory.translated.net/) | grátis, sem cadastro | alguns milhares de caracteres por dia, por conexão | qualquer navegador (é o caso do iPhone) |

Nenhuma das duas pede chave de acesso, cadastro ou cartão — não há nada a
contratar. Quando o limite diário do MyMemory acaba, a página avisa e sugere o
computador com Chrome ou Edge.

**No iPhone e no Safari**, o tradutor embutido do navegador não existe (é uma
funcionalidade do Chrome e do Edge, e só no computador). Lá a tradução passa
sempre pelo MyMemory: funciona sem configurar nada, mas tem o limite diário
gratuito de alguns milhares de caracteres por conexão. Para traduzir um livro
inteiro, o computador com Chrome ou Edge é o caminho — ali não há limite, e a
tradução acontece dentro do próprio aparelho.

## Google Drive

O botão **Conectar ao Drive** abre a tela de login do próprio Google. Depois de
autorizar, a janela oficial do Google mostra os arquivos e você escolhe um —
PDF, Word, TXT, Documentos Google (exportados como texto) e imagens JPG/PNG. O
arquivo escolhido entra no leitor pelo mesmo caminho de um arquivo do
computador.

Quem usa não cadastra nada. Na barra de ajustes ficam a **conta conectada**,
**Abrir arquivo**, **Trocar de conta** e **Desconectar** (que cancela a
autorização no Google, não só aqui). A conexão continua valendo entre visitas
enquanto a autorização durar.

O acesso é o mais estreito que o Google oferece: `drive.file` dá permissão **só
aos arquivos que você escolher** na janela do Google — o programa não enxerga o
resto do Drive —, mais `userinfo.email`, que serve apenas para mostrar qual
conta está conectada.

### Configuração — uma vez só, por quem publica o site

Nada disto é senha. Neste fluxo (OAuth de navegador, sem servidor) **não existe
chave secreta**: o *ID do cliente* é público por natureza — aparece na barra de
endereços em qualquer login com Google — e sozinho não dá acesso a nada. Quem
protege a conta é a lista de origens autorizadas: o ID só funciona no endereço
cadastrado. Mesmo assim ele não fica escrito no código: entra no build, a partir
de uma variável.

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) e crie um
   projeto (ou use um existente).
2. Em **APIs e serviços → Biblioteca**, ative a **Google Drive API** e a
   **Google Picker API**.
3. Em **APIs e serviços → Tela de permissão OAuth**, escolha *Externo*, preencha
   o nome do aplicativo e o seu e-mail. Em **Escopos**, acrescente
   `.../auth/drive.file` e `.../auth/userinfo.email`.
   - Enquanto a tela estiver em *Teste*, só os e-mails listados em
     **Usuários de teste** conseguem entrar — acrescente o seu ali. Para
     liberar a qualquer pessoa, publique a tela de permissão (o Google pede uma
     verificação; com o escopo `drive.file` ela costuma ser simples).
4. Em **Credenciais → Criar credenciais → ID do cliente OAuth**, tipo
   *Aplicativo da Web*. Em **Origens JavaScript autorizadas**, acrescente
   `https://mairsonmbonke.github.io` (e `http://localhost:5173` para testar na
   sua máquina). **Não é preciso URI de redirecionamento.** Copie o
   **ID do cliente**.
5. No GitHub, em **Settings → Secrets and variables → Actions → Variables →
   New repository variable**, crie `VITE_GOOGLE_CLIENT_ID` com esse valor.
6. Republique pela aba **Actions → Publicar no GitHub Pages → Run workflow**.

Pronto — o botão passa a funcionar para qualquer pessoa que abrir a página.
Para rodar na sua máquina, copie `.env.example` para `.env` e ponha o mesmo
valor ali.

Enquanto a variável não existir, o site publica normalmente e a página explica,
em vez de falhar em silêncio, que o Drive ainda não foi ligado — o botão
**Arquivo** continua abrindo qualquer documento do aparelho.

## Arquivos aceitos

| Formato | Como o texto é extraído |
| --- | --- |
| PDF | `pdf.js`, página a página; as linhas soltas do PDF são remontadas em parágrafos |
| Word `.docx` | o `.docx` é um zip: o `word/document.xml` é descompactado e lido |
| OpenDocument `.odt` | mesma ideia, com o `content.xml` |
| `.txt`, `.md`, `.csv` | lidos direto |

Limite de 30 MB por arquivo. PDFs digitalizados (imagem, sem texto selecionável)
e o formato antigo `.doc` não dão para ler — nos dois casos a página explica o
motivo em vez de falhar em silêncio. As bibliotecas de PDF e de descompactação
só são baixadas quando alguém abre um arquivo desses; quem só cola texto carrega
poucos kB.

## Como a leitura acompanha o texto

O texto é dividido em **trechos** — em geral uma frase, com quebra extra nas
frases muito longas — e cada trecho guarda a posição exata em que começa e
termina no texto original. É essa posição que liga as três pontas: o pedaço
mandado para a voz, o destaque na tela e o ponto em que a leitura recomeça no
clique.

Falar frase a frase, em vez de mandar o texto inteiro de uma vez, ainda contorna
o limite que os navegadores impõem a falas longas e faz a troca de voz, de
velocidade ou de ponto de leitura ser quase instantânea.

## Como rodar no seu computador

Precisa do [Node.js](https://nodejs.org) 22 ou mais novo.

```bash
npm install
npm run dev      # http://localhost:5173
```

Outros comandos:

```bash
npm run build     # verificação de tipos + build de produção em dist/
npm run preview   # serve o build de produção
npm test          # testes das funções puras
```

## Estrutura

```
index.html         a página
.env.example       a configuração do Google Drive (feita uma vez, pelo dono)
scripts/
  preparar-motor.mjs  copia para public/motor/ as peças da voz natural
src/
  main.tsx         ponto de entrada
  Leitor.tsx       a tela inteira: texto, ajustes e controles
  Frase.tsx        uma frase, palavra a palavra (é o que recebe o clique)
  useLeitura.ts    leitura com a voz do sistema, trecho a trecho
  useLeituraNatural.ts  leitura com a voz baixada: gera, toca e acompanha
  Protecao.tsx     rede de segurança da tela (tradução do navegador)
  icons.tsx        ícones
  lib/
    leitura.ts     divisão do texto em trechos e palavras, com as posições
    vozes.ts       idiomas oferecidos e escolha da voz do navegador
    vozNatural.ts  catálogo, download e síntese da voz que roda no aparelho
    tempos.ts      em que instante do áudio cai cada palavra
    documento.ts   texto de PDF, .docx, .odt, texto puro e páginas em imagem
    ocr.ts         reconhecimento do texto de fotos e páginas digitalizadas
    traducao.ts    descoberta do idioma e tradução parágrafo a parágrafo
    drive.ts       abrir um arquivo do Google Drive, só o escolhido
    format.ts      duração em linguagem natural
  styles/          global.css (tokens e componentes) e leitor.css (a página)
test/              testes das funções puras (node:test, sem dependências)
```

## Publicação

O site é estático — não tem servidor, banco nem chave secreta. A cada push na
`main`, o workflow `.github/workflows/deploy.yml` roda o build e publica no
GitHub Pages; também dá para republicar pela aba **Actions → Publicar no GitHub
Pages → Run workflow**.

O build lê as *variables* `VITE_GOOGLE_CLIENT_ID` (e, se quiser,
`VITE_GOOGLE_API_KEY` e `VITE_GOOGLE_APP_ID`) do repositório — é só isso que o
Google Drive precisa, e é a única configuração do projeto. Sem elas o site
publica igual, com o Drive desligado e explicado na tela.

**Antes da primeira publicação**, é preciso ativar o Pages uma vez, à mão, em
**Settings → Pages → Source: GitHub Actions**. Enquanto isso não for feito, o
job falha no passo "Conferir a configuração do Pages".

O caminho `/leitor-em-voz-alta/` é o nome do repositório, e o `vite.config.ts`
usa esse prefixo no build. Se o repositório for renomeado, ajuste a constante
`BASE_PAGES`.

## A tradução automática do navegador

Ligar a tradução do navegador (Chrome/Google Tradutor) nesta página costumava
**deixar a tela preta**: ela troca os nós de texto por conta própria e o React,
ao atualizar a tela, não encontra mais o que criou. Duas defesas agora:

1. A página pede para não ser traduzida (`translate="no"` na raiz e a meta
   `notranslate`) — a interface não precisa disso, porque a tradução do conteúdo
   é feita pelo botão **Traduzir**.
2. Se ainda assim algo derrubar a tela, uma rede de segurança mostra a
   explicação e um botão de recarregar, em vez de uma tela vazia.

## Compatibilidade

Chrome, Edge, Safari (incluindo iPhone e iPad) e Chrome do Android. As vozes do
aparelho vêm do sistema operacional, então a lista muda de um para outro — se
não houver nenhuma voz do idioma escolhido, a página avisa. A voz natural pede
WebAssembly e o sistema de arquivos privado do navegador (OPFS), presentes em
todos esses navegadores em versão recente (no iPhone, iOS 17 em diante); onde
faltar, o botão nem aparece. No Android o `pause()`
do navegador costuma ser ignorado; nesse caso a fala é cortada e o **Continuar**
recomeça exatamente da palavra em que parou.
