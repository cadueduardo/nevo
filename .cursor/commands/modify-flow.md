# modify-flow

Modify an existing Nevo flow definition.
Return changes ONLY as a PATCH (diff operations).
Do NOT rewrite the entire flow.
Validate that the resulting flow:
- has a valid start and end
- has no orphan nodes
- respects required variables

This command will be available in chat with /modify-flow
