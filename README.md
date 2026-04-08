# mahjongsoul-data-overlay

![スクリーンショット](./2026-04-05.png)

動画リンク: <https://www.youtube.com/watch?v=Jx6_zLfGgQk>

雀魂の情報を取得して、OBSブラウザソースで使えるオーバーレイを表示するツールです。

主な機能:
- ランク/ポイントの表示
- 当日のポイント差分表示
- 対局結果の記録
- 翻数カウント
- OBS WebSocket 連携（リーチ演出のメディア再生）

## 必要環境
- Windows
- Google Chrome
- OBS（OBS連携を使う場合。OBS WebSocket を有効化）

## 使い方（単一EXE版）
1. Releases から `mahjongsoul-data-overlay-setup-<version>.exe` をダウンロード
2. インストールして `mahjongsoul-data-overlay` を起動
3. アプリ内で次の順に操作
`1. 雀魂起動` → `2. データ取得開始` → `3. OBS用HTMLフォルダを開く`
4. OBS のブラウザソースに `obs-rank.html` / `obs-points.html` / `obs-records.html` / `obs-han.html` を設定

## OBS連携
アプリの `OBS連携` タブで以下を設定できます。
- 連携の ON/OFF
- WebSocket URL
- パスワード
- リーチ時に再生するメディアソース名

## 開発用コマンド
```powershell
npm install
npm run electron:start
```

ビルド:
```powershell
npm run build:installer
```

`build:installer` 実行時に、`dist` は最新の EXE 1つだけ残るよう自動整理されます。
