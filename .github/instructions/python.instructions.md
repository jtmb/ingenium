---
description: "Use when working with Python files. Covers type hints, docstrings, formatting, testing, and project structure conventions."
applyTo: "**/*.py"
---

# Python Conventions

## Build & Test Commands

- **Test**: `pytest` (with `-v` for verbose, `-x` to stop on first failure)
- **Lint & format**: `ruff check . && ruff format --check .`
- **Type check**: `mypy .` (strict mode where practical)
- **Run**: `python -m {module}` or project-configured entry point

## Type Hints — Required

Every function signature and public method MUST have type annotations. Use `mypy` to validate.

```python
# Good
def calculate_total(items: list[Item], tax_rate: float = 0.08) -> float:
    ...

# Bad — no type hints
def calculate_total(items, tax_rate=0.08):
    ...
```

- Use `|` for unions (Python 3.10+): `str | None` instead of `Optional[str]`
- Use built-in generics: `list[User]` instead of `List[User]`
- Use `typing.Protocol` for structural subtyping
- Use `typing.TypedDict` for typed dictionaries

## Docstrings — Mandatory

Use **Google-style** docstrings for all public functions, classes, and methods.

```python
def connect(host: str, port: int, timeout: float = 30.0) -> Connection:
    """Open a connection to the target host.

    Args:
        host: The hostname or IP address to connect to.
        port: The TCP port number.
        timeout: Connection timeout in seconds. Defaults to 30.

    Returns:
        An authenticated Connection object.

    Raises:
        ConnectionError: If the host is unreachable or authentication fails.
        ValueError: If port is not in range 1-65535.
    """
```

- Describe **why**, not just **what**
- Always document raised exceptions
- Keep up to date — stale docstrings are worse than none

## Project Structure

```
project/
├── src/                    # Source code
│   ├── __init__.py
│   ├── main.py             # Entry point
│   ├── models/             # Data models
│   ├── services/           # Business logic
│   └── utils/              # Shared utilities
├── tests/                  # Test suite
│   ├── __init__.py
│   ├── conftest.py         # Shared fixtures
│   └── test_*.py           # Test modules
├── pyproject.toml          # Project config & dependencies
└── README.md
```

- Use `src/` layout (not flat) for proper import isolation
- Every package needs `__init__.py`
- Use `pyproject.toml` for all configuration (setuptools, ruff, mypy, pytest)

## Testing

- Use `pytest` with descriptive test names: `test_when_input_is_empty_returns_default`
- Prefer fixtures over setup/teardown methods
- Use `pytest.mark.parametrize` for table-driven tests
- Mock external services; don't hit real APIs in unit tests
- Aim for one assertion per test where practical

## Code Quality

- Run `ruff` for linting and formatting — it replaces `black`, `isort`, `flake8`, and more
- No commented-out code in commits
- Use `pathlib` instead of `os.path`
- Use f-strings, not `.format()` or `%` formatting
- Prefer `dataclasses` or `Pydantic` models over plain dicts

## Imports

- Standard library first, then third-party, then local — each group separated by a blank line
- No wildcard imports (`from module import *`)
- No circular imports — restructure if you encounter them
