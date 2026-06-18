# Conventions

<!-- TODO: AI — observe codebase patterns and fill in. Humans — document team agreements. -->

## Naming

<!-- TODO: Naming conventions for files, variables, functions, classes, types.
     Example:
     - Files: kebab-case (user-service.ts)
     - Variables/functions: camelCase
     - Types/interfaces: PascalCase
     - React components: PascalCase, filename matches component name
     - Test files: {filename}.test.ts co-located with source
-->

## File Organization

<!-- TODO: Rules for where files go.
     Example:
     - One component per file
     - Barrel exports (index.ts) for directories with 3+ exports
     - Types co-located with the code that uses them
     - Feature folders for related components/hooks/utils
-->

## Error Handling

<!-- TODO: How errors are propagated, logged, and displayed.
     Example:
     - API errors return { error: string, code: number } shape
     - Never swallow errors silently
     - User-facing errors are friendly; developer errors are detailed
     - Use structured logging with context (request ID, user ID, timestamp)
-->

## Logging

<!-- TODO: Logging conventions.
     Example:
     - Use project's logger (never console.log in production)
     - Log levels: DEBUG (dev only), INFO (key events), WARN (recoverable), ERROR (needs attention)
     - Include correlation IDs for request tracing
     - No PII or secrets in logs
-->

## Git Practices

<!-- TODO: Branch naming, commit message format, PR process.
     Example:
     - Branch: feature/description, fix/description, chore/description
     - Commit: conventional commits (feat:, fix:, chore:, docs:)
     - Squash merge to main
     - PRs need at least one review
-->

## Code Style

<!-- TODO: Style rules not enforced by linters/formatters.
     Example:
     - Prefer early returns over nested if-else
     - Max function length: 40 lines
     - Prefer named exports over default exports
     - Async/await over raw promises
-->
