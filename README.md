# diary_bot
日記を添削するLINEBOT

## 概要

1. 話しかけると今日の出来事を聞いてきます
2. 答えると英語でもう一度教えてほしいと尋ねられます
3. 上記1.と2.の原文と英文を比較して添削結果を返します
   各内容はそれぞれスプレッドシートに記入されます

## 設定

* スクリプトプロパティとして以下の定数定義が必要です
  - GEMINI_API：Gemini APIキー
  - GEMINI_URL：Geminiプロンプト送信先URL
  - LINEAPI_TOKEN：LINE Messaging APIのチャネルアクセストークン
  - PUSH_URL：LINEのプッシュメッセージ送信先URL
  - REPLY_URL：LINEの返信メッセージ送信先URL
* リマインドメッセージを送信する場合、GoogleAppsScriptのトリガー設定が必要です
* コードはGoogleAppsScript単独ではなく、スプレッドシートの拡張機能として定義します
* スプレッドシートには「log」「diary」「user」の3シートが必要です
  各シートの1行目は項目名を想定しています
  - 「log」シート：「日付」「ユーザーID」「ログ」
  - 「diary」シート：「日付」「キー」「原文」「英訳」「添削コメント」「状態」
  - 「user」シート：「ユーザーID」
