import { connect } from "cloudflare:sockets";

export type SmtpConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  fromEmail: string;
  replyTo?: string;
  fromName?: string;
};

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

type SmtpResponse = {
  code: number;
  message: string;
};

const encoder = new TextEncoder();

function base64(value: string) {
  return btoa(value);
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeSmtpData(value: string) {
  return value.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function createLineReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  return async function readLine() {
    for (;;) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        return line;
      }
      const chunk = await reader.read();
      if (chunk.done) {
        if (buffer) {
          const line = buffer.replace(/\r$/, "");
          buffer = "";
          return line;
        }
        throw new Error("SMTP connection closed unexpectedly");
      }
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };
}

async function readSmtpResponse(readLine: () => Promise<string>): Promise<SmtpResponse> {
  const lines: string[] = [];
  for (;;) {
    const line = await readLine();
    lines.push(line);
    if (/^\d{3} /.test(line)) break;
    if (!/^\d{3}-/.test(line)) break;
  }
  const message = lines.join("\n");
  const code = Number(lines[lines.length - 1]?.slice(0, 3));
  if (!Number.isInteger(code)) throw new Error(`Invalid SMTP response: ${message}`);
  return { code, message };
}

function assertSmtpResponse(response: SmtpResponse, expected: number[]) {
  if (!expected.includes(response.code)) throw new Error(`SMTP command failed: ${response.message}`);
}

async function writeSmtpCommand(writer: WritableStreamDefaultWriter<Uint8Array>, readLine: () => Promise<string>, command: string, expected: number[]) {
  await writer.write(encoder.encode(`${command}\r\n`));
  const response = await readSmtpResponse(readLine);
  assertSmtpResponse(response, expected);
}

function buildMessage(config: SmtpConfig, message: EmailMessage) {
  const boundary = `quietcollective-${crypto.randomUUID()}`;
  const fromEmail = sanitizeHeader(config.fromEmail);
  const fromName = sanitizeHeader(config.fromName || "QuietCollective");
  const headers = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${sanitizeHeader(message.to)}`,
    `Subject: ${sanitizeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${fromEmail.split("@")[1] ?? "quietcollective"}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (config.replyTo) headers.push(`Reply-To: ${sanitizeHeader(config.replyTo)}`);
  return [
    ...headers,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    message.text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    message.html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export function smtpConfigured(config: Partial<SmtpConfig>) {
  return !!config.host && Number.isInteger(config.port) && Number(config.port) > 0 && !!config.username && !!config.password && !!config.fromEmail;
}

export async function sendEmail(config: SmtpConfig, message: EmailMessage) {
  if (!smtpConfigured(config)) throw new Error("Email delivery is not configured");
  const socket = connect({ hostname: config.host, port: config.port }, { secureTransport: "on", allowHalfOpen: false });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const readLine = createLineReader(reader);
  try {
    assertSmtpResponse(await readSmtpResponse(readLine), [220]);
    await writeSmtpCommand(writer, readLine, "EHLO quietcollective", [250]);
    await writeSmtpCommand(writer, readLine, `AUTH PLAIN ${base64(`\0${config.username}\0${config.password}`)}`, [235]);
    await writeSmtpCommand(writer, readLine, `MAIL FROM:<${config.fromEmail}>`, [250]);
    await writeSmtpCommand(writer, readLine, `RCPT TO:<${message.to}>`, [250, 251]);
    await writeSmtpCommand(writer, readLine, "DATA", [354]);
    await writer.write(encoder.encode(`${escapeSmtpData(buildMessage(config, message))}\r\n.\r\n`));
    assertSmtpResponse(await readSmtpResponse(readLine), [250]);
    await writeSmtpCommand(writer, readLine, "QUIT", [221]);
  } finally {
    writer.releaseLock();
    reader.releaseLock();
    await socket.close().catch(() => undefined);
  }
}
