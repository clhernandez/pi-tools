---
name: simplify
description: Use after writing or modifying code to simplify and refine it for clarity, consistency, and maintainability without changing functionality. Triggers after any implementation work in the current session.
---

# Code Simplifier

## Overview

Review recently modified code and apply refinements that improve clarity, consistency, and maintainability — without altering behavior. Readable and explicit code over clever or compact code.

## Process

1. Identify code sections modified or written in the current session
2. Analyze for simplification opportunities
3. Apply project-specific best practices from CLAUDE.md
4. Verify all functionality remains unchanged
5. Document only significant changes that affect understanding

## Rules

**Always preserve:**
- Every feature, output, and behavior — never change what code does, only how
- Helpful abstractions that improve organization
- Debuggability and extensibility

**Improve by:**
- Reducing unnecessary complexity and nesting
- Eliminating redundant code and dead abstractions
- Improving variable and function naming for clarity
- Consolidating related logic
- Removing comments that describe obvious code

**Avoid:**
- Nested ternary operators → prefer `match`/`switch` or `if/else` chains
- Over-clever one-liners that sacrifice readability
- Combining too many concerns into one function
- Optimizing for fewer lines over clarity

## Scope

Only refine code touched in the current session unless explicitly asked to review a broader scope.

## Balance

Simplification is not minimization. Explicit code is often better than compact code. Never sacrifice clarity for brevity.
