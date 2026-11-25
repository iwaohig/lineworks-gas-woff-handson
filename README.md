# LINE WORKS × Google Apps Script / WOFF ハンズオン教材

LINE WORKS の Bot と WOFF (ミニアプリ) を、Google Apps Script (GAS) とスプレッドシートで動かすハンズオンの教材です。

| 題材 | 中身 | 置き場所 |
|---|---|---|
| 1. 水揚げ速報を Bot で知らせる | 公開されている日報 (PDF) を GAS で取り込み、シートに貯め、Bot で通知する | `gas/teichi-notify/` |
| 2. WOFF でアルコールチェック | WOFF の画面から回答 → GAS がシートに記録、未回答の人に Bot で知らせる | 画面 `docs/woff/alcohol/`、裏側 `gas/alcohol-check/` |

手順書: https://iwaohig.github.io/lineworks-gas-woff-handson/

- 秘密の値 (Client Secret・Private Key など) は GAS のスクリプト プロパティに入れ、コードやこのリポジトリには置きません
- WOFF の画面は GitHub Pages (`docs/`) で動かします。Endpoint URL は `.../woff/alcohol/?woffId=<WOFF ID>&api=<GAS ウェブアプリの URL>`
