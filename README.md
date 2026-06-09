# 🎬 FliixHub — Bot do Telegram

Bot oficial do FliixHub para buscar filmes e séries direto no Telegram.

---

## ✨ O que o bot faz

- 🔍 Busca filmes e séries por nome (texto livre)
- 🔥 Lista os mais populares
- 🆕 Mostra as últimas novidades
- 🎭 Filtra por gênero (Ação, Terror, Comédia, etc.)
- 📸 Envia pôster + avaliação + descrição + link para assistir
- 📲 Link direto para baixar o app

---

## 🚀 Como configurar

### 1. Criar o bot no Telegram

1. Abre o Telegram e procura por **@BotFather**
2. Manda `/newbot`
3. Escolhe um nome: ex. `FliixHub`
4. Escolhe um username: ex. `fliixhub_bot`
5. Copia o **token** que ele te dá

---

### 2. Configurar os comandos no BotFather

Manda pro @BotFather:
```
/setcommands
```
Escolhe o teu bot e cola isso:
```
start - Início
help - Como usar
buscar - Buscar conteúdo ex: /buscar Breaking Bad
filme - Buscar filme ex: /filme Inception
serie - Buscar série ex: /serie Friends
populares - Ver os mais populares
novidades - Ver últimas novidades
genero - Filtrar por gênero ex: /genero ação
site - Acessar o FliixHub
download - Baixar o app
```

---

### 3. Instalar e rodar

```bash
# Clonar / copiar os arquivos
cd fliixhub-telegram-bot

# Instalar dependências
npm install

# Criar o arquivo .env
cp .env.example .env

# Editar o .env e colocar o token do bot
nano .env

# Rodar
npm start
```

---

## 🖥️ Hospedar no VPS (Hetzner)

```bash
# Copiar os arquivos pro VPS
scp -r fliixhub-telegram-bot/ root@SEU_IP:/root/

# Acessar o VPS
ssh root@SEU_IP

# Entrar na pasta
cd fliixhub-telegram-bot

# Instalar dependências
npm install

# Criar .env
cp .env.example .env
nano .env  # colocar o token

# Rodar em background com PM2
npm install -g pm2
pm2 start index.js --name fliixhub-bot
pm2 save
pm2 startup
```

O bot fica rodando para sempre, reinicia sozinho se cair. ✅

---

## ☁️ Hospedar no Fly.io (gratuito)

```bash
# Instalar Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Criar app
fly launch --name fliixhub-bot --no-deploy

# Setar variáveis
fly secrets set TELEGRAM_TOKEN=seu_token_aqui
fly secrets set WEBHOOK_URL=https://fliixhub-bot.fly.dev/webhook

# Deploy
fly deploy
```

---

## 📱 Como usar o bot

| Comando | O que faz |
|---|---|
| `/start` | Abre o menu principal |
| `/buscar Breaking Bad` | Busca qualquer conteúdo |
| `/filme Inception` | Busca só filmes |
| `/serie Friends` | Busca só séries |
| `/populares` | Top filmes e séries |
| `/novidades` | Últimos adicionados |
| `/genero ação` | Filtra por gênero |
| `/site` | Link do FliixHub |
| `/download` | Link para baixar o app |
| Qualquer texto | Busca automática |

---

## 🔧 Estrutura dos arquivos

```
fliixhub-telegram-bot/
├── index.js        # Bot completo
├── package.json    # Dependências
├── .env.example    # Modelo de variáveis
└── README.md       # Este arquivo
```
