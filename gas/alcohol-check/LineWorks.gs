/**
 * LINE WORKS API の共通部分 (認証と Bot の送信)。
 *
 * スクリプト プロパティ (プロジェクトの設定 → スクリプト プロパティ) に次を入れておく:
 *   LW_CLIENT_ID        Client App の Client ID
 *   LW_CLIENT_SECRET    Client App の Client Secret
 *   LW_SERVICE_ACCOUNT  Service Account (例: xxxxx.serviceaccount@example.com)
 *   LW_PRIVATE_KEY      Private Key (ダウンロードした .key ファイルの中身を全部。BEGIN/END の行も含める)
 *   LW_BOT_ID           Bot ID
 *   LW_TO_USER_ID       通知を受け取る人の ID (メールアドレスの形のログイン ID でよい)
 *
 * 値はコードに書かない。スクリプト プロパティに入れておけば、コードを人に見せても漏れない。
 */

const LW_AUTH_URL = 'https://auth.worksmobile.com/oauth2/v2.0/token';
const LW_API_BASE = 'https://www.worksapis.com/v1.0';

/** スクリプト プロパティを読む。足りないときは、何を入れればよいかをエラーで知らせる。 */
function lwConfig_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const keys = ['LW_CLIENT_ID', 'LW_CLIENT_SECRET', 'LW_SERVICE_ACCOUNT', 'LW_PRIVATE_KEY', 'LW_BOT_ID'];
  const missing = keys.filter(k => !props[k]);
  if (missing.length) {
    throw new Error('スクリプト プロパティが足りません: ' + missing.join(', ') +
      '\nプロジェクトの設定 (歯車) → スクリプト プロパティ に入れてください。');
  }
  return props;
}

/** base64url (= を取る) */
function b64url_(bytesOrString) {
  return Utilities.base64EncodeWebSafe(bytesOrString).replace(/=+$/, '');
}

/**
 * Service Account の JWT を作り、アクセストークンをもらう。
 * トークンは 1 時間使えるので、50 分だけキャッシュしておく。
 */
function lwGetAccessToken_(scope) {
  scope = scope || 'bot';
  const cache = CacheService.getScriptCache();
  const cacheKey = 'lw_token_' + scope;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const c = lwConfig_();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: c.LW_CLIENT_ID, sub: c.LW_SERVICE_ACCOUNT, iat: now, exp: now + 3600 };
  const input = b64url_(JSON.stringify(header)) + '.' + b64url_(JSON.stringify(claim));
  const key = c.LW_PRIVATE_KEY.replace(/\\n/g, '\n'); // 1 行で貼ったときの \n を改行に戻す
  const signature = Utilities.computeRsaSha256Signature(input, key);
  const assertion = input + '.' + b64url_(signature);

  const res = UrlFetchApp.fetch(LW_AUTH_URL, {
    method: 'post',
    payload: {
      assertion: assertion,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: c.LW_CLIENT_ID,
      client_secret: c.LW_CLIENT_SECRET,
      scope: scope,
    },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('アクセストークンを取れませんでした (' + res.getResponseCode() + '): ' + res.getContentText());
  }
  const token = JSON.parse(res.getContentText()).access_token;
  cache.put(cacheKey, token, 50 * 60);
  return token;
}

/** Bot から 1 人にメッセージを送る。content は LINE WORKS のメッセージの形 ({type: 'text', text: ...} など)。 */
function lwSendToUser_(userId, content) {
  const c = lwConfig_();
  const url = LW_API_BASE + '/bots/' + c.LW_BOT_ID + '/users/' + encodeURIComponent(userId) + '/messages';
  return lwPost_(url, { content: content });
}

/** Bot からトークルームに送る (Bot をそのルームに招待しておくこと)。 */
function lwSendToChannel_(channelId, content) {
  const c = lwConfig_();
  const url = LW_API_BASE + '/bots/' + c.LW_BOT_ID + '/channels/' + channelId + '/messages';
  return lwPost_(url, { content: content });
}

function lwPost_(url, body) {
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + lwGetAccessToken_('bot') },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 300) {
    throw new Error('送信に失敗しました (' + code + '): ' + res.getContentText());
  }
  return code;
}

/** 動作確認: 自分に「こんにちは」を送る。最初に実行してみる関数。 */
function testHello() {
  const to = lwConfig_().LW_TO_USER_ID;
  if (!to) throw new Error('スクリプト プロパティ LW_TO_USER_ID (通知を受け取る人の ID) を入れてください。');
  lwSendToUser_(to, { type: 'text', text: 'こんにちは。Apps Script から Bot で送っています。' });
  Logger.log('送りました。LINE WORKS のトークを見てください。');
}
