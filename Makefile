.PHONY: all web server test dev clean

all: web server

web:
	cd web && npm ci && npm run build
	rm -rf server/web/dist && mkdir -p server/web/dist && cp -r web/dist/. server/web/dist/ && touch server/web/dist/.gitkeep

server:
	cd server && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../bin/lumen ./cmd/lumen

test:
	cd server && go vet ./... && go test ./...
	cd web && npx tsc -b --noEmit

# Run the API with insecure dev login (no Pocket ID needed) and the Vite dev server.
dev:
	cd server && LUMEN_DEV_INSECURE_LOGIN=true LUMEN_CONFIG_DIR=../.dev/config LUMEN_TRANSCODE_DIR=../.dev/transcode LUMEN_LISTEN=127.0.0.1:8096 go run ./cmd/lumen & \
	cd web && npm run dev

clean:
	rm -rf bin web/dist .dev
	find server/web/dist -mindepth 1 ! -name .gitkeep -delete
