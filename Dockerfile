# Use Node.js LTS as the base image
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy tsconfig
COPY tsconfig.json ./

# Create src directory and copy source code
RUN mkdir -p ./src
COPY src ./src/

# Build the application
RUN npm run build

# Clean up dev dependencies to reduce image size
RUN npm prune --production

# Command to run the bot
CMD ["node", "dist/index.js"]
