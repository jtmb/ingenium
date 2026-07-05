---
name: refactoring-recipes
description: "Catalog of refactoring patterns with explicit before/after examples — extract method, invert conditional, replace magic number, and more. Use when improving code structure, reducing complexity, or cleaning up legacy code."
---

# Refactoring Recipes

## When to Use

- A function is too long or does too many things
- A conditional is nested too deeply to read
- A magic number or string appears without explanation
- Boolean logic is confusing or duplicated
- Code has dead branches or unreachable lines
- Preparing to add a feature to messy code — clean it first

## 🔴 HARD RULE — One Recipe Per Change

Each refactoring commit should apply exactly one recipe pattern. Mixing patterns (e.g., extracting a method while inlining a temp) makes reviews impossible and breaks `git bisect`. Commit after each recipe.

## Recipe Catalog

### Extract Method

**When**: A block of code can be grouped into a single-purpose unit with a clear name.

```python
# ❌ BEFORE — inline logic with no structure
def process_order(order):
    total = 0
    for item in order["items"]:
        total += item["price"] * item["quantity"]
    if total > 100:
        total *= 0.9
    order["total"] = total
    return order

# ✅ AFTER — extracted method with intent-revealing name
def process_order(order):
    order["total"] = calculate_total(order["items"])
    return order

def calculate_total(items):
    subtotal = sum(item["price"] * item["quantity"] for item in items)
    return apply_volume_discount(subtotal)

def apply_volume_discount(amount):
    return amount * 0.9 if amount > 100 else amount
```

### Invert Conditional

**When**: A negative conditional makes the logic harder to follow than the positive form.

```typescript
// ❌ BEFORE — negated condition buries the happy path
if (!user.isBlocked) {
  if (!user.hasExpiredToken) {
    grantAccess(user);
  } else {
    refreshToken(user);
  }
} else {
  showBlockedMessage(user);
}

// ✅ AFTER — positive condition, early return for guard
if (user.isBlocked) {
  showBlockedMessage(user);
  return;
}
if (user.hasExpiredToken) {
  refreshToken(user);
  return;
}
grantAccess(user);
```

### Replace Magic Number With Constant

**When**: A literal number appears without explanation.

```python
# ❌ BAD
def should_retry(attempts):
    return attempts < 5

# ✅ GOOD
MAX_RETRY_ATTEMPTS = 5

def should_retry(attempts):
    return attempts < MAX_RETRY_ATTEMPTS
```

### Simplify Boolean Expression

**When**: A boolean expression contains double negation, redundant comparisons, or over-nesting.

```javascript
// ❌ BAD
if (!(isValid === false) && !(user == null)) { ... }

// ✅ GOOD
if (isValid && user) { ... }
```

### Early Return (Guard Clause)

**When**: An outer `if` wraps the entire function body for the happy path.

```go
// ❌ BAD — happy path in a nested block
func Process(data []byte) error {
    if len(data) > 0 {
        if err := validate(data); err == nil {
            result, err := transform(data)
            if err == nil {
                return save(result)
            }
            return err
        }
        return errors.New("invalid data")
    }
    return errors.New("empty data")
}

// ✅ GOOD — guards first, happy path flat
func Process(data []byte) error {
    if len(data) == 0 {
        return errors.New("empty data")
    }
    if err := validate(data); err != nil {
        return fmt.Errorf("invalid data: %w", err)
    }
    result, err := transform(data)
    if err != nil {
        return fmt.Errorf("transform: %w", err)
    }
    return save(result)
}
```

### Decompose Conditional

**When**: A complex `if/else` chain contains opaque logic in each branch.

```typescript
// ❌ BAD
if (new Date() > new Date(contract.endDate) && !contract.autoRenew) {
  // ... 20 lines
} else if (new Date() > new Date(contract.endDate) && contract.autoRenew) {
  // ... 20 lines
} else {
  // ... 10 lines
}

// ✅ GOOD
const isExpired = new Date() > new Date(contract.endDate);
if (isExpired && !contract.autoRenew) {
  handleExpiredNoAutoRenew(contract);
} else if (isExpired && contract.autoRenew) {
  handleAutoRenew(contract);
} else {
  handleActiveContract(contract);
}
```

### Remove Dead Code

**When**: A variable, function, import, or branch is never used.

```python
def calculate_shipping(items):
    TAX_RATE = 0.08        # ❌ DEAD — declared but never referenced
    base = sum(i.weight for i in items)
    # DISCOUNT logic was removed in previous refactor
    # if base > 100:    # ❌ DEAD — commented-out code
    #     base *= 0.9
    return base * 1.5
```

Keep dead code removal in its own commit — it's noise in a functional change.

### Inline Temp

**When**: A temporary variable exists only to hold the result of an expression used once.

```python
# ❌ BAD — unnecessary temp
total_price = order.calculate_total()
return total_price * TAX_MULTIPLIER

# ✅ GOOD — inline the expression
return order.calculate_total() * TAX_MULTIPLIER
```

### Split Loop

**When**: A single loop does two unrelated things, making it harder to change either.

```javascript
// ❌ BAD — loop with two responsibilities
let total = 0;
let richest = null;
for (const user of users) {
  total += user.balance;
  if (!richest || user.balance > richest.balance) richest = user;
}

// ✅ GOOD — two focused loops (can be optimized later if needed)
let total = users.reduce((sum, u) => sum + u.balance, 0);
let richest = users.reduce((best, u) => !best || u.balance > best.balance ? u : best, null);
```

### Slide Statements

**When**: Related code is scattered with unrelated code in between.

```python
# ❌ BAD — related things interleaved
name = extract_name(form)
age = extract_age(form)
address = extract_address(form)
log_audit("form_processed", form.id)
validate_name(name)
validate_address(address)
validate_age(age)

# ✅ GOOD — related things grouped
name = extract_name(form)
validate_name(name)
age = extract_age(form)
validate_age(age)
address = extract_address(form)
validate_address(address)
log_audit("form_processed", form.id)
```

## Model Notes

- **7B-9B models**: These recipes work best as pattern-matching templates. When you see a structural problem, narrate through the recipes: "This matches the 'Extract Method' pattern. Here is the before block and the after block." Show the full context, not just a diff — smaller models lose track with partial views.
- **14B-27B models**: Can chain 2-3 recipes across a file. Recommend working top-down (outer structure first, then inner details). These models also benefit from being asked "Which recipe applies here?" rather than being told outright.
- **All local models**: The ❌BEFORE/✅AFTER pair format is critical. Smaller models learn from the contrast, not from a description of the change. Always show both sides.
- **One-recipe-per-change rule**: Especially important for local models. Multiple changes in one request produce incoherent code. Force yourself to commit after each recipe application.
