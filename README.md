# mahjongsoul-data-overlay

![スクリーンショット](./2026-04-05.png)

動画リンク: <https://www.youtube.com/watch?v=Jx6_zLfGgQk>

雀魂の対局データを収集して、OBS のブラウザソースで使えるオーバーレイを表示するツールです。

できること

- ランク / ポイントの表示
- その日のポイント増減表示
- 対局中の翻数表示
- 対局ごとの記録
- 自分の `1位 / 2位 / 3位 / 4位` の回数表示
- OBS 用 HTML の出力
- OBS WebSocket 連携
- 自分がリーチした瞬間に OBS のメディアソースを再生

## 動作環境

- Windows
- Google Chrome
- OBS を使う場合は OBS WebSocket が有効な OBS

## 使い方

1. [GitHub Releases](https://github.com/suzunayui/mahjongsoul-data-overlay/releases/tag/mahjongsoul-data-overlay-20260405) からファイルをダウンロードします
2. `mahjongsoul-launch-setup-2026.4.5.exe` をインストールします
3. `mahjongsoul-collect-setup-2026.4.5.exe` をインストールします
4. `mahjongsoul-launch` を起動します
5. 開いた Chrome で雀魂を開きます
6. `mahjongsoul-collect` を起動します
7. `OBS 用 HTML フォルダを開く` からフォルダを開きます
8. `obs-rank.html`、`obs-points.html`、`obs-records.html` などを OBS のブラウザソースとして追加します

## OBS 連携

`mahjongsoul-collect` の `OBS連携` タブから設定できます。

- `リーチ演出を使う` を ON にすると OBS 連携が有効になります
- `WebSocket URL` と `パスワード` を設定して OBS に接続できます
- `ソース一覧を取得` で OBS に登録済みの入力ソース一覧を読み込めます
- `メディアソース名` に再生したいメディアソースを設定すると、自分がリーチした瞬間にそのソースを再生し直します
- 設定は保存されるので、次回起動時は自動で OBS に再接続します

OBS 側では、リーチ演出用の動画や音付き演出をメディアソースとして用意しておくと使いやすいです。

## 保存されるデータ

このツールでは、記録用のファイルをユーザーデータフォルダに保存します。

主な保存先

- `points`
  - `YYYY-MM-DD-start.json`
  - `YYYY-MM-DD-latest-change.json`
- `records`
  - `match-latest.json`
  - `YYYY-MM-DD.txt`
  - `summary.json`
  - `han-summary.json`
  - `riichi-events.json`
- `output`
  - `match-debug-latest.json`

## 開発用

セットアップ

```powershell
npm.cmd install
```

起動

```powershell
npm.cmd run electron:start:launch
npm.cmd run electron:start:collect
```

ビルド

```powershell
npm.cmd run build:installer
```

## 注意

- このツールは、起動中のブラウザの状態をもとに表示データを読み取る方式です
- サーバーに対して独自の API を追加で送るものではありません
- ログイン状態は `.playwright-profile` などの作業用データに保存されます
