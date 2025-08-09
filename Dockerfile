# Stage 1: Build the application using a lean Node.js image
FROM node:20-alpine AS builder

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if available) to leverage Docker layer caching
COPY package*.json ./

# Install only production dependencies using 'npm ci' for fast, reliable builds
# The --omit=dev flag ensures that development dependencies are not installed.
RUN npm ci --omit=dev

# Copy the rest of the application source code into the builder stage
COPY . .

# ---

# Stage 2: Create the final, minimal, and secure distroless image
FROM gcr.io/distroless/nodejs20-debian12

# Set the working directory in the final image
WORKDIR /app

# Copy application files with correct ownership from the builder stage.
# Using --chown=nonroot:nonroot ensures the 'nonroot' user can access these files,
# which is a critical security measure. The 'nonroot' user is provided by the base image.
COPY --from=builder --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /app/package.json ./package.json
COPY --from=builder --chown=nonroot:nonroot /app/index.js ./index.js
COPY --from=builder --chown=nonroot:nonroot /app/assets ./assets

# Switch to the non-root user for runtime.
# This is a critical security best practice to avoid running as root.
USER nonroot

# Expose the port the application listens on.
# This port must be greater than 1024 for a non-root user to bind to it.
EXPOSE 8293

# Define the command to run the application.
# The distroless nodejs image has an entrypoint set to "node", so we just need
# to provide the script name as the command.
CMD ["index.js"]
