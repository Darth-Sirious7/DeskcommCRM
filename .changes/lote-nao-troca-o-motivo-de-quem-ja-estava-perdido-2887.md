---
impacto: nada_mudou
secao: corrigido
titulo: Perder negócios em lote não troca mais o motivo de quem já estava perdido
---

Ao mover vários negócios de uma vez para uma etapa de perda com um motivo, o
motivo era gravado em todos os negócios selecionados, inclusive nos que já
estavam perdidos, e o motivo original deles era trocado sem nenhum registro.
Agora só os negócios perdidos nesse lote recebem o motivo; os que já estavam
perdidos são movidos e mantêm o motivo que tinham. Os que já estavam perdidos
deixam de aparecer no histórico como se tivessem sido perdidos de novo com o
motivo do lote, e cada negócio perdido no lote passa a ter um registro próprio
na auditoria, como acontece ao perder um negócio pelo card. A atualização
aplica a mudança de banco sozinha.

Contribuição de @webtecnica (#2922), a partir da issue #2887.
