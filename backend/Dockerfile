FROM node:20-alpine

RUN apk add --no-cache ffmpeg python3 py3-pip && \
    pip3 install --no-cache-dir --break-system-packages -U yt-dlp

WORKDIR /app
COPY package.json .
RUN npm install

EXPOSE 3001
CMD ["node", "--watch", "server.js"]
