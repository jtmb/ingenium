---
name: go-conventions
description: "Go conventions — gofmt, golangci-lint, error wrapping, table-driven tests, concurrency, context, project structure. Use when editing **/*.go files."
---

# Go Conventions

## When to Use

Invoke this skill when writing or editing Go files (`**/*.go`). It covers project structure, error handling, testing, concurrency, and standard tooling.

## Standard Go Tool Chain

These are standard across all Go projects. Default commands unless project docs say otherwise:

- **Build:** `go build ./...`
- **Test:** `go test ./...`
- **Lint:** `golangci-lint run`
- **Vet:** `go vet ./...`
- **Format:** `gofmt -w .` (run before committing)
- **Full check:**
  ```bash
  gofmt -w . && go vet ./... && golangci-lint run && go test ./...
  ```
- **Dependency audit:** `govulncheck ./...`

## Project Structure

```
project/
├── cmd/              # One directory per binary
│   └── server/
│       └── main.go
├── internal/         # Private application code (not importable externally)
│   ├── handler/
│   ├── service/
│   └── store/
├── pkg/              # Shared library code (importable externally)
├── api/              # Protobuf/OpenAPI spec files
├── migrations/       # SQL migration files
├── go.mod
├── go.sum
└── Makefile
```

- **Standard Go project layout** unless the project already uses a different convention. Adapt to what exists.
- **`cmd/`**: one subdirectory per binary, each with a minimal `main.go` that calls into `internal/`.
- **`internal/`**: prevents external packages from importing these. Use for application-specific logic.
- **`pkg/`**: shared utilities that other projects could import. Don't dump everything here — most code belongs in `internal/`.
- **No `src/` or `lib/` directories** — those are not Go conventions.

## Naming

- **PascalCase for exported** (`UserService`, `GetByID`)
- **camelCase for unexported** (`userService`, `getByID`)
- **Keep names short in limited scope.** `i` for loop index, `db` for database handle. The further the scope, the longer and more descriptive the name.
- **Package names:** single lowercase word, no underscores. `userservice`, not `user-service` or `userService`. `httputil`, not `http_util`.
- **No `Get` prefix for getters** unless the operation is complex. `user.Name()` not `user.GetName()`. Reserve `Get` for network/DB calls.
- **Interface naming:** single-method interfaces use `-er` suffix (`Reader`, `Writer`, `Closer`). Multi-method interfaces describe what they do (`UserStore`, `EventBus`).

## Error Handling

Always handle errors. Never ignore them.

```go
// Always check the error
result, err := doSomething()
if err != nil {
    return fmt.Errorf("doing something: %w", err)
}

// Only use panic for truly unrecoverable states (invariant violations)
// Use errors.Is and errors.As for error inspection
if errors.Is(err, ErrNotFound) {
    // Handle not found
}
```

- **Wrap errors with `fmt.Errorf("context: %w", err)`** to preserve the chain.
- **Use `errors.Is` and `errors.As`** for error inspection — never string matching.
- **Define sentinel errors** for known failure modes:

```go
var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("conflict")
```

- **Error messages are lowercase, no trailing punctuation.** `"user not found"` not `"User not found."`.
- **Don't log and return an error — do one or the other.** Logging + returning produces duplicate noise.

## Testing — Table-Driven

Write table-driven tests for functions with multiple input/output cases.

```go
func TestAdd(t *testing.T) {
    tests := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive numbers", 1, 2, 3},
        {"negative numbers", -1, -2, -3},
        {"zero sum", 5, -5, 0},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Add(tt.a, tt.b)
            if got != tt.expected {
                t.Errorf("Add(%d, %d) = %d; want %d", tt.a, tt.b, got, tt.expected)
            }
        })
    }
}
```

- **Test file naming:** `foo_test.go` next to `foo.go` (same package for white-box, `_test` suffix package for black-box).
- **Use `testify` for assertions and mocks** if the project already uses it. Otherwise, prefer standard library `testing`.
- **Parallel tests:** `t.Parallel()` for independent tests. Run with `go test -race ./...`.
- **Run race detector in CI:** `go test -race ./...`. Data races are bugs.

## Concurrency

```go
// Always pass context as first argument
func (s *Service) Process(ctx context.Context, id string) error {
    // Use context for cancellation and deadlines
    ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
    defer cancel()

    // Channels: prefer buffered when size is known
    results := make(chan Result, 10)

    // Use sync.WaitGroup for goroutine coordination
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        // ...
    }()
    wg.Wait()
}
```

- **`context.Context` is always the first parameter.**
- **Don't start a goroutine without knowing how it will stop** — use context cancellation or a done channel.
- **Use `sync.WaitGroup`** for goroutine coordination.
- **Prefer channels over mutexes** for communication. "Don't communicate by sharing memory; share memory by communicating."
- **`defer` for cleanup:** close files, release locks, cancel contexts.
- **Run tests with `-race`** to catch data races.

## Dependency Management

- **Use Go modules:** `go mod tidy` to clean up `go.mod`.
- **Pin versions:** commit `go.sum`. Never add it to `.gitignore`.
- **Audit dependencies:** `govulncheck ./...` in CI. Don't introduce packages with known vulnerabilities.
