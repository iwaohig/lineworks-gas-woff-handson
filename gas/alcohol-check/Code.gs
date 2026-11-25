/**
 * WOFF (ミニアプリ) のアルコールチェックの裏側。
 *
 *   WOFF の画面 ──(回答 + アクセストークン)──> doPost ──> シート「記録」に 1 行
 *   remindUnanswered ──> 名簿で今日まだの人に Bot で「アルコールチェックがまだです」+ WOFF を開くボタン
 *
 * 使う前に:
 *   1. LineWorks.gs と同じスクリプト プロパティ (LW_CLIENT_ID など) を入れる。ほかに LW_WOFF_ID (WOFF ID)
 *   2. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」、次のユーザーとして実行「自分」、アクセスできるユーザー「全員」
 *   3. 出てきたウェブアプリの URL を、WOFF の Endpoint URL の api= に入れる
 *
 * 「全員」に公開するのは、WOFF の画面から呼ぶため。URL を知っていれば誰でも送れてしまうので、
 * doPost では必ずアクセストークンで LINE WORKS に本人を問い合わせ、確かめられた人の回答だけを保存する。
 */

const RECORD_SHEET = '記録';
const MEMBER_SHEET = '名簿';
const TZ = 'Asia/Tokyo';

/** WOFF の画面から呼ばれる。 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const me = whoIs_(body.token); // 本人を確かめる (確かめられなければ例外)
    const timing = ['運転前', '運転後'].indexOf(body.timing) >= 0 ? body.timing : '運転前';
    const detected = body.detected === 'あり' ? 'あり' : 'なし';
    const now = new Date();
    const row = [
      Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
      Utilities.formatDate(now, TZ, 'HH:mm'),
      me.userId,
      me.name,
      timing,
      detected,
      String(body.checker || '').slice(0, 50),
      String(body.note || '').slice(0, 200),
    ];
    recordSheet_().appendRow(row);
    if (detected === 'あり') notifyDetected_(me, timing);
    return json_({ ok: true, name: me.name, timing: timing, detected: detected, time: row[1] });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** WOFF のアクセストークンで「私は誰か」を LINE WORKS に聞く。 */
function whoIs_(token) {
  if (!token) throw new Error('アクセストークンがありません');
  const res = UrlFetchApp.fetch(LW_API_BASE + '/users/me', {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('本人を確かめられませんでした (' + res.getResponseCode() + ')');
  const u = JSON.parse(res.getContentText());
  const n = u.userName || {};
  return { userId: u.userId, name: [n.lastName, n.firstName].filter(Boolean).join(' ') || u.email || u.userId };
}

function recordSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(RECORD_SHEET) || ss.insertSheet(RECORD_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(['日付', '時刻', 'ユーザー ID', '名前', '区分', '検知', '確認者', '備考']);
  return sh;
}

/** 名簿シート: ユーザー ID / 名前 / 本日休み (TRUE で除外)。最初の実行で見出しだけ作る。 */
function memberSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MEMBER_SHEET) || ss.insertSheet(MEMBER_SHEET);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['ユーザー ID (ログイン ID でも可)', '名前', '本日休み']);
    sh.getRange('C2:C200').insertCheckboxes();
  }
  return sh;
}

/**
 * 今日の「運転前」がまだの人に Bot で知らせる。休みにチェックのある人は除く。
 * 本番では出社時刻の少しあとに時間トリガーで動かす (setupReminderTrigger)。
 */
function remindUnanswered() {
  const woffId = PropertiesService.getScriptProperties().getProperty('LW_WOFF_ID');
  if (!woffId) throw new Error('スクリプト プロパティ LW_WOFF_ID (WOFF ID) を入れてください。');

  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const rec = recordSheet_();
  const answered = rec.getLastRow() > 1
    ? rec.getRange(2, 1, rec.getLastRow() - 1, 5).getDisplayValues()
        .filter(r => r[0] === today && r[4] === '運転前').map(r => r[2])
    : [];

  const mem = memberSheet_();
  const members = mem.getLastRow() > 1 ? mem.getRange(2, 1, mem.getLastRow() - 1, 3).getValues() : [];
  const targets = members.filter(m => m[0] && m[2] !== true && answered.indexOf(String(m[0])) < 0);

  targets.forEach(m => {
    lwSendToUser_(String(m[0]), {
      type: 'link',
      contentText: (m[1] ? m[1] + ' さん\n' : '') + '今日のアルコールチェック (運転前) がまだです。',
      linkText: 'アルコールチェックを開く',
      link: 'https://woff.worksmobile.com/woff/' + woffId,
    });
  });
  Logger.log('お知らせを送った人: ' + targets.length + ' 人 (回答済み ' + answered.length + ' 人)');
}

/** 検知「あり」のとき、通知先 (LW_TO_USER_ID、管理者を想定) に知らせる。 */
function notifyDetected_(me, timing) {
  const to = PropertiesService.getScriptProperties().getProperty('LW_TO_USER_ID');
  if (!to) return;
  lwSendToUser_(to, { type: 'text', text: '【要確認】' + me.name + ' さんのアルコールチェック (' + timing + ') で「検知あり」の回答がありました。' });
}

/** 平日の朝 9:30 ごろに remindUnanswered を動かす (時刻は会社に合わせて変える)。 */
function setupReminderTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'remindUnanswered')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('remindUnanswered').timeBased().everyDays(1).atHour(9).nearMinute(30).inTimezone(TZ).create();
  Logger.log('毎日 9:30 ごろに remindUnanswered が動きます。');
}
