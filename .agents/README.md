# .agents/

Project agent context organized per the [dotagents](https://github.com/bgreenwell/dotagents)
standard. The root `AGENTS.md` is a slim router — load files here only when needed.

```
.agents/
├── context/     # Static reference (read-only)
├── rules/       # Behavioral guidelines
├── memory/      # Persistent project knowledge
├── logs/        # Session audit trails
└── skills/      # Domain how-tos (agentskills.io format)
```

Personal preferences may go in `memory/user.md` (gitignored if added).
