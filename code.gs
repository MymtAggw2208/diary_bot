// スクリプト実行用の定数取得
let prop = PropertiesService.getScriptProperties().getProperties();

let GEMINI_API = prop.GEMINI_API,
  REPLY_URL = prop.REPLY_URL,
  LINEAPI_TOKEN = prop.LINEAPI_TOKEN,
  GEMINI_URL = prop.GEMINI_URL,
  PUSH_URL = prop.PUSH_URL;

// 短時間のキャッシュ保存
const sCache = CacheService.getScriptCache();

// AIに渡すプロンプト
const AI_PROMPT = `以下の指示に従って応答してください。理解したら"わかりました"と応答してください。
  1. あなたは英語を教える教師です。
  2. 応答時は500文字以内のテキストで応答してください。
  3. 相手から原文と英訳のセットを渡された場合、以下の内容を応答してください。
   ・与えられた英訳のどこを直すとより自然な文章になるか
   ・自分なら与えられた原文をどう英訳するか
  4. 上記4.の応答をする際、先述の2項目を1つの段落にまとめて応答してください。`

// スプレッドシートの取得
let SS = SpreadsheetApp.getActiveSpreadsheet();
let LogSheet = SS.getSheetByName("log");
let DiarySheet = SS.getSheetByName("diary");
let UserSheet = SS.getSheetByName("user");

/**
 * LINEのトークでメッセージが送信された際に起動するメソッド
 * @param {EventObject} e - イベントオブジェクト
 */
function doPost(e){
  // イベントデータはJSON形式となっているため、parseして取得
  const eventData = JSON.parse(e.postData.contents).events[0]
        , repToken = eventData.replyToken
        , msgType = eventData.message.type;
  // テキストメッセージのときのみ
  if (msgType=='text') {
    let id = eventData.source.userId
    // ユーザー情報取得（初回は追加）
    getUser(id);
    // 日記データの取得
    let date = new Date();
    let timeString = Utilities.formatDate(date, 'JST', 'HH:mm:ss');
    let dateString = Utilities.formatDate(date, 'JST', 'yyyy/MM/dd');
    let yesterday = false;
    let replyTxt = '';

    // 時間帯によって日付を変更
    if (timeString <= '12:00:00') {
      // お昼以前であれば前日日付を基準にする
      date.setDate(date.getDate()-1)
      dateString = Utilities.formatDate(date, 'JST', 'yyyy/MM/dd');
      yesterday = true;
    }

    let dataIndex = getIndex(dateString + id);

    if (dataIndex < 0) {
      // 基準日の日記データが存在しない場合、今日の出来事を質問する
      replyTxt = yesterday ? '昨日' : '今日';
      replyTxt = replyTxt +  'はどんなことがありましたか？';
      // 時間帯によって挨拶を変更
      if (timeString >= '5:00:00' && timeString < '11:00:00') {
        replyTxt = 'Good morning!\n' + replyTxt;
      } else if (timeString >= '11:00:00' && timeString < '18:00:00') {
        replyTxt = 'Good afternoon.\n' + replyTxt;
      } else {
        replyTxt = 'Good evening.\n' + replyTxt;
      }
      // 日記データを作成する
      createDiary([dateString, dateString + id, '', '', '',0]);
      appendLog(id, '日記データを新規作成');
    } else {
      // 基準日の日記データが存在する場合、データ内容をチェック
      let data = getTodaysDiary(dataIndex);
      if (data[5] == 0) {
        // 今日の出来事が書かれていない場合、今日の出来事を更新
        updateDiary([dateString, dateString + id, eventData.message.text, '', '',1]);
        appendLog(id, '日記データの原文更新');
        // 英訳を促す
        replyTxt = 'OK.\n次は英語で教えてください.';
      } else if (data[5] == 1) {
        // 英訳が書かれていない場合、英訳を更新
        updateDiary([dateString, dateString + id, data[2], eventData.message.text, '',2]);
        appendLog(id, '日記データの英訳更新');
        // AIで添削
        replyTxt = getGeminiAnswerText('原文：「' + data[2] + '」 英訳：「' + eventData.message.text +'」');
        replyTxt = replyTxt;
        // 添削内容を更新
        updateDiary([dateString, dateString + id, data[2], eventData.message.text, replyTxt,9]);
        appendLog(id, '日記データの添削更新');
      } else {
        // どれにも該当しない場合はAIと会話
        replyTxt = getGeminiAnswerText(eventData.message.text);
        appendLog(id, 'AI応答');
      }
    }
    
    // メッセージを返す
    replyText(repToken, replyTxt);
    // メッセージをキャッシュに設定
    sCache.put('user', eventData.message.text.slice(0, 1000));
    sCache.put('model', replyTxt.slice(0, 1000));
  }
}

/**
 * LINEのトークに送信されたメッセージをGemini Pro APIに渡して回答を得るメソッド
 * @param {String} txt - 送信するメッセージ
 */
function getGeminiAnswerText(txt) {
  let contentsStr = '';
  // プロンプトを渡す
  contentsStr += `{
    "role": "user",
    "parts": [{ 
      "text": ${JSON.stringify(AI_PROMPT)}
    }]
  },
  {
    "role": "model",
    "parts": [{
      "text": ${JSON.stringify('わかりました')}
    }]
  },`;
  // キャッシュにuidに紐づく情報が存在した場合、過去の応答文を取得
  if (sCache.get('user')) {
    contentsStr += `{
      "role": "user",
      "parts": [{ 
        "text": ${JSON.stringify(sCache.get('user'))}
      }]
    },
    {
      "role": "model",
      "parts": [{
        "text": ${JSON.stringify(sCache.get('model'))}
      }]
    },`
  }
  contentsStr += `{
    "role": "user",
    "parts": [{
      "text": ${JSON.stringify(txt)}
    }]
  }`
  const url = GEMINI_URL + GEMINI_API
        , payload = {
            'contents': JSON.parse(`[${contentsStr}]`)
          }
        , options = {
            'method': 'post',
            'contentType': 'application/json',
            'payload': JSON.stringify(payload)
          };

  const res = UrlFetchApp.fetch(url, options)
        , resJson = JSON.parse(res.getContentText());

  if (resJson && resJson.candidates && resJson.candidates.length > 0) {
    return removeMarks(resJson.candidates[0].content.parts[0].text);
  } else {
    return '回答を取得できませんでした。';
  }
}

/**
 * Geminiから返されたテキストの装飾を除去するメソッド
 * @param {String} gemini_txt - 返却テキスト
 */
function removeMarks(gemini_txt) {
  txt = gemini_txt.replace(/\#+/g, ""); // ヘッダー
  txt = txt.replace(/\*\*+/g, ""); // 強調
  return txt;
}

/**
 * LINEのトークにメッセージを返却するメソッド
 * @param {String} token - メッセージ返却用のtoken
 * @param {String} txt - 返却テキスト
 */
function replyText(token, txt){
  let message = {
                    'replyToken' : token,
                    'messages' : [{
                      'type': 'text',
                      'text': txt
                    }]
                  }
        , options = {
                    'method' : 'post',
                    'headers' : {
                      'Content-Type': 'application/json; charset=UTF-8',
                      'Authorization': 'Bearer ' + LINEAPI_TOKEN,
                    },
                    'payload' : JSON.stringify(message)
                  };
  UrlFetchApp.fetch(REPLY_URL, options);
}

/**
 * LINEのトークに通知メッセージを送るメソッド
 */
function sendReminder(){
  // 日記データ有無判定用のキー
  let date = new Date();
  let dateString = Utilities.formatDate(date, 'JST', 'yyyy/MM/dd');

  // ユーザー情報取得
  let userInfo = getAllUser();

  for(var i = 0; i < userInfo.length; i++) {
    var id = userInfo[i][0];
    // 当日の日記有無を判定
    let dataIndex = getIndex(dateString + id);
    if (dataIndex < 0) {
      // 基準日の日記データが存在しない場合、リマインダーを送る
      let payload = {
            "to":id,
            "messages":[{
            "type":"text",
            "text":"日記はもう書きましたか？",
            }]
      };
      try{
        UrlFetchApp.fetch(PUSH_URL,{
        "method":"post",
        "contentType":"application/json",
        "headers":{
          "Authorization":"Bearer "+ LINEAPI_TOKEN,
        },  
        "payload": JSON.stringify(payload),
        });
      }catch(e){
        result = "エラーの内容:" + e;
      }
    }
  }
}

/**
 * ログを書き込むメソッド
 * @param {String} id - ユーザーID
 * @param {String} message - ログ内容
 */
function appendLog(id, message){
  // 今の時間を取得
  let date = new Date();
  let dateString = Utilities.formatDate(date, "JST", "yyyy/MM/dd HH:mm:ss");
  
  // 書き込み用データの作成
  let createData = [dateString,id,message];
  // 書き込み
  LogSheet.appendRow(createData);
}

/**
 * 日記データを作成するメソッド
 * @param {List} addData - 日記に書き込む内容
 */
function createDiary(addData){
  // 書き込み
  DiarySheet.appendRow(addData);
}

/**
 * 指定したユーザーデータの有無を判定し、ない場合は追加するメソッド
 * @param {String} id - ユーザーID
 */
function getUser(id){
  // 最終行の取得
  let lastRow = UserSheet.getLastRow();
  // getRangeでは0を指定することができないのでデータが存在しないことになる
  if(lastRow <= 1) {
    // データが存在しない場合は追加
    UserSheet.appendRow([id]);
    return;
  }
}

/**
 * ユーザーデータを全件取得するメソッド
 */
function getAllUser(){
  // 最終行の取得
  let lastRow = UserSheet.getLastRow();
  // getRangeでは0を指定することができないのでデータが存在しないことになる
  if(lastRow <= 1) return;
  return UserSheet.getRange(2,1,lastRow-1, 1).getValues();
}

/**
 * 日記データの位置を取得するメソッド
 * @param {String} id - データキー（日付＋ID）
 */
function getIndex(id){
  // 最終行の取得
  let lastRow = DiarySheet.getLastRow();
  // getRangeでは0を指定することができないのでデータが存在しないことになる
  if(lastRow <= 1) return -1;
  // データの取得
  let datas = DiarySheet.getRange(2,1,lastRow-1, 6).getValues();
  // データの検索
  let dataIndex = datas.findIndex((value) =>{
    return value[1] == id
  })
  return dataIndex;
}

/**
 * 日記データを読み込むするメソッド
 * @param {Number} dataIndex - データ位置
 */
function getTodaysDiary(dataIndex){
  // データの取得
  let date = DiarySheet.getRange(dataIndex+2,1,1,1).getValue();
  let id = DiarySheet.getRange(dataIndex+2,2,1,1).getValue();
  let sentence = DiarySheet.getRange(dataIndex+2,3,1,1).getValue();
  let translated = DiarySheet.getRange(dataIndex+2,4,1,1).getValue();
  let comment = DiarySheet.getRange(dataIndex+2,5,1,1).getValue();
  let status = DiarySheet.getRange(dataIndex+2,6,1,1).getValue();
  let data = [date, id, sentence, translated, comment, status];

  return data;

}

/**
 * 日記データを更新するメソッド
 * @param {List} updateData - 日記を更新する内容
 */
function updateDiary(updateData){
  // 情報の展開
  let [date,id,sentence,translated,comment,status] = updateData;
  // データの検索
  let dataIndex = getIndex(id);
  // データがマッチしない場合は除外
  if (dataIndex < 0) return
  // データアップデート
  DiarySheet.getRange(dataIndex+2,1,1,6).setValues([updateData]);
}
