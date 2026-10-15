---
impacto: nada_mudou
secao: corrigido
titulo: Credencial do Google Agenda e do app da Meta gravada no /admin passa a valer na hora
---

Ao gravar a credencial do Google Agenda ou do app da Meta pela tela de administração, uma leitura que já estava em andamento podia trazer de volta o valor anterior e mantê-lo por até 30 segundos: o aviso de salvo aparecia, mas a Agenda não conectava ou a entrega da Meta falhava nesse intervalo. A leitura em andamento agora não reinstala o valor antigo. Contribuição de @webtecnica (#2905).
