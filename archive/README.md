# archive/ — 退役した資産（正本ではない・実行しない）

codex 全廃（v5 = Claude 一本化）に伴い退役。履歴保全のため残すが、フロー正本ではない。

- `goal-commands/exec-v3.md` — 旧 `/goal:exec`(v3)。codex(gpt-5.5) に実装委譲。codex 消滅で非機能。
- `goal-commands/exec-v4.md` — 旧 `/goal:exec-v4`。v4 制御＋codex 実装。codex 消滅で非機能。
- `../hooks/archive/codex-exec-guard.sh` — codex exec の wall-clock 有界化 hook。守る codex が無く退役。

現行 exec は `commands/goal/exec-v5.md`（唯一の exec 正本）。フロー正本は `~/.claude/CLAUDE.md`。

## viz（goalflow-viz）の退役【2026-07-02・viz 撤廃決定】

タスク DAG ライブ可視化（goalflow-viz）は撤廃決定。`commands/goal/exec-v5.md` から viz 向けの seam 結線（§1 tasks.json canonical-id 優先経路・§8 viz bullet）を除去し、実装者サマリ出力先を `.codex-out/<id>.md` → `.goalflow/out/<id>.md` に改称した。

**要フォローアップ（main 側で削除）**: `skills/goalflow-viz/`（`fuse.mjs` が `.codex-out/<id>.md` と `docs/plans/<slug>.tasks.json` を直読み）と `docs/viz/SCHEMA.md` は origin/main に実在するが本ブランチ（feat/deep-review-skill）には無い。viz 撤廃に伴い、**main への統合時に `skills/goalflow-viz/` と `docs/viz/SCHEMA.md` を `git rm` すること**（放置すると旧 seam `.codex-out`/tasks.json を読む死んだ tooling が main に残る）。この改名が viz 観測契約を壊す点は dogfood deep-review が HIGH 検出済で、撤廃決定に沿った意図的破壊である。
