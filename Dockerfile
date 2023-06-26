FROM node:16.17.0
WORKDIR /usr/src/app
COPY . ./
RUN npm install -g npm@latest
RUN npm ci --ignore-scripts
EXPOSE 5469
COPY .env.example .env
RUN npm run build
RUN apt-get install -y bash
CMD [ "npm", "run", "start" ]