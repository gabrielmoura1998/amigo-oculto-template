# 🎁 Amigo Oculto: sorteio por intimidade

Um site de amigo oculto, feito pro celular, com uma regra diferente: **cada pessoa marca o quanto conhece cada participante** (muita, média ou nenhuma), e o sorteio só te dá alguém que tu conheces de verdade. Assim o presente acerta.

Roda **100% de graça**: GitHub Pages + Firebase (plano Spark) + GitHub Actions. Não precisa de cartão nem de servidor.

## O que tem
- **Login** com Google ou com e-mail e senha (com confirmação de e-mail). Só entra quem os admins liberarem.
- **Perfil** com tamanhos, o que a pessoa não curte e um recado pro amigo oculto.
- **Gostos:** até 5 de 15 categorias, com interesses específicos dentro de cada uma ("camisa do Homem-Aranha" ajuda mais que "roupa"). Nada vem pré-selecionado.
- **Intimidade:** cada um avalia todo mundo. As respostas são privadas, nem admin vê.
- **Sorteio em corrente única:** todo mundo entra numa roda só, cada pessoa tira alguém do próprio círculo, e "muita" intimidade pesa 3x mais que "média".
- **Sorteios de teste** públicos (com nomes e sem usar intimidade) e **um sorteio oficial** secreto que tranca tudo.
- **Auditoria anônima:** checagens automáticas e os pares por códigos aleatórios, pra conferir sem descobrir quem tirou quem.
- **Ordem de entrega:** no dia da festa os admins liberam o "tu és o nº X da corrente".
- Até **3 admins** e **20 participantes**. O oficial exige no mínimo **10 participantes**.

## Como funciona por baixo
| Parte | Onde roda |
|---|---|
| Site (`index.html`) | GitHub Pages |
| Login e banco | Firebase Authentication + Firestore (Spark, grátis) |
| Privacidade | `firestore.rules`: cada coleção só abre pra quem deve |
| Sorteio | `scripts/sorteio.js` no GitHub Actions, com uma chave de servidor guardada como secret |

O navegador nunca recebe o resultado completo: cada pessoa só consegue ler o próprio sorteio.

## Colocar no ar (uns 10 minutos)
1. Clica em **Use this template** e cria teu repo (público).
2. Cria um projeto em [console.firebase.google.com](https://console.firebase.google.com) e fica no plano Spark.
3. Abre o **Cloud Shell** do Google Cloud com esse projeto selecionado e roda:
   ```bash
   git clone https://github.com/SEU_USUARIO/SEU_REPO.git && cd SEU_REPO && bash setup.sh
   ```
   O script pergunta o ID do projeto e os e-mails dos admins. Pelo meio do caminho ele pede login no Firebase e no GitHub. Ele faz o seguinte:
   - cria o Firestore e publica as regras;
   - cria a configuração inicial;
   - configura o `index.html`;
   - gera a chave do sorteio e salva como secret do GitHub;
   - liga o GitHub Pages.
4. No console do Firebase, vai em **Authentication → Começar**:
   - ativa **Google** (escolhendo o e-mail de suporte) e **E-mail/senha**;
   - em **Configurações → Domínios autorizados**, adiciona `SEU_USUARIO.github.io`.
5. Abre `https://SEU_USUARIO.github.io/SEU_REPO/`, entra e libera a galera em **Admin → Liberar e-mail**.

## Sortear
Em **Actions → Sorteio → Run workflow**:
- `teste`: corrente pública, roda quantas vezes quiser (a partir de 3 pessoas);
- `oficial`: digita `OFICIAL` na confirmação. Roda uma vez só e tranca tudo;
- `liberar-numeros`: no dia da festa.

## Personalizar
No topo do script do `index.html`:
- `EVENTO`: nome da turma e ano;
- `CATS`: as 15 categorias e as sugestões de cada uma;
- `MIN_PARTICIPANTS`, `MIN_CIRCLE`, `MAX_USERS`, `MAX_CATS`: regras do jogo. Se mudar `MIN_PARTICIPANTS` ou `MIN_CIRCLE`, muda também em `scripts/sorteio.js`.

## Cuidados
- **Os logs do Actions são públicos em repo público.** Por isso o oficial só imprime as checagens.
- Quem é dono do projeto Firebase consegue abrir a coleção `results` no console. Isso vale pra qualquer backend: é questão de confiança. Se quiser, deixa o projeto com alguém que não participa.
- Depois da festa, apaga o secret `FIREBASE_SA` e revoga a chave em **IAM → Contas de serviço**.

### Resetar o oficial (só durante os testes)
```bash
P=SEU_PROJETO
for c in results positions audit private; do firebase firestore:delete "$c" --recursive --force --project $P; done
curl -s -X PATCH -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
  "https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents/config/app?updateMask.fieldPaths=finalLocked&updateMask.fieldPaths=orderOpen" \
  -d '{"fields":{"finalLocked":{"booleanValue":false},"orderOpen":{"booleanValue":false}}}'
```

## Coleções
- `config/app`: liberados, admins, trava do oficial
- `people/{uid}`: nome e se está pronto (todos veem)
- `users/{uid}`: perfil e gostos (dono, admins e quem tirou a pessoa)
- `intim/{uid}`: intimidade (só o dono)
- `tests/latest`: último teste (todos veem)
- `results/{uid}`, `positions/{uid}`: resultado e posição (só o dono)
- `audit/final`: auditoria por códigos (só admins)
- `private/order`: ordem da corrente (ninguém lê pelo site)
