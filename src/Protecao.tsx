import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Rede de segurança da tela.
 *
 * A tradução automática do navegador troca os nós de texto por conta própria;
 * quando o React vai atualizar a tela, não encontra mais os nós que criou e
 * derruba tudo — a página fica preta. A página já pede para o navegador não
 * traduzir (`translate="no"` e a meta `notranslate`), mas se alguém insistir,
 * é melhor uma explicação do que uma tela vazia.
 */
interface Estado {
  quebrou: boolean
  porTraducao: boolean
}

/** A falha tem cara de tradução do navegador mexendo no documento? */
function pareceTraducaoDoNavegador(erro: Error): boolean {
  const texto = `${erro.name} ${erro.message}`
  return /removeChild|insertBefore|NotFoundError|not a child of this node/i.test(texto)
}

export class Protecao extends Component<{ children: ReactNode }, Estado> {
  state: Estado = { quebrou: false, porTraducao: false }

  static getDerivedStateFromError(erro: Error): Estado {
    return { quebrou: true, porTraducao: pareceTraducaoDoNavegador(erro) }
  }

  componentDidCatch(erro: Error, info: ErrorInfo): void {
    console.error('A tela caiu:', erro, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.quebrou) return this.props.children

    return (
      <div className="socorro">
        <div className="socorro__cartao">
          <h1 className="socorro__titulo">A página precisa ser recarregada</h1>
          {this.state.porTraducao ? (
            <p className="socorro__texto">
              Isto costuma acontecer quando a <strong>tradução automática do navegador</strong> é ligada nesta página.
              Ela reescreve a tela por fora e o programa se perde.
              <br />
              <br />
              Desligue a tradução do navegador e use o botão <strong>Traduzir</strong> do próprio programa: ele traduz o
              texto que você está lendo, mantendo o original ao lado.
            </p>
          ) : (
            <p className="socorro__texto">
              Alguma coisa deu errado na tela. Seu texto continua salvo no navegador e volta ao recarregar.
            </p>
          )}
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Recarregar a página
          </button>
        </div>
      </div>
    )
  }
}
