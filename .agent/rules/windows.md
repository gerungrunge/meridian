# Windows Shell Usage Rules

## Command Separators
- **NEVER** use `&&` for sequential commands. This is a bash/linux-only operator.
- **ALWAYS** use `;` (semicolon) to separate sequential commands in Windows PowerShell.
  - Correct: `git add .; git commit -m "fix"; git push`
  - Incorrect: `git add . && git commit -m "fix" && git push`

## Path Handling
- Prefer `\` (backslash) for local file paths in commands, though many tools handle `/` (forward slash).
- Use `\` when interacting with Windows native commands (e.g., `mkdir`, `dir`).

## Environment Variables
- When setting environment variables temporarily for a command, use `$env:VARNAME="value"; command` instead of `VARNAME=value command`.

## General
- The user is working in a Microsoft Windows environment using PowerShell. Always ensure your proposed commands are compatible with this shell.
