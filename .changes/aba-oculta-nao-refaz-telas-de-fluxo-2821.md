---
impacto: nada_mudou
secao: corrigido
titulo: Preparar extensão e parear conexão não consultam mais o servidor com a aba escondida
---

Enquanto uma extensão está em preparo, a tela de Extensões relia a lista inteira a cada 3 segundos. Enquanto uma conexão está sendo pareada, o diálogo de pareamento consultava o status da sessão no mesmo ritmo. As duas consultas seguiam com a aba do navegador escondida, quando ninguém está olhando. Agora as duas pulam o ciclo de 3 segundos enquanto a aba está oculta e voltam a consultar no ciclo seguinte, em até 3 segundos, quando a aba fica visível de novo. Com a aba visível, nada muda. A renovação da imagem do QR Code, a cada 15 segundos, não ganhou essa pausa.

Contribuição de @webtecnica (#2906), continuando o #2821 de @Tong-bit-art.
