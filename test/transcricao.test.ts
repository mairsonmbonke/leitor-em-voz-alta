/**
 * A fila de tentativas do modelo de transcrição.
 *
 * Cada tentativa frustrada custa dezenas de megabytes de download. Repetir a
 * cada visita uma combinação que já se sabe que não abre neste navegador é o
 * pior desperdício possível — e é isso que estes testes impedem.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const guardado = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (chave: string) => guardado.get(chave) ?? null,
    setItem: (chave: string, valor: string) => guardado.set(chave, valor),
    removeItem: (chave: string) => guardado.delete(chave),
  },
})

const { TENTATIVAS, chaveDa, tentativasDeHoje } = await import('../src/lib/transcricao.ts')

test('sem histórico, a fila é a ordem pensada — do mais leve ao último recurso', () => {
  guardado.clear()
  const fila = tentativasDeHoje()
  assert.deepEqual(fila.map(chaveDa), TENTATIVAS.map(chaveDa))
  // O download gigante fica por último, nunca na frente.
  assert.equal(fila.at(-1)!.mb, Math.max(...TENTATIVAS.map((t) => t.mb)))
})

test('o que já funcionou neste navegador passa à frente', () => {
  guardado.clear()
  const escolhida = chaveDa(TENTATIVAS[2])
  guardado.set('leitor.transcricao.escolha', JSON.stringify([escolhida]))

  const fila = tentativasDeHoje()
  assert.equal(chaveDa(fila[0]), escolhida, 'não começou pela que já tinha funcionado')
  assert.equal(fila.length, TENTATIVAS.length, 'perdeu tentativas pelo caminho')
})

test('o que já foi recusado sai da fila, para não baixar de novo à toa', () => {
  guardado.clear()
  const recusadas = [chaveDa(TENTATIVAS[0]), chaveDa(TENTATIVAS[1])]
  guardado.set('leitor.transcricao.recusadas', JSON.stringify(recusadas))

  const fila = tentativasDeHoje().map(chaveDa)
  for (const ruim of recusadas) assert.ok(!fila.includes(ruim), `${ruim} continuou na fila`)
  assert.equal(fila.length, TENTATIVAS.length - 2)
})

test('se tudo foi recusado, a fila volta inteira em vez de ficar vazia', () => {
  guardado.clear()
  guardado.set('leitor.transcricao.recusadas', JSON.stringify(TENTATIVAS.map(chaveDa)))
  assert.equal(tentativasDeHoje().length, TENTATIVAS.length)
})

test('armazenamento estragado não derruba a transcrição', () => {
  guardado.clear()
  guardado.set('leitor.transcricao.recusadas', 'isto não é json')
  guardado.set('leitor.transcricao.escolha', '{"nem":"isto"}')
  assert.equal(tentativasDeHoje().length, TENTATIVAS.length)
})
