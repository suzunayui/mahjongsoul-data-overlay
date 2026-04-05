# mahjongsoul-data-overlay

[![YouTube demo](https://img.youtube.com/vi/Jx6_zLfGgQk/maxresdefault.jpg)](https://www.youtube.com/watch?v=Jx6_zLfGgQk)

動画リンク: <https://www.youtube.com/watch?v=Jx6_zLfGgQk>

ブラウザ版の雀魂からランク情報や対局中の点数を読み取り、OBS のブラウザソースで表示するためのツールです。
 
配布版は GitHub Releases からダウンロードしてください。

- ダウンロード先: <https://github.com/suzunayui/mahjongsoul-data-overlay/releases/tag/mahjongsoul-data-overlay-20260405>

## できること

- 四麻 / 三麻の段位と段位ポイント表示
- その日の開始時点からのポイント増減表示
- 対局中の点数表示
- 対局結果の記録
- 自分の `1位-2位-3位-4位` 回数表示

## 使い方

### 必要なもの

- Windows
- Google Chrome

### 手順

1. GitHub Releases から配布ファイルをダウンロードします
2. 展開したフォルダの中にある `mahjongsoul-launch.exe` を起動します  
   初回だけログイン操作が必要ですが、セッションが残っていれば 2 回目以降は自動ログインします
3. 開いた Chrome で雀魂を使います
4. `mahjongsoul-collect.exe` を起動します
5. `html` フォルダが開くので、`obs-rank.html` と `obs-points.html` と `obs-records.html` を OBS にドラッグ&ドロップします

注意:

- `mahjongsoul-collect.exe` は配布フォルダごとそのまま使ってください
- `overlay` フォルダも必要です
- `html` フォルダも必要です
- `launch.exe` を先に起動してから `collect.exe` を起動してください

## 保存されるデータ

配布版では、保存先は実行ファイルと同じフォルダ配下です。

- `points`
- `records`

主なファイル:

- `YYYY-MM-DD-start.json`
  その日の開始時点の段位・段位ポイント
- `YYYY-MM-DD-latest-change.json`
  その日の最新の段位・段位ポイント変動
- `match-latest.json`
  対局中 / 終局時の最新状態
- `YYYY-MM-DD.txt`
  終局結果の履歴
- `summary.json`
  自分の順位回数集計

## 開発用

コードを修正したり、配布用 exe を再ビルドしたい場合だけ `Node.js` が必要です。

### セットアップ

```powershell
npm.cmd install
```

### 開発用実行

```powershell
npm.cmd run mjs:launch
npm.cmd run mjs:collect
```

### exe のビルド

```powershell
npm.cmd run build:exe
```

個別ビルド:

```powershell
npm.cmd run build:exe:launch
npm.cmd run build:exe:collect
```

## 補足

- このツールは、起動中のブラウザがすでに持っている表示データを読み取る方式です
- 雀魂サーバーに対して独自の API を追加で叩くことはしていません
- ログイン状態は `.playwright-profile` に保存されます
- セッションが切れた場合は、再度手動ログインが必要です
