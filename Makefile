APP_NAME=wa-buzzerp
IMAGE_NAME=gushim/$(APP_NAME)
TAG=latest
PLATFORM=linux/amd64

.PHONY: build push build-push login pull run down logs

login:
	docker login

build:
	docker buildx build \
		--platform $(PLATFORM) \
		-t $(IMAGE_NAME):$(TAG) \
		--load \
		.

push:
	docker push $(IMAGE_NAME):$(TAG)

build-push:
	docker buildx build \
		--platform $(PLATFORM) \
		-t $(IMAGE_NAME):$(TAG) \
		--push \
		.

pull:
	docker pull $(IMAGE_NAME):$(TAG)

run:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f app