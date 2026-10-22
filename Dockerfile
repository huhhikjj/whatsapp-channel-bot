FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package definition
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose web dashboard port
EXPOSE 3000

# Environment variable default
ENV PORT=3000
ENV NODE_ENV=production

# Start the bot
CMD ["npm", "start"]
