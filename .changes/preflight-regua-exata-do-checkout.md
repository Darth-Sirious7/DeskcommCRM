---
impacto: nada_mudou
secao: corrigido
titulo: A conferência antes da atualização passa a recusar exatamente o que a troca de versão recusaria
---

A conferência inicial da atualização, que recusa antes do backup quando há
alteração local no caminho da versão nova, ainda divergia da troca de versão em
três casos: recusava à toa quando um arquivo do kit tinha sido apagado na
instalação, ou quando a alteração já estava preparada e deixava o arquivo igual
ao da versão nova; e deixava passar arquivo fora do controle de versão que a
versão nova traz, que seguia parando a atualização depois do backup. Agora ela
pergunta ao próprio git, com a mesma régua da troca de versão, e a mensagem
nomeia todos os arquivos de uma vez, separando os alterados (guardar ou desfazer)
dos que estão fora do controle de versão (mover ou apagar). A tela também deixa
de repetir "nada foi parado" duas vezes.

Você não precisa fazer nada.

Conserto sobre a contribuição de @webtecnica (#2932).
