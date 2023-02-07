FROM node:16
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5469
COPY .env.example .env
RUN npm run build
CMD [ "npm", "run", "start" ]