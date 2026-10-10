---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the guidelines from `guidelines.md` in this folder (local copy — see below)
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the fetched guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

**Menuzia (10/10/2026):** the rules live in `guidelines.md` next to this file — a reviewed snapshot of
`vercel-labs/web-interface-guidelines` (main, 10/10/2026). Do NOT fetch them from the internet: remote instructions
could change without review. To update, download, read and replace the file on purpose.

The project rules in CLAUDE.md win over these guidelines (Menuzia visual kit, Inter/Montserrat/Figtree, radius,
pt-BR copy — ignore "Title Case" and English copy rules; zoom is disabled on purpose in /loja and /motoboy).

## Usage

When a user provides a file or pattern argument:
1. Read `guidelines.md` (local)
2. Read the specified files
3. Apply all rules from the fetched guidelines
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
