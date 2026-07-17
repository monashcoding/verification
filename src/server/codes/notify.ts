// Discord notification for a ready-to-upload code batch (§9). Best-effort and
// injectable so the cron logic is testable without a live webhook. The ping
// names the event so the officer knows which event's Promote > Discounts > CSV
// upload page to paste it into.

export interface BatchNotification {
  eventName: string;
  eventSlug: string;
  count: number;
  csv: string;
}

export interface Notifier {
  notifyBatch(n: BatchNotification): Promise<void>;
}

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

/** Posts the CSV as a file attachment to a Discord webhook, if configured. */
export const discordNotifier: Notifier = {
  async notifyBatch(n: BatchNotification): Promise<void> {
    const content =
      `**Member discount codes ready — ${n.eventName}** (${n.count} codes)\n` +
      `Upload the attached CSV via this event's *Promote → Discounts → CSV upload* ` +
      `(slug: \`${n.eventSlug}\`). Do NOT use Global discount codes.`;

    if (!WEBHOOK_URL) {
      console.warn(`[notify] DISCORD_WEBHOOK_URL unset — would have pinged: ${content}`);
      return;
    }

    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content }));
    form.append(
      'files[0]',
      new Blob([n.csv], { type: 'text/csv' }),
      `codes-${n.eventSlug}.csv`,
    );

    const res = await fetch(WEBHOOK_URL, { method: 'POST', body: form });
    if (!res.ok) {
      throw new Error(`Discord webhook failed: ${res.status} ${await res.text()}`);
    }
  },
};
