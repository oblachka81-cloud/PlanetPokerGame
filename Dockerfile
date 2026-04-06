FROM node:18-alpine

WORKDIR /app

# Копируем файлы с зависимостями
COPY package*.json ./

# Устанавливаем зависимости (используем npm install, не ci)
RUN npm install --only=production

# Копируем весь код
COPY . .

# Открываем порт для веб-приложения
EXPOSE 3000

# Запускаем бота
CMD ["node", "bot.js"]
