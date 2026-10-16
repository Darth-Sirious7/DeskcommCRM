---
impacto: nada_mudou
secao: corrigido
titulo: Na linha do tempo do contato, o que aconteceu hoje aparece sob "Hoje"
---

Na aba Timeline da ficha do contato, o cabeçalho de cada dia saía um dia atrasado para quem está a oeste de UTC, como em todo o Brasil: o que aconteceu hoje aparecia sob "Ontem", e o de ontem saía com a data de anteontem. O agrupamento dos itens por dia já estava certo. O erro era só na hora de montar a data do cabeçalho, lida como meia-noite UTC. Agora o cabeçalho segue o fuso de quem está olhando. Nenhuma configuração nova, nenhum passo manual.

Contribuição de @webtecnica (#2944), a partir da issue #2934.
