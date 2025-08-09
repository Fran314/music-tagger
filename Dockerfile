# Define build arguments for user and group IDs with default values.
# These can be overridden during the build process.
ARG UID=1000
ARG GID=1000

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

# Copy application files from the builder stage with ownership set to the specified UID/GID.
# This ensures the final user process has the correct permissions for these files.
COPY --from=builder --chown=$UID:$GID /app/node_modules ./node_modules
COPY --from=builder --chown=$UID:$GID /app/package.json ./package.json
COPY --from=builder --chown=$UID:$GID /app/index.js ./index.js
COPY --from=builder --chown=$UID:$GID /app/assets ./assets

# Switch the runtime user to the specified numeric UID.
# There is no corresponding username in /etc/passwd, but the process will run
# with the correct user ID, matching the file permissions.
USER $UID

# Expose the port the application listens on.
EXPOSE 8293

# Define the command to run the application.
# The distroless nodejs image has an entrypoint set to "node", so we just need
# to provide the script name as the command.
CMD ["index.js"]
