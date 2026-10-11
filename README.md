# Contador de Dominó

Tire uma foto das suas peças de dominó e o app diz quantos pontos você fez.

Roda 100% no navegador (inclusive no celular): nada é enviado para servidor
nenhum e não precisa de chave de API.

## Como usar

1. Abra o app no celular e toque em **🎥 Câmera ao vivo**: o total vai sendo
   atualizado enquanto você enquadra as peças. Quando estabilizar, toque em
   **📸 Congelar** para conferir. (Ou use **📷 Foto** / **Galeria**.)
2. Mire nas peças **de cima**, bem iluminadas e sem se sobreporem. Fundo liso e
   sem reflexos ajuda bastante.
3. O total aparece em destaque, cada ponto detectado fica circulado em vermelho
   e cada peça identificada ganha uma etiqueta com o valor das metades (ex.: `6|3`).
4. Errou algum? **Toque** num círculo para removê-lo, ou num ponto esquecido para
   adicioná-lo (fica circulado em amarelo).
5. Escolha o **Tipo de dominó** (duplo-6, duplo-9 ou duplo-12): uma metade
   nunca passa desse máximo. Se estiver detectando de menos/demais, ajuste a
   **Sensibilidade**. Para peças
   escuras com pontos brancos, marque **Pontos claros em peça escura**.
6. **Somar ao placar** guarda o resultado da rodada (fica salvo no aparelho).

## Como funciona

`detector.js` faz a contagem com visão computacional simples, sem bibliotecas:

1. converte a foto usando o menor canal de cor, para que pontos coloridos
   (amarelo, rosa, verde…) contrastem com a peça branca tanto quanto os pretos;
2. limiarização adaptativa (cada pixel comparado com a média da vizinhança),
   o que lida bem com sombras e iluminação desigual;
3. rotula as manchas (componentes conexos);
4. mantém só as manchas redondas ou elípticas (fotos de lado), o que descarta
   a linha divisória da peça, bordas e textura da mesa;
5. exige que o ponto seja bem mais escuro que a superfície logo ao redor;
6. manchas alongadas (pontos encostados) são reprocessadas com limiar mais
   rígido até se separarem;
7. mantém só manchas do tamanho típico dos pontos;
8. acha as **linhas divisórias** (retas, finas, escuras, com a mesma superfície
   dos dois lados) e monta cada peça a partir delas. A orientação de cada peça
   é corrigida pela nuvem de pontos dela (fotos em perspectiva), e pontos
   colados à peça entram nela;
9. pontos fora de qualquer peça só contam se forem bem nítidos — isso elimina
   manchas no fundo. Sem nenhuma peça identificada, vale a regra de que pontos
   andam em grupo.

## Rodando localmente

```bash
npm start   # serve em http://localhost:8080
npm test    # testes do detector com imagens sintéticas
```

A câmera do celular exige HTTPS, então para usar no telefone publique no
GitHub Pages (abaixo) ou outro host estático.

## Publicando no GitHub Pages

O workflow `.github/workflows/pages.yml` roda os testes e publica o app no
branch `gh-pages` a cada push na `main`. Depois do primeiro deploy, em
**Settings → Pages** escolha **Deploy from a branch → `gh-pages` / `(root)`**.
O app fica em https://sschonss.github.io/domino-counter/ e pode ser adicionado
à tela inicial do celular.
