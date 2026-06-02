# Fast build using Docker Buildx + local cache
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$env:DOCKER_BUILDKIT = "1"
$env:COMPOSE_DOCKER_CLI_BUILD = "1"

& "$PSScriptRoot\buildx-setup.ps1"
docker buildx bake --load
Write-Host "Images built. Run: docker compose up -d"
