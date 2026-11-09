# Preços do panfleto

Ferramenta para preencher os preços de um encarte em PDF e baixar o mesmo arquivo com os valores impressos.

O panfleto diário chega com os produtos desenhados na página e uma caixa **R$** em branco em cada item. O nome do produto não é texto selecionável. A ferramenta encontra essas caixas, deixa digitar o valor em cima do produto e grava o número no PDF original, sem remontar o encarte.

O arquivo não é enviado para nenhum servidor. A leitura, a digitação e a geração do PDF acontecem no navegador.

## Como usar

1. Abra o aplicativo e solte o PDF do dia.
2. Digite o preço de cada produto (`12,90` ou `1.250,00`). Enter vai para o próximo item.
3. Baixe o PDF. O arquivo sai com o nome original e o sufixo `-com-precos`.

No celular, cada produto aparece grande, um por vez, e o campo de preço fica fixo embaixo da tela. **Próximo** passa para o item seguinte. **Ver a página inteira** mostra o panfleto como no papel.

Se o navegador fechar no meio, o botão **Continuar de onde parou** reabre o mesmo arquivo com os preços já digitados. Um PDF novo, com outro tamanho ou outra data, começa em branco.

Quando uma caixa não for reconhecida, use **Marcar outra caixa** e clique no meio do campo de R$.

## Rodar localmente

```bash
npm install
npm run dev
```

O aplicativo sobe em [http://localhost:4179](http://localhost:4179).

A fonte Poppins Bold, usada para imprimir os preços, está em `public/fonts` sob a licença OFL.
