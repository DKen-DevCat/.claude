このファイルは全プロジェクト共通の「開発運用ルール正本」であり、ルールの変更はここを唯一の反映点とする。各プロジェクト固有事項（ドメイン不変量・技術スタック・ディレクトリ責務・参照資料）は各リポジトリの CLAUDE.md に置く。

## 基本方針

セッションモデル（`settings.json` の `model`。現行 `claude-fable-5-1[1m]`。`/model` 明示切替時はそれ）を素で使う。計画・実装・レビューは通常の対話とツール呼び出しで行い、レビューは組み込みの `/code-review`・`/security-review` を使う。

2026-09-03 に自作の scaffolding を全廃した: 自動開発フロー（`/goal:plan`・`/goal:exec-v5`・dme・調査/検証 Workflow）、フェーズ運用 skill（phase-*）、多観点レビュー skill（`/deep-review`）、vendored Cloudflare skill（plugin に一本化）。理由は「Fable 5.1 を素で使う方が、補助を挟むより賢い」という判断。同種の計画テンプレート・実装委譲・手順 skill・構造判断 skill は再導入しない。

## 停止条件

goal や要件に影響する想定外が出たら、勝手に進めず、ユーザへ選択肢を提示して停止する。

破壊的・外向き操作は事前確認する。例: PR 作成、ブランチ削除、外部サービスへの変更反映、ネットワークを伴う依存追加。

**permission ポリシー**: worktree 操作は全許可。**git 履歴改変（`reset --hard`・`branch -D`・force push・rebase・`commit --amend`）は一律禁止**。merge は許可するが、Claude が自律 merge してよいのは「並列作業の集約時」と「人間が明示的に PR番号 のマージを指示した時」のみ。**作業完了 → main への統合は必ず PR 経由**（main へ直接 merge しない）。rollback は `reset --hard` を使わず、失敗 worktree は `git worktree remove`＋必要なら `git revert`（履歴を改変しない）で戻す。これらは `settings.json` の deny でも多層に担保する。

## プロジェクト CLAUDE.md への要請

各プロジェクトの CLAUDE.md は、冒頭付近で「開発運用ルールは本グローバル `~/.claude/CLAUDE.md` を正本とする」旨のポインタを張る。プロジェクト固有の CLAUDE.md は、ルール本体を再定義せず、固有の制約・責務・参照資料だけを保持する。旧フローの `## Skills config` ブロックや `/goal:*`・`/phase-*`・dme への参照が残っていれば、その PJ を触る時に外す。
