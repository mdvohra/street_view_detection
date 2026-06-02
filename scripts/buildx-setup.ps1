# Create and bootstrap a Docker Buildx builder (run once per machine)
$ErrorActionPreference = "Stop"
$BuilderName = "urban-detector-builder"

$exists = docker buildx inspect $BuilderName 2>$null
if (-not $exists) {
  docker buildx create --name $BuilderName --driver docker-container --use
} else {
  docker buildx use $BuilderName
}
docker buildx inspect --bootstrap
Write-Host "Buildx builder '$BuilderName' is ready."
