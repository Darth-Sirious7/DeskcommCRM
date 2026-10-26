---
impacto: nada_mudou
secao: corrigido
titulo: CNPJ com dígito verificador errado deixa de ser aceito no cadastro de empresa
---

O cadastro de empresa conferia apenas o tamanho do CNPJ: quatorze dígitos e máscara correta bastavam, mesmo com o dígito verificador errado. Um número como `11.222.333/0001-00` entrava como empresa legítima — e, como o CNPJ normalizado é único por organização, o registro ficava ocupado por um documento que não existe: o cliente real recebia "CNPJ já cadastrado" ao tentar se cadastrar, e a causa só aparecia depois, no enriquecimento pela BrasilAPI.

Agora o CNPJ passa pela mesma régua que a cobrança já usa no documento do pagador: o módulo 11 da Receita, que confere os dois dígitos verificadores e recusa sequência repetida. Quem digita certo não vê diferença; quem digita errado recebe "CNPJ inválido" no ato, em vez de descobrir dias depois.

Nada muda para os cadastros que já existem: nenhuma empresa é tocada e nenhuma coluna mudou. O CNPJ alfanumérico da Receita continua recusado por enquanto — a coluna do banco exige quatorze dígitos e aceitá-lo pede migration própria.

Contribuição de @webtecnica (#3497).
