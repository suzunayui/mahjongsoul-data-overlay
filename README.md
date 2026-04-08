# mahjongsoul-data-overlay

![スクリーンショット](./2026-04-05.png)

動画リンク: <https://www.youtube.com/watch?v=Jx6_zLfGgQk>

雀魂の情報を取得して、OBSブラウザソースで使えるオーバーレイを表示するツールです。

主な機能:
- ランク/ポイントの表示
- 当日のポイント差分表示
- 対局結果の記録
- 翻数カウント
- OBS WebSocket 連携
- OBSソースの一括追加（rank/points/records/han）
- デザイン一括切り替え（通常 / 枠なし白 / 枠なし黒 / カスタム）

## 必要環境
- Windows
- Google Chrome
- OBS（OBS連携を使う場合。OBS WebSocket を有効化）

## 使い方（単一EXE版）
1. Releases から `mahjongsoul-data-overlay-setup-<version>.exe` をダウンロード
2. インストールして `mahjongsoul-data-overlay` を起動
3. アプリの `開始` タブで次の順に操作
`1. 雀魂起動` → `2. データ取得開始` → `3. OBS連携` → `4. ソース追加`
4. `3. OBS連携` では、OBSの `ツール → WebSocketサーバー設定` で有効化したURL/パスワードを入力して接続
5. `4. ソース追加` でOBSに4種類のブラウザソースを一括作成/更新

## リーチ演出
`リーチ演出` タブでは以下を操作できます。
- ON/OFF切り替え（デフォルトはOFF）
- メディアソース名の選択
- テスト再生

## デザイン
`デザイン` タブでは、全オーバーレイの見た目を一括で変更できます。
- テーマ: `通常` / `枠なし文字白` / `枠なし文字黒` / `カスタム`
- カスタム: 文字色、背景色、背景透明度、ボーダー色、ボーダー太さ、角丸、フォント
- フォントはインストール済みフォント一覧から選択
- 変更は自動保存・即時反映

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
