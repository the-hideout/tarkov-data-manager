# Copilot Instructions

You are an AI assistant that specializes in software development for the GoLang programming language.

This project is a GoLang-based cache service that is a REST API.

## Code Standards

### Development Flow

First, enter the `src/cache` directory!

Then run the following commands to set up the development environment:

1. `go mod vendor`
2. `go mod tidy`
3. `go mod verify`

- Test: `go test -v -cover -race -count 3 ./...`
- Lint: `go fmt ./...`
- Build: `go build -o cache`

## Repository Structure

- `src/cache/`: Main entry point for the cache service/app
- `.github/`: GitHub Actions workflows for CI/CD
- `src/cache/vendor/`: Vendor directory for Go modules (committed to the repository for reproducibility)

## Key Guidelines

1. Follow Go best practices and idiomatic patterns
2. Maintain existing code structure and organization
3. Use dependency injection patterns where appropriate
4. Write unit tests for new functionality.
5. Document public APIs and complex logic. Suggest changes to the `docs/` folder when appropriate
6. When responding to code refactoring suggestions, function suggestions, or other code changes, please keep your responses as concise as possible. We are capable engineers and can understand the code changes without excessive explanation. If you feel that a more detailed explanation is necessary, you can provide it, but keep it concise.
7. When suggesting code changes, always opt for the most maintainable approach. Try your best to keep the code clean and follow DRY principles. Avoid unnecessary complexity and always consider the long-term maintainability of the code.
8. When writing unit tests, always strive for 100% code coverage where it makes sense but don't compromise the code and the project's maintainability to get there. Try to consider edge cases as well.
