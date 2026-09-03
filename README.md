# Claude Code 開発運用設定

全プロジェクト共通の Claude Code 設定の正本です。ルールは [CLAUDE.md](CLAUDE.md)、設定は [settings.json](settings.json) にあります。

## 方針

2026-09-03 に自作の scaffolding（goal フロー・dme・phase-* skill・deep-review・vendored Cloudflare skill）を全廃しました。セッションモデルを素で使い、計画・実装・レビューは通常の対話とツール呼び出しで行います。経緯は git 履歴に残っています。

## 構成

| パス | 説明 |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | 開発運用ルール正本。基本方針、停止条件、permission ポリシー、プロジェクト CLAUDE.md への要請。 |
| [settings.json](settings.json) | Claude Code の設定（model・permissions・plugins）。 |

## ブランチ運用

作業ブランチを切り、`main` への反映は PR 経由で行います。
