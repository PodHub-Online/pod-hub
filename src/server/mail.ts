import "server-only";
import tls from "node:tls";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { appConfig } from "~/server/db/schema";
import { open, seal } from "~/server/crypto";
import { bump } from "~/server/stats";

/**
 * Approval emails from the owner's Gmail. The owner saves their Gmail address and a Google
 * "app password" (Settings → Invites); both are kept encrypted in the app settings and the
 * password is never sent back to the browser. Mail goes out over Gmail's own SMTP server.
 */

const KEY = "gmail";
const HOST = "smtp.gmail.com";
const PORT = 465;

export interface MailSetup {
  user: string;
  pass: string;
  /** send an email when the owner approves a request or adds an invite */
  onApprove: boolean;
}

export async function mailSetup(): Promise<MailSetup | null> {
  const row = await db.query.appConfig.findFirst({ where: eq(appConfig.key, KEY) });
  if (!row) return null;
  try {
    const raw = JSON.parse(open(row.value)) as MailSetup;
    return raw.user && raw.pass ? raw : null;
  } catch {
    return null;
  }
}

export async function saveMailSetup(setup: MailSetup | null) {
  if (!setup) {
    await db.delete(appConfig).where(eq(appConfig.key, KEY));
    return;
  }
  const value = seal(JSON.stringify(setup));
  await db.insert(appConfig).values({ key: KEY, value }).onConflictDoUpdate({ target: appConfig.key, set: { value } });
}

/** Keeps header lines safe: no line breaks, and non-ASCII encoded. */
const header = (v: string) => {
  const clean = v.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean).toString("base64")}?=`;
};

/** A tiny SMTP client: enough to log in to Gmail and hand over one message. */
async function smtpSend(setup: Pick<MailSetup, "user" | "pass">, to: string, subject: string, text: string) {
  const socket = tls.connect({ host: HOST, port: PORT, servername: HOST });
  socket.setEncoding("utf8");
  socket.setTimeout(15_000, () => socket.destroy(new Error("Gmail didn't answer in time.")));
  let buffer = "";
  const waiters: ((line: string) => void)[] = [];
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    // a reply ends with a line "250 ..." (code + space); "250-..." lines continue
    let m: RegExpMatchArray | null;
    while ((m = /^(\d{3}) .*\r?\n/m.exec(buffer)) && m.index !== undefined) {
      const end = m.index + m[0].length;
      const reply = buffer.slice(0, end);
      buffer = buffer.slice(end);
      waiters.shift()?.(reply);
    }
  });
  const errored = new Promise<never>((_, reject) => socket.once("error", reject));
  const reply = () => Promise.race([new Promise<string>((resolve) => waiters.push(resolve)), errored]);
  const expect = async (codes: number[], send?: string) => {
    const next = reply();
    if (send !== undefined) socket.write(send + "\r\n");
    const r = await next;
    const code = Number(r.slice(0, 3));
    if (!codes.includes(code)) {
      // Gmail says 535 for a wrong address or app password
      if (code === 535) throw new Error("Gmail didn't accept the address or app password.");
      throw new Error(`Gmail said: ${r.trim().split("\n").pop()}`);
    }
    return r;
  };
  try {
    await expect([220]);
    await expect([250], "EHLO pod-hub");
    await expect([235], `AUTH PLAIN ${Buffer.from(`\0${setup.user}\0${setup.pass}`).toString("base64")}`);
    await expect([250], `MAIL FROM:<${setup.user}>`);
    await expect([250, 251], `RCPT TO:<${to}>`);
    await expect([354], "DATA");
    const body = [
      `From: ${header("Pod Hub")} <${setup.user}>`,
      `To: <${to}>`,
      `Subject: ${header(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(text).toString("base64").replace(/.{76}/g, "$&\r\n"),
    ].join("\r\n");
    await expect([250], `${body}\r\n.`);
    await expect([221], "QUIT").catch(() => undefined);
  } finally {
    socket.end();
  }
}

const isEmail = (s: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);

export async function sendMail(to: string, subject: string, text: string, setup?: Pick<MailSetup, "user" | "pass">) {
  const s = setup ?? (await mailSetup());
  if (!s) throw new Error("Approval emails aren't set up.");
  if (!isEmail(to)) throw new Error("That email address doesn't look right.");
  try {
    await smtpSend(s, to, subject, text);
    bump("email_sent");
  } catch (error) {
    bump("email_failed");
    throw error;
  }
}

/** "You're in" email after the owner approves someone. Never throws: approving must still work. */
export async function sendApprovalEmail(to: string, appUrl: string) {
  try {
    const s = await mailSetup();
    if (!s?.onApprove) return false;
    await sendMail(
      to,
      "You're in: Pod Hub",
      [
        "Hi,",
        "",
        "Your request to join Pod Hub was approved.",
        "",
        `Open ${appUrl} and sign in with your Eight Sleep account. You'll stay signed in on that device.`,
        "",
        "Tip: add it to your Home Screen so it opens like an app.",
        "",
        "Pod Hub is free and not affiliated with Eight Sleep.",
      ].join("\n"),
      s,
    );
    return true;
  } catch (error) {
    console.error("Approval email failed:", error instanceof Error ? error.message : error);
    return false;
  }
}
