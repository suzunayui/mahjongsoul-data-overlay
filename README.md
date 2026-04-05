# mahjongsoul-data-overlay

動画リンク: <https://www.youtube.com/watch?v=Jx6_zLfGgQk>

雀魂の表示データを読み取って、OBS のブラウザソースで使えるオーバーレイを表示するツールです。

- 四麻 / 三麻のランクとポイント表示
- その日のポイント増減表示
- 対局中の点数表示
- 対局結果の記録
- 自分の `1位-2位-3位-4位` 回数表示
- 飜数合計表示

## できること

- ランク / ポイントの取得と表示
- 対局中の点数表示
- 順位履歴の記録
- 順位集計の表示
- 飜数合計の表示

## 必要なもの

- Windows
- Google Chrome

## 使い方

1. [GitHub Releases](https://github.com/suzunayui/mahjongsoul-data-overlay/releases/tag/mahjongsoul-data-overlay-20260405) から配布ファイルをダウンロードします
2. `mahjongsoul-launch-setup-2026.4.5.exe` を実行してインストールします
3. `mahjongsoul-collect-setup-2026.4.5.exe` を実行してインストールします
4. `mahjongsoul-launch` を起動します
   初回だけログイン操作が必要ですが、セッションが残っていれば 2 回目以降は自動ログインします
5. 開いた Chrome で雀魂を使います
6. `mahjongsoul-collect` を起動します
7. `OBS用フォルダを開く` ボタンを押します
8. 開いたフォルダの `obs-rank.html` と `obs-points.html` と `obs-records.html` を OBS にドラッグ&ドロップします

## 保存されるデータ

このツールでは、記録用ファイルをユーザーデータフォルダ内に保存します。

主な保存内容:

- `points`
  - `YYYY-MM-DD-start.json`
  - `YYYY-MM-DD-latest-change.json`
- `records`
  - `match-latest.json`
  - `YYYY-MM-DD.txt`
  - `summary.json`
  - `han-summary.json`

## 開発用

コードを修正したり、インストーラーをビルドしたい場合だけ `Node.js` が必要です。

### セットアップ

```powershell
npm.cmd install
```

### 開発時の起動

```powershell
npm.cmd run mjs:launch
npm.cmd run mjs:collect
```

### インストーラーのビルド

```powershell
npm.cmd run build:installer
```

## 注意

- このツールは、起動中のブラウザがすでに持っている表示データを読み取る方式です
- サーバーに対して独自の API を追加送信するものではありません
- ログイン状態は `.playwright-profile` に保存されます
