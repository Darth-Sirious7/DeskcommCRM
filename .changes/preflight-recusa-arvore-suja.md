---
impacto: nada_mudou
secao: corrigido
titulo: A atualização deixa de parar depois do backup quando há alteração local em arquivo do kit
---

Atualizar pelo botão da tela (ou pelo `update.sh`) numa instalação que tem
alteração local não commitada em arquivo que a versão nova troca passava pela
conferência inicial, fazia o backup inteiro e só então parava no `git checkout`,
com uma mensagem que não dizia quais arquivos eram nem o que fazer com eles.
Agora a conferência inicial recusa antes de tocar em qualquer coisa, nomeia os
arquivos e ensina a guardar ou desfazer o que é local. Alteração local em arquivo
que a versão nova não troca continua não atrapalhando nada.

Você não precisa fazer nada.

Contribuição de @webtecnica (#2932).
