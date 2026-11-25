/**
 * スプレッドシートに「LINE WORKS」メニューを出し、接続の設定を画面から入れられるようにする。
 * 値はスクリプト プロパティに保存される (シートやコードには残らない)。
 */

const LW_SETTING_FIELDS = [
  { key: 'LW_CLIENT_ID', label: 'Client ID', secret: false },
  { key: 'LW_CLIENT_SECRET', label: 'Client Secret', secret: true },
  { key: 'LW_SERVICE_ACCOUNT', label: 'Service Account', secret: false },
  { key: 'LW_PRIVATE_KEY', label: 'Private Key (ファイルの中身を全部)', secret: true, multiline: true },
  { key: 'LW_BOT_ID', label: 'Bot ID', secret: false },
  { key: 'LW_TO_USER_ID', label: '「検知あり」を受け取る人のログイン ID', secret: false },
  { key: 'LW_WOFF_ID', label: 'WOFF ID', secret: false },
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LINE WORKS')
    .addItem('接続の設定', 'showSettings')
    .addItem('テスト送信 (自分に「こんにちは」)', 'testHello')
    .addItem('未回答の人に知らせる', 'remindUnanswered')
    .addToUi();
}

function showSettings() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const rows = LW_SETTING_FIELDS.map(f => {
    const has = !!props[f.key];
    const shown = has && !f.secret ? props[f.key] : '';
    const ph = has ? (f.secret ? '設定済み (変えるときだけ貼る)' : '') : '未設定';
    const input = f.multiline
      ? '<textarea name="' + f.key + '" rows="5" placeholder="' + ph + '"></textarea>'
      : '<input name="' + f.key + '" type="' + (f.secret ? 'password' : 'text') + '" value="' + escapeHtml_(shown) + '" placeholder="' + ph + '">';
    return '<label>' + f.label + (has ? ' <span class="ok">✓</span>' : '') + input + '</label>';
  }).join('');
  const html = HtmlService.createHtmlOutput(
    '<style>body{font:13px sans-serif;margin:12px}label{display:block;margin:0 0 10px}' +
    'input,textarea{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:6px;font:12px monospace}' +
    '.ok{color:#00a651}button{padding:6px 16px}#msg{margin-left:8px}</style>' +
    '<form id="f">' + rows + '<button type="submit">保存</button><span id="msg"></span></form>' +
    '<script>document.getElementById("f").onsubmit=function(e){e.preventDefault();' +
    'var o={};Array.prototype.forEach.call(this.elements,function(el){if(el.name&&el.value)o[el.name]=el.value;});' +
    'document.getElementById("msg").textContent="保存しています…";' +
    'google.script.run.withSuccessHandler(function(n){document.getElementById("msg").textContent=n+" 件を保存しました。閉じてかまいません。";})' +
    '.withFailureHandler(function(err){document.getElementById("msg").textContent="失敗: "+err.message;}).saveLwSettings(o);};</script>'
  ).setWidth(460).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'LINE WORKS 接続の設定');
}

/** 画面から呼ばれる。空欄は変えない。 */
function saveLwSettings(values) {
  const allowed = LW_SETTING_FIELDS.map(f => f.key);
  const toSave = {};
  Object.keys(values || {}).forEach(k => {
    if (allowed.indexOf(k) >= 0 && String(values[k]).trim()) toSave[k] = String(values[k]).trim();
  });
  PropertiesService.getScriptProperties().setProperties(toSave);
  CacheService.getScriptCache().remove('lw_token_bot'); // 設定を変えたらトークンを取り直す
  return Object.keys(toSave).length;
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
