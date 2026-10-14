import nodemailer, { type Transporter } from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    options: { host: string; port: number },
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: false,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/** Collects messages in memory. Used by tests and by `MAIL_TRANSPORT=memory`. */
export class MemoryMailer implements Mailer {
  readonly sent: EmailMessage[] = [];
  failNext = 0;

  async send(message: EmailMessage): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("Simulated SMTP failure");
    }
    this.sent.push(message);
  }
}

const globalForMail = globalThis as unknown as { __reservoMailer?: Mailer };

export function getMailer(): Mailer {
  if (!globalForMail.__reservoMailer) {
    globalForMail.__reservoMailer =
      process.env.MAIL_TRANSPORT === "memory"
        ? new MemoryMailer()
        : new SmtpMailer(
            {
              host: process.env.SMTP_HOST ?? "localhost",
              port: Number(process.env.SMTP_PORT ?? 1025),
            },
            process.env.EMAIL_FROM ?? "Reservo <no-reply@reservo.local>",
          );
  }
  return globalForMail.__reservoMailer;
}

/** Test hook. */
export function setMailer(mailer: Mailer): void {
  globalForMail.__reservoMailer = mailer;
}
