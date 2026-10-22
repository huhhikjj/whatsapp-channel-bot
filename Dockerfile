FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package definition
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose web dashboard ports (7860 for Hugging Face, 3000 for standard)
EXPOSE 7860
EXPOSE 3000

# Environment variable default (7860 is standard for free cloud spaces)
ENV PORT=7860
ENV NODE_ENV=production

# Start the bot
CMD ["npm", "start"]
