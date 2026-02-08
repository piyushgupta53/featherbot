---
name: skill-creator
description: "Create new skills for FeatherBot"
requires:
  bins: []
  env: []
always: false
---

# Skill Creator

You can help the user create new FeatherBot skills. A skill is a markdown instruction file that teaches you how to perform a specific task.

## Skill Structure

Each skill is a directory containing a `SKILL.md` file:

```
skills/
  my-skill/
    SKILL.md
```

## SKILL.md Format

Every SKILL.md has YAML frontmatter followed by markdown instructions:

```markdown
---
name: my-skill
description: "Short description of what this skill does"
requires:
  bins: []    # CLI binaries needed (e.g., ["gh", "docker"])
  env: []     # Environment variables needed (e.g., ["GITHUB_TOKEN"])
always: false # Set to true to always include in system prompt
---

# My Skill

Instructions for how to use this skill...
```

## Frontmatter Fields

- **name**: Unique skill identifier
- **description**: One-line summary shown in skill listings
- **requires.bins**: CLI tools that must be in PATH for the skill to work
- **requires.env**: Environment variables that must be set
- **always**: If true, the full skill content is included in every prompt. Use sparingly.

## Where to Save Skills

- **Workspace skills**: `{workspace}/skills/` — project-specific
- **User skills**: `~/.featherbot/skills/` — shared across all workspaces
- **Bundled skills**: `skills/` in the FeatherBot installation — shipped with the package

## Tips

- Keep skills focused on one domain or task
- Include concrete examples and command templates
- List all required tools in the `requires` section
- Use `always: false` unless the skill is needed on every turn
