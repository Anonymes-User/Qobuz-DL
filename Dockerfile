FROM node:alpine

# Install required packages
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Create downloads directory and set permissions
RUN mkdir -p /downloads && chmod 755 /downloads
# Set default download path
ENV QOBUZ_DOWNLOAD_PATH="/downloads"

# Copy package files and configuration files needed for build
COPY package*.json ./
COPY postcss.config.mjs ./
COPY tailwind.config.ts ./
COPY next.config.ts ./
COPY tsconfig.json ./

RUN npm install

COPY . .

# Set default environment variables for build
ENV NEXT_PUBLIC_APPLICATION_NAME="Qobuz-DL"
ENV NEXT_PUBLIC_BASE_URL="http://localhost:3000"

EXPOSE 3000

# Run in development mode to avoid build issues with missing API credentials
CMD ["npm", "run", "dev"]
