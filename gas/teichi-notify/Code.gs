/**
 * 定置網の水揚げ速報 (PDF) を毎日取り込んで、シートに貯め、Bot で知らせる見本。
 *
 * 元データ: 岩手県定置漁業協会「県下定置漁業水揚速報」
 *   一覧: https://www.echna.ne.jp/~isz/teichi/karendar.html
 *   日ごとの PDF: https://www.echna.ne.jp/~isz/teichi/soku<YYYYMMDD>.pdf
 *   当日分は情報が入り次第更新され、最終は正午頃。休場の日は PDF がない。前の日付の PDF はやがて消える。
 *
 * 使う前に:
 *   1. LineWorks.gs のコメントにあるスクリプト プロパティを入れる
 *   2. 左の「サービス」の + から「Drive API」を追加する (PDF を文字にするのに使う)
 *
 * 当日やること:
 *   testHello      → Bot から自分に届くか
 *   runToday       → 今日 (なければ前の日) の PDF を取り込んでシートに書き、Bot で知らせる
 *   setupTrigger   → 毎日決まった時刻に runToday を動かす (本番の形)
 */

const TEICHI_BASE = 'https://www.echna.ne.jp/~isz/teichi/';
const SHEET_NAME = '速報';
const LOOKBACK_DAYS = 4; // 今日の PDF がないとき、何日前までさかのぼるか (土日・休場をまたぐ)

/** いちばん新しい速報を取り込んで知らせる。トリガーからもこれを呼ぶ。 */
function runToday() {
  const found = findLatestPdf_(new Date());
  if (!found) {
    Logger.log('直近 ' + LOOKBACK_DAYS + ' 日の速報が見つかりませんでした (休場か未掲載)。');
    return;
  }
  const text = pdfToText_(found.blob);
  const report = parseReport_(text);
  report.date = found.date;
  report.url = found.url;
  saveToSheet_(report);
  notify_(report);
  Logger.log(JSON.stringify(report, null, 2));
}

/** 日付を指定して取り込む (例: runForDate('2026-11-25'))。シートの見直しやテストに。 */
function runForDate(ymd) {
  const d = new Date(ymd + 'T09:00:00+09:00');
  const got = fetchPdf_(d);
  if (!got) throw new Error(ymd + ' の PDF はありません (休場か、もう消えている)。');
  const report = parseReport_(pdfToText_(got.blob));
  report.date = got.date;
  report.url = got.url;
  saveToSheet_(report);
  Logger.log(JSON.stringify(report, null, 2));
}

// ---------------------------------------------------------------- 取ってくる

function ymd_(d) {
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyyMMdd');
}

/** その日の PDF を取りにいく。なければ null。 */
function fetchPdf_(d) {
  const url = TEICHI_BASE + 'soku' + ymd_(d) + '.pdf';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const isPdf = String(res.getHeaders()['Content-Type'] || '').indexOf('pdf') >= 0;
  if (res.getResponseCode() !== 200 || !isPdf) return null;
  return {
    date: Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'),
    url: url,
    blob: res.getBlob().setName('soku' + ymd_(d) + '.pdf'),
  };
}

/** 今日から順にさかのぼって、最初に見つかった PDF を返す。 */
function findLatestPdf_(today) {
  for (let i = 0; i <= LOOKBACK_DAYS; i++) {
    const d = new Date(today.getTime() - i * 24 * 3600 * 1000);
    const got = fetchPdf_(d);
    if (got) return got;
  }
  return null;
}

// ---------------------------------------------------------------- PDF を文字にする

/**
 * PDF を Google ドキュメントに変換して文字を取り出す (Drive API の高度なサービス)。
 * 変換したドキュメントは、読み終わったらゴミ箱に入れる。
 */
function pdfToText_(blob) {
  const file = Drive.Files.create(
    { name: blob.getName() + ' (一時)', mimeType: 'application/vnd.google-apps.document' },
    blob,
    { ocrLanguage: 'ja' }
  );
  try {
    return DocumentApp.openById(file.id).getBody().getText();
  } finally {
    Drive.Files.update({ trashed: true }, file.id);
  }
}

/** 読み取りの確かめ用: 読み取った結果と、取り出した文字 (改行は | に置き換え) をログに出す。通知はしない。 */
function debugPdfText() {
  const found = findLatestPdf_(new Date());
  if (!found) throw new Error('PDF が見つかりません。');
  const text = pdfToText_(found.blob);
  const r = parseReport_(text);
  Logger.log(found.date + ' 合計=' + r.total + ' 平年比=' + r.totalRatio + ' 前日比=' + r.prevRatio);
  Logger.log(r.areas.map(a => a.name + ':' + a.count + (a.ratio ? '(' + a.ratio + ')' : '')).join(' '));
  Logger.log(text.replace(/\n+/g, ' | '));
}

// ---------------------------------------------------------------- 読み取る

/**
 * 「〇〇地区計」と「合計」の行を拾う。
 * 行の並びは「鮭尾数・平年比 (%)・過去 5 年の平均」。鮭が 0 尾の日は尾数と % が空欄で、
 * 平均の数字だけが残る (例「宮古地区計 49」の 49 は平均で、尾数ではない)。
 * そこで「数字 数字% 数字」の形のときだけ尾数として読み、数字が 1 つだけなら 0 尾・平均として読む。
 * 表は 3 列に並んでいて崩れやすいので、拾えたものだけを使う (拾えなくても通知は PDF のリンクで出す)。
 */
function parseReport_(text) {
  // 漢字・かなの間に入った空白を詰める (「宮 古 地 区 計」→「宮古地区計」)
  const t = text.replace(/([^\x00-\x7F])[ 　]+(?=[^\x00-\x7F])/g, '$1');
  const num = s => Number(String(s).replace(/,/g, ''));
  // Drive で変換した文字は表のマスごとに改行が入るので、空白と改行の両方をまたいで読む
  const rowRe = '[\\s\\u3000]*([\\d,]+)(?:[\\s\\u3000]+([\\d.]+)%[\\s\\u3000]+([\\d,]+))?';

  const areas = [];
  const re = new RegExp('([\\u3040-\\u30ff\\u4e00-\\u9fff]{1,6})地区計' + rowRe, 'g');
  let m;
  while ((m = re.exec(t)) !== null) {
    if (areas.some(a => a.name === m[1])) continue;
    areas.push(m[2] !== undefined && m[3] !== undefined
      ? { name: m[1], count: num(m[2]), ratio: m[3] + '%', avg: num(m[4]) }
      : { name: m[1], count: 0, ratio: null, avg: num(m[2]) });
  }
  const tm = t.match(new RegExp('合計' + rowRe));
  const prevRatio = (t.match(/前日比[\s　]*([\d.]+%)/) || [])[1];
  return {
    total: tm && tm[3] !== undefined ? num(tm[1]) : null,
    totalRatio: tm && tm[3] !== undefined ? tm[2] + '%' : null, // 平年 (過去 5 年の前後 5 日平均) 比
    prevRatio: prevRatio || null,
    areas: areas,
  };
}

// ---------------------------------------------------------------- 貯める

/** シート「速報」に 1 日 1 行で書く。同じ日がすでにあれば上書きする。地区が増えたら列を足す。 */
function saveToSheet_(r) {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('定置網 水揚げ速報');
  const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(['日付', '合計 (尾)', '前日比', 'PDF']);

  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  r.areas.forEach(a => {
    if (header.indexOf(a.name) < 0) {
      header.push(a.name);
      sh.getRange(1, header.length).setValue(a.name);
    }
  });

  const row = header.map(h => {
    if (h === '日付') return r.date;
    if (h === '合計 (尾)') return r.total;
    if (h === '前日比') return r.prevRatio;
    if (h === 'PDF') return r.url;
    const a = r.areas.find(x => x.name === h);
    return a ? a.count : '';
  });

  const dates = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(v => v[0]) : [];
  const idx = dates.indexOf(r.date);
  const target = idx >= 0 ? idx + 2 : sh.getLastRow() + 1;
  sh.getRange(target, 1, 1, row.length).setValues([row]);
}

// ---------------------------------------------------------------- 知らせる

function notify_(r) {
  const to = lwConfig_().LW_TO_USER_ID;
  if (!to) throw new Error('スクリプト プロパティ LW_TO_USER_ID (通知を受け取る人の ID) を入れてください。');

  const md = r.date.slice(5).replace('-', '/');
  const lines = ['定置網 水揚げ速報 ' + md];
  if (r.total !== null) {
    const notes = [];
    if (r.totalRatio) notes.push('平年比 ' + r.totalRatio);
    if (r.prevRatio) notes.push('前日比 ' + r.prevRatio);
    lines.push('鮭 合計 ' + r.total.toLocaleString() + ' 尾' + (notes.length ? ' (' + notes.join('、') + ')' : ''));
  }
  const top = r.areas.filter(a => a.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
  if (top.length) lines.push('多い地区: ' + top.map(a => a.name + ' ' + a.count + ' 尾').join(' / '));
  if (r.total === null && !top.length) lines.push('数字は読み取れませんでした。PDF をご覧ください。');

  lwSendToUser_(to, {
    type: 'link',
    contentText: lines.join('\n'),
    linkText: 'PDF を開く',
    link: r.url,
  });
}

// ---------------------------------------------------------------- 毎日動かす

/** 毎日 12:30 ごろに runToday を動かすトリガーを作る (すでにあれば作り直す)。 */
function setupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runToday')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runToday').timeBased().everyDays(1).atHour(12).nearMinute(30).inTimezone('Asia/Tokyo').create();
  Logger.log('毎日 12:30 ごろに runToday が動きます。止めるときは deleteTrigger を実行。');
}

function deleteTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runToday')
    .forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('トリガーを消しました。');
}
