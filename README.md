# Cidadania em Jogo

## O que é

Aplicativo mobile de quizzes para apoiar a educação para a cidadania por meio de gamificação. Foi pensado para complementar atividades educativas da CLDF.

O público previsto são estudantes e jovens. O app não muda as perguntas por faixa etária.

## O que o app faz

- Reúne 74 perguntas em quatro temas: Parlamento, Democracia, Direitos e CLDF.
- Oferece trilhas, prática mista e um desafio diário de cinco perguntas.
- Embaralha alternativas e explica cada resposta.
- Guarda perguntas, registra partidas e mostra XP e progresso.
- Permite revisar erros e ajustar o tamanho do texto em todas as telas.

Os dados ficam salvos no aparelho ou navegador. O app não tem conta de usuário, sincronização nem painel administrativo.

## Tecnologias

- React Native e Expo SDK 57. O lockfile fixa Expo 57.0.31.
- Javascript
- SQLite local, por meio de `expo-sqlite`.
- Node.js 22.13 ou superior.

## Instalar e abrir no Android

### 1. Instale as ferramentas

1. Instale o [Node.js](https://nodejs.org/en/download/).
2. Instale o [Android Studio](https://developer.android.com/studio/install). No assistente, escolha **Standard** e instale o Android SDK e o Android Emulator.
3. No Android Studio, abra **More Actions > Virtual Device Manager > Create virtual device**. Escolha um Pixel, baixe uma imagem do Android e clique em **Finish**. Depois, aperte **Play** para iniciar o emulador.

### 2. Prepare o projeto

1. Extraia `Cidadania_em_Jogo_atualizado.zip`.
2. Abra o PowerShell na pasta `Cidadania em Jogo`, onde está o arquivo `package.json`.
3. Na primeira vez, instale as dependências:

```powershell
npm install
```

### 3. Rode o app

1. Instale no emulador o [Expo Go compatível com SDK 57](https://expo.dev/go). A versão do Expo Go precisa corresponder à versão do projeto.
2. No PowerShell, rode:

```powershell
npx expo start
```

3. Quando o servidor iniciar, pressione **a** no terminal. O app abrirá no emulador.
4. Para encerrar, pressione **Ctrl+C** no terminal.
