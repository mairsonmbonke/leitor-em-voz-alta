import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extensao, juntarLinhas, textoDoDocx, textoDoOdt } from '../src/lib/documento.ts'

test('reconhece a extensão do arquivo', () => {
  assert.equal(extensao('relatório.PDF'), 'pdf')
  assert.equal(extensao('carta final.docx'), 'docx')
  assert.equal(extensao('sem-extensao'), '')
})

// ── Word ──────────────────────────────────────────────────────────────

const docx = (corpo: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="x"><w:body>${corpo}</w:body></w:document>`

test('extrai os parágrafos de um .docx', () => {
  const xml = docx(
    '<w:p><w:r><w:t>Primeiro </w:t></w:r><w:r><w:t xml:space="preserve">parágrafo.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Segundo parágrafo.</w:t></w:r></w:p>',
  )
  assert.equal(textoDoDocx(xml), 'Primeiro parágrafo.\nSegundo parágrafo.')
})

test('converte tabulações, quebras de linha e entidades do .docx', () => {
  const xml = docx('<w:p><w:r><w:t>Um</w:t><w:tab/><w:t>dois</w:t><w:br/><w:t>tr&#234;s &amp; quatro</w:t></w:r></w:p>')
  assert.equal(textoDoDocx(xml), 'Um\tdois\ntrês & quatro')
})

test('ignora a formatação e os parágrafos vazios do .docx', () => {
  const xml = docx(
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Título</w:t></w:r></w:p>' +
      '<w:p/>' +
      '<w:p><w:r><w:t>Texto.</w:t></w:r></w:p>',
  )
  assert.equal(textoDoDocx(xml), 'Título\n\nTexto.')
})

// ── OpenDocument ──────────────────────────────────────────────────────

test('extrai títulos e parágrafos de um .odt', () => {
  const xml =
    '<office:text><text:h text:outline-level="1">Título</text:h>' +
    '<text:p>Uma <text:span>frase</text:span> só.</text:p></office:text>'
  assert.equal(textoDoOdt(xml), 'Título\nUma frase só.')
})

// ── PDF ───────────────────────────────────────────────────────────────

test('remonta os parágrafos quebrados em linhas de um PDF', () => {
  const pagina = [
    'A leitura em voz alta é um recurso de acessibilidade que ajuda quem',
    'prefere ouvir a ler, e também quem quer revisar o próprio texto.',
    'Este é o fim do parágrafo.',
    '',
    'Já este é outro parágrafo.',
  ].join('\n')

  assert.equal(
    juntarLinhas(pagina),
    'A leitura em voz alta é um recurso de acessibilidade que ajuda quem prefere ouvir a ler, e também quem quer ' +
      'revisar o próprio texto. Este é o fim do parágrafo.\n\nJá este é outro parágrafo.',
  )
})

test('junta a palavra cortada com hífen no fim da linha', () => {
  const pagina = [
    'O programa mostra o trecho destacado enquanto a leitura conti-',
    'nua, e a pessoa acompanha sem se perder no meio do documento.',
  ].join('\n')

  assert.ok(juntarLinhas(pagina).includes('continua,'), juntarLinhas(pagina))
})

test('mantém títulos e itens de lista em parágrafos separados', () => {
  const pagina = [
    'Relatório anual',
    'O ano começou com uma expansão significativa das operações da',
    'empresa em todas as regiões atendidas pela equipe comercial.',
    '- primeiro item da lista de resultados apurados no período',
    '- segundo item da lista de resultados apurados no período',
  ].join('\n')

  const paragrafos = juntarLinhas(pagina).split('\n\n')
  assert.equal(paragrafos[0], 'Relatório anual')
  assert.equal(paragrafos.length, 4)
  assert.ok(paragrafos[1].startsWith('O ano começou'))
  assert.ok(paragrafos[2].startsWith('- primeiro'))
})

test('texto vazio não vira parágrafo nenhum', () => {
  assert.equal(juntarLinhas('   \n\n  \n'), '')
})
