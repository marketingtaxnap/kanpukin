/* =====================================================================
 * kanpukin 診断ログ受け取り用 GAS（Webアプリ）
 * ---------------------------------------------------------------------
 * 役割：診断サイト(index.html)の logResult() から飛んでくる POST を受けて、
 *       スプレッドシートの「log」シートに1行ずつ追記する。
 *
 * 【セットアップ手順】
 *  1. 記録先のGoogleスプレッドシートを作る（タブ名は自動で「log」を作成）
 *  2. 拡張機能 → Apps Script → このコードを貼り付け
 *  3. 下の TOKEN を好きな文字列に変える（index.html の POST_TOKEN と"完全一致"させる）
 *  4. SHEET_ID にスプシのIDを入れる（URLの /d/ と /edit の間の文字列）
 *  5. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *       - 次のユーザーとして実行：自分
 *       - アクセスできるユーザー：全員
 *     → 発行された「ウェブアプリのURL」を控える（= index.html の GAS_URL）
 *  ※ サイト側は no-cors で投げるので戻り値は使わない（記録できればOK）
 * ===================================================================== */

const TOKEN    = 'CHANGE_ME';   // ★index.html の POST_TOKEN と一致させる
const SHEET_ID = '';            // ★記録先スプレッドシートのID（空ならスクリプトに紐づくスプシ）

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== TOKEN) {
      return _json({ ok: false, error: 'bad token' });
    }
    const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID)
                        : SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('log') || ss.insertSheet('log');

    if (sh.getLastRow() === 0) {
      sh.appendRow([
        '日時', '職種', '申告', '青/白', '昼掛け持ち', '昼年収(万)',
        '年収(万)', '経費(万)', '払い方', '週出勤', '結果', '金額', '経費割合',
      ]);
    }

    sh.appendRow([
      new Date(),
      data.job,
      data.filed,
      data.blueFiling,
      data.hasDayJob,
      data.dayIncome,
      data.yearReward,
      data.yearExpense,
      data.payType,
      data.weekDays,
      data.type,
      data.amount,
      data.ratio,
    ]);

    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
