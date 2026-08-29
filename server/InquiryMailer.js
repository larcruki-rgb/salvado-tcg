const nodemailer = require('nodemailer');

const MAIL_TO = process.env.INQUIRY_MAIL_TO || 'sarubedopr@gmail.com';
const MAIL_USER = process.env.GMAIL_USER || 'sarubedopr@gmail.com';

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: MAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  return transporter;
}

function textLine(label, value) {
  return value ? `${label}: ${value}\n` : '';
}

async function sendInquiry({ category, name, contact, playerId, text, ip, bug }) {
  const date = new Date().toISOString();
  let body = '';
  body += textLine('日時', date);
  body += textLine('カテゴリ', category);
  body += textLine('名前', name);
  body += textLine('連絡先', contact);
  body += textLine('プレイヤーID', playerId);
  body += textLine('IP', ip);
  body += `\n内容:\n${text}\n`;

  const attachments = [];
  if (bug) {
    body += '\n--- 不具合報告の詳細 ---\n';
    body += textLine('発生した日時', bug.occurredAt);
    body += textLine('発生した画面', bug.screen);
    body += textLine('発生前後に行った操作', bug.action);
    body += textLine('エラーメッセージ文', bug.errorMsg);
    body += textLine('利用端末・ブラウザ', bug.device);
    body += textLine('通信環境', bug.network);
    if (bug.screenshotDataUrl) {
      const m = /^data:([^;]+);base64,(.+)$/.exec(bug.screenshotDataUrl);
      if (m) {
        attachments.push({
          filename: bug.screenshotName || 'screenshot.png',
          content: Buffer.from(m[2], 'base64'),
          contentType: m[1],
        });
        body += 'スクリーンショット: 添付ファイルを参照\n';
      }
    }
  }

  await getTransporter().sendMail({
    from: `"サルベドTCG お問い合わせ" <${MAIL_USER}>`,
    to: MAIL_TO,
    replyTo: contact || undefined,
    subject: `[サルベドTCG] お問い合わせ: ${category || 'その他'}`,
    text: body,
    attachments,
  });
}

module.exports = { sendInquiry, getTransporter, MAIL_USER };
