FROM node:alpine

WORKDIR /app

COPY . .

RUN npm install

EXPOSE 3000

# Run in development mode to avoid build issues with missing API credentials
CMD ["npm", "run", "dev"]
