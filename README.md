# <img src="./assets/icon.svg" width="24px" height="24px"> Music Tagger

A lightweight web UI for editing ID3 tags on music files.

This tool is designed for a simple workflow: process tracks from an `input`
directory, edit their metadata, and save them with a standardized filename to an
`output` directory. It is ideal for curating a music library with consistent and
accurate tags.

## Features

- **Interactive Tag Editing:** Modify title, artist, genre, BPM, and comments.
- **Input/Output Workflow:** Moves files from a dedicated 'input' folder to an
  'output' folder upon saving.
- **Standardized Filenames:** Automatically renames files to a clean
  `Artist - Title.mp3` format.
- **Built-in Metronome:** Assists in accurately finding and setting the Beats
  Per Minute (BPM).
- **Instant Search:** Quickly filter both input and output lists to find
  specific tracks.
- **Secure and Containerized:** Runs as a minimal, secure, distroless Docker
  container.

## Usage

This software can be run either with Docker, Podman or natively with Node.js.

### Method 1: Docker Compose (Recommended)

This is the simplest way to run the application.

First, create a `./build/` directory and clone this repository inside it:

```bash
git clone https://github.com/Fran314/music-tagger.git ./build/.
```

Use the following `compose.yaml` as a template. It should be placed in the
directory containing your `build/`, `input/`, and `output/` folders.

```yaml
# compose.yaml
services:
    music-tagger:
        build: ./build
        container_name: music-tagger
        restart: unless-stopped
        ports:
            - '8293:8293'
        environment:
            - PORT=8293
            - INPUT_DIR=/app/input
            - OUTPUT_DIR=/app/output
        volumes:
            - ./input:/app/input
            - ./output:/app/output
```

From the project's root directory, build and run the container:

```bash
docker compose up --build -d
```

### Method 2: Podman

You can also use native Podman commands to build and run the application.

First, create a `./build/` directory and clone this repository inside it:

```bash
git clone https://github.com/Fran314/music-tagger.git ./build/.
```

Then:

1.  **Build the image:**

    ```bash
    podman build -t music-tagger ./build
    ```

2.  **Run the container:**
    ```bash
    podman run --rm -d \
      --name music-tagger \
      -p 8293:8293 \
      --env PORT=8293 \
      --env INPUT_DIR=/app/input \
      --env OUTPUT_DIR=/app/output \
      -v ./input:/app/input:Z \
      -v ./output:/app/output:Z \
      music-tagger
    ```
    _Note: The `:Z` flag on the volume mounts is necessary for proper
    permissions on SELinux-enabled systems._

### Method 3: Node.js

Of course you can also just clone the repo, install the dependencies and run it
as is.

```bash
git clone https://github.com/Fran314/music-tagger.git .
npm install
PORT=[YOUR_PORT] INPUT_DIR="path/to/input" OUTPUT_DIR="path/to/output" npm start
```
