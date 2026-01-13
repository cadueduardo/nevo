# nevo-prepare-commit

Prepare changes for a potential commit.
Steps:
1) Summarize all changes in plain language.
2) List all modified/created/deleted files.
3) Explain how the changes respect:
   - multi-tenant isolation
   - security rules
   - Nevo MVP scope
4) Ask the user explicitly if the commit is authorized.

Do NOT commit.
Wait for explicit user confirmation.

This command will be available in chat with /nevo-prepare-commit
