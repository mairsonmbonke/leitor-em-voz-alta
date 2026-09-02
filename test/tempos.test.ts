import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distribuirTempos, palavraNoTempo } from '../src/lib/tempos.ts'
import { dividirEmPalavras, segmentar } from '../src/lib/leitura.ts'

/** As palavras de uma frase, como a tela as monta. */
function palavrasDe(texto: string) {
  return dividirEmPalavras(segmentar(texto)[0])
}

test('reparte a duração entre as palavras, sem sobra nem falta', () => {
  const tempos = distribuirTempos(palavrasDe('Uma frase curta para repartir.'), 6)

  assert.equal(tempos.length, 5)
  assert.equal(tempos[0].inicio, 0)
  assert.equal(tempos[tempos.length - 1].fim, 6)
  // Cada palavra começa exatamente onde a anterior terminou.
  for (let i = 1; i < tempos.length; i += 1) {
    assert.equal(tempos[i].inicio, tempos[i - 1].fim)
    assert.ok(tempos[i].fim > tempos[i].inicio, `palavra ${i} sem duração`)
  }
})

test('palavra comprida fica mais tempo em cena que palavra curta', () => {
  const [curta, comprida] = distribuirTempos(palavrasDe('Um extraordinariamente'), 4)
  assert.ok(comprida.fim - comprida.inicio > curta.fim - curta.inicio)
})

test('a pontuação ganha um respiro a mais', () => {
  const comPonto = distribuirTempos(palavrasDe('casa. casa casa casa'), 8)[0]
  const semPonto = distribuirTempos(palavrasDe('casa casa casa casa'), 8)[0]
  assert.ok(comPonto.fim > semPonto.fim, `${comPonto.fim} deveria passar de ${semPonto.fim}`)
})

test('encontra a palavra falada em cada instante', () => {
  const palavras = palavrasDe('Uma frase curta para repartir.')
  const tempos = distribuirTempos(palavras, 6)

  assert.equal(palavraNoTempo(tempos, -1), -1)
  assert.equal(palavraNoTempo(tempos, 0), 0)
  assert.equal(palavraNoTempo(tempos, 5.99), tempos.length - 1)
  // Depois do fim, continua na última em vez de sumir.
  assert.equal(palavraNoTempo(tempos, 99), tempos.length - 1)

  // O instante do meio de cada palavra devolve aquela mesma palavra.
  for (let i = 0; i < tempos.length; i += 1) {
    const meio = (tempos[i].inicio + tempos[i].fim) / 2
    assert.equal(palavraNoTempo(tempos, meio), i, `no instante ${meio.toFixed(2)}s`)
  }
})

test('o destaque só anda para a frente ao longo do áudio', () => {
  const tempos = distribuirTempos(palavrasDe('Primeira frase de teste, com vírgula e tudo mais.'), 10)
  let anterior = -1
  for (let t = 0; t <= 10; t += 0.1) {
    const atual = palavraNoTempo(tempos, t)
    assert.ok(atual >= anterior, `voltou atrás no instante ${t.toFixed(1)}s`)
    anterior = atual
  }
  assert.equal(anterior, tempos.length - 1)
})

test('sem palavras ou sem duração, não inventa tempos', () => {
  assert.deepEqual(distribuirTempos([], 5), [])
  assert.deepEqual(distribuirTempos(palavrasDe('Alguma coisa.'), 0), [])
  assert.deepEqual(distribuirTempos(palavrasDe('Alguma coisa.'), Number.NaN), [])
  assert.equal(palavraNoTempo([], 1), -1)
})
