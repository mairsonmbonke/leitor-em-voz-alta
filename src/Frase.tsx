import { Fragment, memo, useMemo } from 'react'
import { dividirEmPalavras, type Trecho } from './lib/leitura'

interface FraseProps {
  trecho: Trecho
  /** Este é o trecho que está sendo falado agora. */
  ativa: boolean
  /** Início da palavra destacada, ou -1 quando não há. */
  destaque: number
}

/**
 * Uma frase do texto, palavra a palavra.
 *
 * Cada palavra carrega em `data-pos` a posição dela no texto original: é assim
 * que um clique vira um ponto de leitura. O componente é memoizado porque a
 * palavra destacada muda várias vezes por segundo e só a frase em leitura
 * precisa ser redesenhada.
 */
export const Frase = memo(function Frase({ trecho, ativa, destaque }: FraseProps) {
  const palavras = useMemo(() => dividirEmPalavras(trecho), [trecho])

  return (
    <span className={ativa ? 'frase frase--ativa' : 'frase'}>
      {palavras.map((palavra, ordem) => {
        const marcada = palavra.inicio === destaque
        return (
          <Fragment key={palavra.inicio}>
            {ordem > 0 ? ' ' : null}
            <span
              className={marcada ? 'palavra palavra--ativa' : 'palavra'}
              data-pos={palavra.inicio}
              data-ativa={marcada ? '1' : undefined}
            >
              {palavra.texto}
            </span>
          </Fragment>
        )
      })}
    </span>
  )
})
