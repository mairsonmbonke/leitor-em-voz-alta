import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDIOMAS, escolherVoz, idiomaPorCodigo, vozesDoIdioma } from '../src/lib/vozes.ts'
import { vozNaturalDoIdioma } from '../src/lib/vozNatural.ts'

/** Monta uma voz como o navegador entrega. */
function voz(name: string, lang: string, extras: { localService?: boolean; padrao?: boolean } = {}) {
  return {
    name,
    lang,
    voiceURI: name,
    localService: extras.localService ?? false,
    default: extras.padrao ?? false,
  } as SpeechSynthesisVoice
}

const PORTUGUES = idiomaPorCodigo('pt-BR')

// Uma lista parecida com a de um Windows recente com o Edge instalado.
const WINDOWS = [
  voz('Microsoft Maria Desktop - Portuguese(Brazil)', 'pt-BR', { localService: true, padrao: true }),
  voz('Microsoft Thalita Multilingual Online (Natural) - Portuguese (Brazil)', 'pt-BR'),
  voz('Microsoft Francisca Online (Natural) - Portuguese (Brazil)', 'pt-BR'),
  voz('Microsoft Raquel Online (Natural) - Portuguese (Portugal)', 'pt-PT'),
  voz('Microsoft Zira Desktop - English (United States)', 'en-US', { localService: true }),
]

test('a Thalita é a escolha automática quando existe', () => {
  const disponiveis = vozesDoIdioma(WINDOWS, PORTUGUES)
  assert.match(escolherVoz(disponiveis, null)!.name, /Thalita/)
})

test('sem a Thalita, escolhe outra voz natural do português do Brasil', () => {
  const semThalita = WINDOWS.filter((v) => !v.name.includes('Thalita'))
  const escolhida = escolherVoz(vozesDoIdioma(semThalita, PORTUGUES), null)!

  assert.match(escolhida.name, /Francisca/)
  assert.equal(escolhida.lang, 'pt-BR')
})

test('entre as do mesmo dialeto, a voz mecânica fica por último', () => {
  const doBrasil = vozesDoIdioma(WINDOWS, PORTUGUES)
    .filter((v) => v.lang === 'pt-BR')
    .map((v) => v.name)

  assert.ok(doBrasil[0].includes('Thalita'), doBrasil.join(' | '))
  assert.ok(doBrasil[doBrasil.length - 1].includes('Maria Desktop'), doBrasil.join(' | '))
})

test('um sotaque certo e mecânico ainda vem antes de um natural de Portugal', () => {
  // Ler texto brasileiro com voz de Portugal incomoda mais do que a
  // sonoridade mecânica, então o dialeto pesa mais que a naturalidade.
  const nomes = vozesDoIdioma(WINDOWS, PORTUGUES).map((v) => v.lang)
  assert.deepEqual(nomes, ['pt-BR', 'pt-BR', 'pt-BR', 'pt-PT'])
})

test('o dialeto certo vem antes: pt-BR na frente de pt-PT', () => {
  const so = [voz('Microsoft Raquel Online (Natural)', 'pt-PT'), voz('Microsoft Francisca Online (Natural)', 'pt-BR')]
  assert.equal(vozesDoIdioma(so, PORTUGUES)[0].lang, 'pt-BR')
})

test('a escolha manual da pessoa vence a automática', () => {
  const disponiveis = vozesDoIdioma(WINDOWS, PORTUGUES)
  const salva = 'Microsoft Francisca Online (Natural) - Portuguese (Brazil)'
  assert.equal(escolherVoz(disponiveis, salva)!.voiceURI, salva)
})

test('uma voz salva que sumiu do aparelho volta para a automática', () => {
  const disponiveis = vozesDoIdioma(WINDOWS, PORTUGUES)
  assert.match(escolherVoz(disponiveis, 'voz-que-nao-existe-mais')!.name, /Thalita/)
})

test('cada idioma só mostra as próprias vozes', () => {
  assert.deepEqual(
    vozesDoIdioma(WINDOWS, idiomaPorCodigo('en-US')).map((v) => v.lang),
    ['en-US'],
  )
  assert.deepEqual(vozesDoIdioma(WINDOWS, idiomaPorCodigo('es-ES')), [])
  assert.equal(escolherVoz([], null), null)
})

test('num aparelho da Apple, sobra a voz local de português', () => {
  const apple = [voz('Luciana', 'pt-BR', { localService: true, padrao: true }), voz('Joana', 'pt-PT', { localService: true })]
  assert.equal(escolherVoz(vozesDoIdioma(apple, PORTUGUES), null)!.name, 'Luciana')
})

test('os quatro idiomas oferecidos continuam de pé', () => {
  assert.deepEqual(
    IDIOMAS.map((i) => i.codigo),
    ['pt-BR', 'en-US', 'es-ES', 'de-DE'],
  )
})

test('cada idioma tem uma voz natural para baixar', () => {
  for (const idioma of IDIOMAS) {
    assert.ok(vozNaturalDoIdioma(idioma.codigo), `sem voz natural para ${idioma.codigo}`)
  }
  assert.equal(vozNaturalDoIdioma('it-IT'), null)
})
