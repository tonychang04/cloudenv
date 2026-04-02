# CLAUDE.md

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

### Available skills

- `/office-hours` - YC office hours mode
- `/plan-ceo-review` - CEO/founder plan review
- `/plan-eng-review` - Eng manager plan review
- `/plan-design-review` - Designer plan review
- `/design-consultation` - Design system consultation
- `/design-shotgun` - Design shotgun
- `/design-html` - Design HTML generation
- `/review` - Pre-landing PR review
- `/ship` - Ship workflow (PR creation)
- `/land-and-deploy` - Land and deploy workflow
- `/canary` - Post-deploy canary monitoring
- `/benchmark` - Performance benchmarking
- `/browse` - Headless browser for web browsing
- `/connect-chrome` - Connect to Chrome browser
- `/qa` - QA testing with auto-fix
- `/qa-only` - QA testing (report only)
- `/design-review` - Visual design QA review
- `/setup-browser-cookies` - Import browser cookies
- `/setup-deploy` - Configure deploy settings
- `/retro` - Weekly engineering retrospective
- `/investigate` - Systematic debugging
- `/document-release` - Post-ship docs update
- `/codex` - OpenAI Codex CLI wrapper
- `/cso` - Chief Security Officer audit
- `/autoplan` - Auto-review pipeline
- `/careful` - Safety guardrails for destructive commands
- `/freeze` - Restrict edits to a directory
- `/guard` - Full safety mode (careful + freeze)
- `/unfreeze` - Clear freeze boundary
- `/gstack-upgrade` - Upgrade gstack
- `/learn` - Learn from context

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
