---
impacto: nada_mudou
secao: corrigido
titulo: A restauração recusa backups corrompidos antes de alterar os dados
---
Ao restaurar um backup, o kit confere o arquivo do banco e os snapshots presentes das sessões do WhatsApp e dos anexos antes de escrever ou apagar dados. Arquivos cortados ou corrompidos interrompem a operação sem alterar os destinos. Se a extração falhar depois dessa conferência, o comando informa a falha e que o banco já foi restaurado, sem terminar como sucesso nem recomendar repetir sobre o banco populado. Crédito: @samirhvbr.
