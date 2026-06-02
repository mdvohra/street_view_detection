// Build with: docker buildx bake --load
// Requires: make buildx-setup  (or scripts/buildx-setup.ps1)

group "default" {
  targets = ["backend", "frontend"]
}

target "_common" {
  platforms = ["linux/amd64"]
}

target "backend" {
  inherits = ["_common"]
  context    = "backend"
  dockerfile = "Dockerfile"
  tags       = ["urban-detector-backend:latest"]
  cache-from = ["type=local,src=.buildx-cache/backend"]
  cache-to   = ["type=local,dest=.buildx-cache/backend,mode=max"]
}

target "frontend" {
  inherits = ["_common"]
  context    = "frontend"
  dockerfile = "Dockerfile"
  tags       = ["urban-detector-frontend:latest"]
  cache-from = ["type=local,src=.buildx-cache/frontend"]
  cache-to   = ["type=local,dest=.buildx-cache/frontend,mode=max"]
}
