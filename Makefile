.PHONY: buildx-setup build up down logs

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

BUILDER_NAME ?= urban-detector-builder

# One-time: create buildx builder with container driver (better layer cache)
buildx-setup:
	@docker buildx inspect $(BUILDER_NAME) >/dev/null 2>&1 || \
		docker buildx create --name $(BUILDER_NAME) --driver docker-container --use
	@docker buildx use $(BUILDER_NAME)
	@docker buildx inspect --bootstrap

# Fast parallel image build with local Buildx cache
build: buildx-setup
	docker buildx bake --load

up: build
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f
