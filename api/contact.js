const nodemailer = require("nodemailer");

const INQUIRY_TYPES = {
  counseling: "상담 문의",
  lecture: "강의 문의",
  etc: "기타 문의",
};

const MAX_LENGTHS = {
  name: 100,
  contact: 200,
  email: 200,
  message: 4000,
  method: 50,
  org: 100,
  schedule: 200,
  audience: 200,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tooLong(fields) {
  return Object.entries(fields).some(([key, val]) => val && String(val).length > (MAX_LENGTHS[key] || 200));
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const { type, name, contact, email, message, method, org, schedule, audience, website } = req.body || {};

  // Honeypot: real users never fill this hidden field, bots often do.
  if (website) {
    res.status(200).json({ ok: true });
    return;
  }

  const typeLabel = INQUIRY_TYPES[type];
  if (!typeLabel || !name || !contact || !email || !message) {
    res.status(400).json({ ok: false, error: "필수 항목을 입력해주세요." });
    return;
  }
  if (!EMAIL_RE.test(String(email))) {
    res.status(400).json({ ok: false, error: "이메일 주소 형식을 확인해주세요." });
    return;
  }
  if (type === "lecture" && !org) {
    res.status(400).json({ ok: false, error: "소속/기관명을 입력해주세요." });
    return;
  }
  if (tooLong({ name, contact, email, message, method, org, schedule, audience })) {
    res.status(400).json({ ok: false, error: "입력 내용이 너무 깁니다." });
    return;
  }

  const { GMAIL_USER, GMAIL_APP_PASSWORD, CONTACT_TO_EMAIL } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !CONTACT_TO_EMAIL) {
    res.status(500).json({ ok: false, error: "서버 설정 오류입니다. 잠시 후 다시 시도해주세요." });
    return;
  }

  // Build type-specific rows, in order, skipping anything empty.
  const rows = [["이름", name]];
  if (type === "lecture") rows.push(["소속/기관명", org]);
  rows.push(["전화번호", contact]);
  rows.push(["이메일", email]);
  if (type === "counseling" && method) rows.push(["희망 상담 방식", method]);
  if (type === "lecture" && audience) rows.push(["강의 대상", audience]);
  if (type === "lecture" && schedule) rows.push(["희망 일정", schedule]);

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });

    const textRows = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
    const htmlRows = rows
      .map(
        ([k, v]) => `
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #f1e4dd;color:#666b83;font-size:13px;font-weight:700;white-space:nowrap;vertical-align:top;width:110px;">${escapeHtml(k)}</td>
            <td style="padding:10px 0;border-bottom:1px solid #f1e4dd;color:#171f43;font-size:14px;">${
              k === "전화번호"
                ? `<a href="tel:${escapeHtml(String(v).replace(/[^0-9+]/g, ""))}" style="color:#171f43;text-decoration:underline;">${escapeHtml(v)}</a>`
                : escapeHtml(v)
            }</td>
          </tr>`
      )
      .join("");

    const html = `
      <div style="background:#fff8f2;padding:32px 16px;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
        <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 40px -24px rgba(32,29,79,0.25);">
          <div style="background:#171f43;padding:28px 32px;">
            <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:.04em;color:#ee858c;">자존감연구소 웹 문의</p>
            <p style="margin:8px 0 0;font-size:20px;font-weight:700;color:#fff3ec;">${escapeHtml(typeLabel)} 도착</p>
          </div>
          <div style="padding:28px 32px;">
            <table style="width:100%;border-collapse:collapse;">
              ${htmlRows}
            </table>
            <p style="margin:20px 0 8px;font-size:13px;font-weight:700;color:#666b83;">문의 내용</p>
            <div style="background:#fce9ea;border-radius:16px;padding:16px 18px;color:#171f43;font-size:14px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(message)}</div>
          </div>
        </div>
        <p style="max-width:520px;margin:16px auto 0;text-align:center;font-size:12px;font-weight:700;color:#ee858c;">💬 "답장" 버튼을 누르면 문의하신 분의 이메일로 바로 답장할 수 있어요.</p>
        <p style="max-width:520px;margin:6px auto 0;text-align:center;font-size:11px;color:#9093a5;">자존감연구소 홈페이지 문의 폼을 통해 자동 발송된 메일입니다.</p>
      </div>
    `;

    await transporter.sendMail({
      from: `"${name}님 (${typeLabel})" <${email}>`,
      to: CONTACT_TO_EMAIL,
      replyTo: String(email),
      subject: `[자존감연구소] [${typeLabel}] ${name}님`,
      text: `문의 유형: ${typeLabel}\n${textRows}\n\n${message}`,
      html: html,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("contact form send failed:", err);
    res.status(500).json({ ok: false, error: "전송에 실패했습니다. 전화로 문의해주세요." });
  }
};
