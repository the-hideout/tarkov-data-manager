run:
	@echo "\033[0;34m[#] Killing old docker processes\033[0m"
	docker-compose down -v -t 1

	@echo "\033[0;34m[#] Building docker containers\033[0m"
	docker-compose up --build -d

	@echo "\033[0;34m[#] Containers are now running!\033[0m"

stop:
	@echo "\033[0;34m[#] Killing old docker processes\033[0m"

	docker compose down -t 1

	@echo "\033[0;34m[#] Containers are now stopped!\033[0m"
