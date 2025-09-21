FROM node:alpine

WORKDIR /app

# Install FFmpeg for server-side processing
RUN apk add --no-cache ffmpeg

COPY . .

RUN npm install

EXPOSE 3000

CMD ["npm", "run", "dev"]
