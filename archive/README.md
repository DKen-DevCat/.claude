# archive/ — 退役した資産（正本ではない・実行しない）

codex 全廃（v5 = Claude 一本化）に伴い退役。履歴保全のため残すが、フロー正本ではない。

- `goal-commands/exec-v3.md` — 旧 `/goal:exec`(v3)。codex(gpt-5.5) に実装委譲。codex 消滅で非機能。
- `goal-commands/exec-v4.md` — 旧 `/goal:exec-v4`。v4 制御＋codex 実装。codex 消滅で非機能。
- `../hooks/archive/codex-exec-guard.sh` — codex exec の wall-clock 有界化 hook。守る codex が無く退役。

現行 exec は `commands/goal/exec-v5.md`（唯一の exec 正本）。フロー正本は `~/.claude/CLAUDE.md`。
