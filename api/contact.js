const nodemailer = require("nodemailer");

/**
 * POST /api/contact
 * body: { type, name, contact, method, lecture, message, website }
 *
 * Sends an inquiry email via Gmail SMTP (app password auth).
 * Required env vars (set in Vercel project settings):
 *   GMAIL_USER          - sending Gmail address
 *   GMAIL_APP_PASSWORD  - 16-char Gmail app password
 *   CONTACT_TO_EMAIL    - address that receives inquiries
 */

var TYPE_LABELS = {
  "상담": "상담 문의",
  "강의": "강의 문의",
  "기타": "기타 문의",
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(str) {
  return escapeHtml(str).replace(/\r\n|\r|\n/g, "<br />");
}

function buildHtmlEmail(fields) {
  var rows = [
    { label: "이름", value: fields.name },
    { label: "연락처", value: fields.contact },
  ];
  if (fields.type === "강의") {
    if (fields.lecture) rows.push({ label: "관심 강의", value: fields.lecture });
  } else {
    rows.push({ label: "희망 상담방식", value: fields.methodLabel });
  }

  var rowsHtml = rows
    .map(function (r) {
      return (
        '<tr>' +
        '<td style="padding:10px 0;color:#8b8f9e;font-size:13px;width:96px;vertical-align:top;white-space:nowrap;">' +
        escapeHtml(r.label) +
        '</td>' +
        '<td style="padding:10px 0;color:#171f43;font-size:14px;font-weight:700;">' +
        escapeHtml(r.value) +
        "</td>" +
        "</tr>"
      );
    })
    .join("");

  var typeLabel = TYPE_LABELS[fields.type] || "문의";
  var receivedAt = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    '<div style="background:#fff8f2;padding:32px 16px;font-family:\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #f0e2da;">' +
    '<div style="background:#171f43;padding:28px 32px;">' +
    '<p style="margin:0;color:#d3d7e9;font-size:12px;letter-spacing:.05em;">자존감 연구소 홈페이지</p>' +
    '<h1 style="margin:8px 0 0;color:#fff3ec;font-size:20px;line-height:1.4;">새 문의가 도착했습니다</h1>' +
    "</div>" +
    '<div style="padding:28px 32px;">' +
    '<span style="display:inline-block;background:#fce9ea;color:#ba686d;font-size:12px;font-weight:700;padding:5px 14px;border-radius:999px;">' +
    escapeHtml(typeLabel) +
    "</span>" +
    '<table style="width:100%;margin-top:20px;border-collapse:collapse;" cellpadding="0" cellspacing="0">' +
    rowsHtml +
    "</table>" +
    '<p style="margin:20px 0 8px;color:#8b8f9e;font-size:13px;">문의내용</p>' +
    '<div style="padding:16px 18px;background:#fff8f2;border-radius:14px;color:#171f43;font-size:14px;line-height:1.7;white-space:normal;">' +
    nl2br(fields.message) +
    "</div>" +
    "</div>" +
    '<div style="padding:14px 32px;background:#fff8f2;border-top:1px solid #f0e2da;font-size:12px;color:#a89c96;">' +
    "접수 시각 " +
    escapeHtml(receivedAt) +
    " · 자존감 연구소 홈페이지에서 자동 발송됨" +
    "</div>" +
    "</div>" +
    "</div>"
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "허용되지 않은 요청입니다." });
  }

  var body = req.body || {};
  var typeRaw = typeof body.type === "string" ? body.type.trim() : "";
  var type = TYPE_LABELS[typeRaw] ? typeRaw : "상담";
  var name = typeof body.name === "string" ? body.name.trim() : "";
  var contact = typeof body.contact === "string" ? body.contact.trim() : "";
  var method = typeof body.method === "string" ? body.method.trim() : "";
  var lecture = typeof body.lecture === "string" ? body.lecture.trim() : "";
  var message = typeof body.message === "string" ? body.message.trim() : "";
  var website = typeof body.website === "string" ? body.website.trim() : "";

  // Honeypot: real users never fill this hidden field.
  if (website) {
    return res.status(200).json({ ok: true });
  }

  if (!name || !contact || !message) {
    return res.status(400).json({ ok: false, error: "이름, 연락처, 문의내용을 입력해주세요." });
  }
  if (
    name.length > 50 ||
    contact.length > 80 ||
    method.length > 50 ||
    lecture.length > 80 ||
    message.length > 2000
  ) {
    return res.status(400).json({ ok: false, error: "입력값이 너무 깁니다." });
  }

  var GMAIL_USER = process.env.GMAIL_USER;
  var GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
  var CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL;

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !CONTACT_TO_EMAIL) {
    console.error("[contact] missing GMAIL_USER / GMAIL_APP_PASSWORD / CONTACT_TO_EMAIL env var");
    return res.status(500).json({ ok: false, error: "서버 설정 오류입니다. 전화로 문의해주세요." });
  }

  var singleLine = function (v) {
    return String(v).replace(/[\r\n]+/g, " ").trim();
  };
  var isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  var methodLabel = type === "강의" ? lecture || "미지정" : method || "미지정";
  var typeLabel = TYPE_LABELS[type];

  var transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });

  var textLines = [
    "문의 유형: " + typeLabel,
    "이름: " + name,
    "연락처: " + contact,
  ];
  if (type === "강의") {
    textLines.push("관심 강의: " + (lecture || "미지정"));
  } else {
    textLines.push("희망 상담방식: " + (method || "미지정"));
  }
  var text = textLines.join("\n") + "\n\n문의내용:\n" + message + "\n";

  var html = buildHtmlEmail({
    type: type,
    name: name,
    contact: contact,
    method: method,
    methodLabel: methodLabel,
    lecture: lecture,
    message: message,
  });

  try {
    await transporter.sendMail({
      from: '"자존감 연구소 홈페이지" <' + GMAIL_USER + ">",
      to: CONTACT_TO_EMAIL,
      replyTo: isEmail ? contact : undefined,
      subject: "[홈페이지 문의] " + typeLabel + " · " + singleLine(name) + "님",
      text: text,
      html: html,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[contact] sendMail failed", err);
    return res.status(500).json({ ok: false, error: "메일 전송에 실패했습니다. 전화로 문의해주세요." });
  }
};
