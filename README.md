# Leitura de Textos em Voz Alta

Página web que lê um texto em voz alta, em **português, inglês ou espanhol**,
destacando na tela o trecho que está sendo falado — para acompanhar com os olhos
enquanto se ouve.

O texto pode ser colado, digitado ou aberto de um arquivo **PDF, Word (`.docx`),
OpenDocument (`.odt`) ou de texto (`.txt`, `.md`, `.csv`)**.

Tudo roda no navegador de quem usa: a voz é a do próprio sistema (Web Speech
API) e os arquivos são abertos na máquina. Nada é enviado para servidor nenhum.

**No ar em:** https://mairsonmbonke.github.io/leitor-em-voz-alta/

## Como usar

1. Cole ou digite o texto — ou toque em **Arquivo** para abrir um documento (no
   computador também dá para arrastar o arquivo para cima do texto).
2. Escolha o **idioma**, a **voz** e a **velocidade** (de 0,5× a 2×).
3. **Iniciar**, **Pausar**, **Continuar** e **Parar** comandam a leitura.
4. Durante a leitura, **um clique em qualquer palavra continua dali** — serve
   para pular um trecho ou voltar e ouvir de novo.
5. A frase em leitura fica realçada e a palavra falada, destacada; a página rola
   sozinha para acompanhar.

O texto, o idioma, a voz e a velocidade ficam salvos no navegador para a próxima
visita. `espaço` alterna entre ouvir e pausar, e `Esc` para.

Funciona no computador e no celular. No celular, vale usar "Adicionar à tela de
início" pelo menu do navegador: a página abre como um aplicativo.

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
src/
  main.tsx         ponto de entrada
  Leitor.tsx       a tela inteira: texto, ajustes e controles
  Frase.tsx        uma frase, palavra a palavra (é o que recebe o clique)
  useLeitura.ts    conduz a síntese de voz trecho a trecho
  icons.tsx        ícones
  lib/
    leitura.ts     divisão do texto em trechos e palavras, com as posições
    vozes.ts       idiomas oferecidos e escolha da voz do navegador
    documento.ts   texto de arquivos PDF, .docx, .odt e texto puro
    format.ts      duração em linguagem natural
  styles/          global.css (tokens e componentes) e leitor.css (a página)
test/              testes das funções puras (node:test, sem dependências)
```

## Publicação

O site é estático — não tem servidor, banco nem chave de API. A cada push na
`main`, o workflow `.github/workflows/deploy.yml` roda o build e publica no
GitHub Pages; também dá para republicar pela aba **Actions → Publicar no GitHub
Pages → Run workflow**.

**Antes da primeira publicação**, é preciso ativar o Pages uma vez, à mão, em
**Settings → Pages → Source: GitHub Actions**. Enquanto isso não for feito, o
job falha no passo "Conferir a configuração do Pages".

O caminho `/leitor-em-voz-alta/` é o nome do repositório, e o `vite.config.ts`
usa esse prefixo no build. Se o repositório for renomeado, ajuste a constante
`BASE_PAGES`.

## Compatibilidade

Chrome, Edge, Safari (incluindo iPhone e iPad) e Chrome do Android. As vozes vêm
do sistema operacional, então a lista muda de aparelho para aparelho — se não
houver nenhuma voz do idioma escolhido, a página avisa. No Android o `pause()`
do navegador costuma ser ignorado; nesse caso a fala é cortada e o **Continuar**
recomeça exatamente da palavra em que parou.
