FROM node:18-alpine

# Install Chromium for Puppeteer
RUN apk add --no-cache chromium nproc

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 7000

CMD ["node", "server.js"]