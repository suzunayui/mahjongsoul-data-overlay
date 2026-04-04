# mahjongsoul-data-overlay

ブラウザ版の雀魂からランク情報と対局中の点数を読み取り、OBS のブラウザソースで表示するためのツールです。

今は `exe` だけで実行できます。`Node.js` は通常利用には不要です。

## できること

- 四麻 / 三麻の段位と段位ポイント表示
- その日の開始時点からのポイント増減表示
- 対局中の点数表示
- 対局結果の記録
- 自分の `1位-2位-3位-4位` 回数表示

## OBS 用 URL

- ランク表示: `http://127.0.0.1:4173/rank`
- 点数表示: `http://127.0.0.1:4173/points`
- 順位集計: `http://127.0.0.1:4173/records`

## 通常の使い方

### 必要なもの

- Windows
- Google Chrome

### 手順

1. `dist` フォルダをそのまま使います
2. `mahjongsoul-launch.exe` を起動します
3. 開いた Chrome で雀魂を使います
4. `mahjongsoul-collect.exe` を起動します
5. OBS のブラウザソースに URL を設定します

使うファイル:

- `dist/mahjongsoul-launch.exe`
- `dist/mahjongsoul-collect.exe`

注意:

- `mahjongsoul-collect.exe` は `dist` フォルダごとそのまま使ってください
- `dist/overlay` フォルダも必要です
- `launch.exe` を先に起動してから `collect.exe` を起動してください

## 保存されるデータ

`exe` 版では、保存先は `dist` 配下です。

- `dist/points`
- `dist/records`

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

## Node.js を使う開発用実行

開発や修正をするときは Node.js 版も使えます。

### 必要なもの

- Node.js

### セットアップ

```powershell
npm.cmd install
```

### 実行

```powershell
npm.cmd run mjs:launch
npm.cmd run mjs:collect
```

## exe のビルド

開発者向けです。

```powershell
npm.cmd run build:exe
```

個別ビルド:

```powershell
npm.cmd run build:exe:launch
npm.cmd run build:exe:collect
```

## 補足

- このツールは、起動中のブラウザがすでに持っている表示データや内部状態を読み取る方式です
- 雀魂サーバーに対して独自の API を追加で叩くことはしていません
- ログイン状態は `.playwright-profile` に保存されます
- セッションが切れた場合は、再度手動ログインが必要です
