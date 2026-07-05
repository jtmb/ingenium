---
name: python-conventions
description: "Python conventions — type hints, Google docstrings, pytest, ruff, mypy, secure coding. Use when writing or editing **/*.py files."
---

# Python Conventions

## When to Use

Invoke this skill when writing or editing Python files (`**/*.py`). It covers type safety, testing, linting, error handling, naming, and security.

## Pre-Work Checklist

Before writing any Python code:

1. **Check Python version.** Run `python --version`. Target 3.10+ unless the project constrains to something older.
2. **Check existing tooling.** Look for `pyproject.toml`, `setup.cfg`, `ruff.toml`, `.python-version`. Use them.
3. **Activate virtual environment.** `source .venv/bin/activate` (Linux/macOS) or `.venv\Scripts\activate` (Windows). If no venv, `python -m venv .venv`.
4. **Run existing tests.** `pytest` or `python -m pytest`. Know what's green before you start.

## Build & Test Commands

Ask for the project's build commands if not obvious. Default fallbacks:

- **Lint:** `ruff check .`
- **Format:** `ruff format .` (run after linting)
- **Type check:** `mypy src/` (or `mypy .` in simpler projects)
- **Test:** `pytest` (or `python -m pytest`)
- **Full check (in order):** `ruff check . && ruff format --check . && mypy src/ && pytest`

## Type Hints — Mandatory

Every function must have complete type annotations.

```python
# Bad — no types, returns None on error
def get_user(user_id):
    ...

# Good — complete types, explicit return
def get_user(user_id: int) -> User | None:
    """Return the user with the given ID, or None if not found."""
    ...

# Good — using Optional for clarity
from typing import Optional

def find_by_email(email: str) -> Optional[User]:
    ...
```

- **Use the latest syntax available in the project's Python version.** Python 3.10: `X | None` over `Optional[X]`, `list[X]` over `List[X]`.
- **Annotate all public functions/methods** with complete types (args + return).
- **Internal helpers** should be annotated too — it catches bugs and documents intent.
- **Never use `Any`** unless at a genuine API boundary with external untyped code. Prefer `object` or a `Protocol`.

## Docstrings — Google Style

Every function, class, module, and non-obvious block must have a Google-style docstring.

```python
def transfer_funds(
    from_account: AccountId,
    to_account: AccountId,
    amount: Decimal
) -> TransferResult:
    """Transfer funds between two accounts atomically.

    Both accounts must be active and belong to the same currency.
    The transfer is atomic — either both accounts are updated or
    neither is.

    Args:
        from_account: The account to debit.
        to_account: The account to credit.
        amount: The amount to transfer in the accounts' currency.

    Returns:
        TransferResult with the new balances and transaction ID.

    Raises:
        InsufficientFundsError: If from_account has insufficient balance.
        AccountFrozenError: If either account is frozen.
    """
    ...
```

- **Classes:** Document purpose, attributes, and invariants in the class docstring.
- **Modules:** A brief `"""Provides X, Y, Z."""` at the top.
- **Keep comments current.** Stale comments are worse than no comments — update them when logic changes.

## Testing — pytest

```python
# tests/test_user_service.py
import pytest
from user_service import UserService, UserNotFoundError

@pytest.fixture
def service():
    """Fixture providing a UserService with a test database."""
    svc = UserService(database_url="sqlite:///:memory:")
    svc.migrate()
    return svc

def test_get_user_returns_user(service):
    """get_user returns the user when it exists."""
    user = service.get_user(1)
    assert user.name == "Test User"

def test_get_user_raises_when_not_found(service):
    """get_user raises UserNotFoundError for nonexistent IDs."""
    with pytest.raises(UserNotFoundError):
        service.get_user(99999)
```

- **Use `pytest` unless the project uses `unittest`.** Fixtures, parametrization, markers.
- **One test file per source file** (or one test file per module).
- **Test filename:** `test_*.py` in `tests/` directory. Pytest discovers these.
- **Test function names must describe what they test.** `test_get_user_raises_when_not_found` not `test_error`.
- **Arrange-Act-Assert pattern** and meaningful error messages.

## Linting & Formatting — ruff

`ruff` is the single tool for both linting and formatting. No flake8, isort, or black needed.

- Run `ruff check .` before committing. Fix every issue.
- Run `ruff format .` to auto-format.
- Check `pyproject.toml` for project-specific ruff configuration.
- CI runs `ruff check . && ruff format --check .`. A failure here blocks merge.

## Type Checking — mypy

- Run `mypy src/` after ruff passes. Type errors block merge.
- `mypy` config lives in `pyproject.toml` under `[tool.mypy]`.
- Use `--strict` for new projects. For existing projects, match the project's level of strictness.

## File Organization

- **Package structure:** `src/` layout (`src/package_name/`) for libraries and larger projects. Flat `package_name/` for small apps.
- **`__init__.py` files are for re-exporting the public API,** not for logic.
- **One class per file (usually).** Small helper classes co-located with their primary class.
- **`constants.py`** for module-level constants.
- **`exceptions.py`** for custom exception classes, co-located in the relevant package.

## Naming Conventions

- **PascalCase:** `UserService`, `ValidationError`. No acronyms: `HttpClient` not `HTTPClient`.
- **snake_case:** `get_user_by_id`, `is_active`, `MAX_RETRIES`.
- **No single-letter variables** except `i`/`j` for loop indices and `x`/`y` for coordinates.
- **No abbreviations.** `config` not `cfg`, `response` not `resp`.
- **Private members:** single leading underscore `_internal_method`.
- **Constants:** UPPER_CASE at module level.

## Error Handling

```python
class ValidationError(AppError):
    """Raised when input validation fails."""

def process_payment(amount: Decimal) -> PaymentResult:
    if amount <= 0:
        raise ValidationError(f"Amount must be positive, got {amount}")
    ...

# Catch specific exceptions, not bare except:
try:
    result = process_payment(amount)
except ValidationError as e:
    logger.warning("Payment rejected", extra={"error": str(e)})
    raise  # Re-raise if caller can't handle it
```

- **Never `except:` or `except Exception`** without re-raising.
- **Raise specific exception types,** not `ValueError` for everything.
- **Wrap external errors** with context: `raise DatabaseError(...) from e`.
- **Use `logging` module** — never `print()` in production code.

## Django / Flask / FastAPI Addenda

- **Django:** Class-Based Views for CRUD, Function-Based for custom logic
- **FastAPI:** Pydantic models for request/response, dependency injection for shared logic
- **Flask:** Blueprints for modularity, application factory pattern

## Secure Coding

- **No secrets in code.** Use `os.environ` or `python-dotenv` for config.
- **Validate all input.** API handlers, CLI arguments, file uploads — sanitize before processing.
- **SQL: parameterized queries only.** No string interpolation.
- **Never `eval()` or `exec()` on user input.**
- **Hash passwords:** `bcrypt` or `argon2`, never MD5/SHA1.
