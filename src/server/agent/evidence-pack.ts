import "server-only";
import type { Job } from "@/shared/contracts";
import { getDb, type ProofPayDb } from "@/server/db/client";
import { getJob, listEvidence } from "@/server/db/repo";
import { NotFoundError } from "@/server/http/errors";
import { getOrderState, type OrderState } from "./paypal-toolkit";

/**
 * Deterministic Markdown evidence pack for reviewers and PayPal disputes:
 * job, checklist, AI verdicts with boxes, forensics, photo metadata,
 * timeline and PayPal ids. The same job state always gives the same text.
 */

export type EvidencePackDeps = { getOrderState?: (orderId: string) => Promise<OrderState> };

const cell = (value: string | number | undefined | null): string =>
  String(value ?? "—")
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim() || "—";

const money = (amount: { currency: string; value: string } | undefined): string =>
  amount ? `${amount.value} ${amount.currency}` : "—";

function table(headers: string[], rows: Array<Array<string | number | undefined | null>>): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
}

function describeEvent(event: Job["events"][number]): string {
  const data = typeof event.data === "object" && event.data !== null ? (event.data as Record<string, unknown>) : {};
  if (event.type === "STATUS_CHANGED") return `${event.fromStatus ?? "—"} → ${event.toStatus ?? "—"}`;
  const parts = ["op", "decision", "kind", "status", "issue", "reason", "notes", "proposalId"]
    .filter((key) => typeof data[key] === "string" && data[key] !== "")
    .map((key) => `${key}: ${String(data[key])}`);
  return parts.join("; ");
}

export async function buildEvidencePack(
  jobId: string,
  db: ProofPayDb = getDb(),
  deps: EvidencePackDeps = {},
): Promise<string> {
  const job = getJob(jobId, db);
  if (!job) throw new NotFoundError("Job");
  const evidence = listEvidence(jobId, db);
  const verification = job.latestVerification;
  const payment = job.payment;
  const order = payment?.orderId
    ? await (deps.getOrderState ?? getOrderState)(payment.orderId)
    : undefined;

  const lines: string[] = [
    `# ProofPay evidence pack: ${job.title}`,
    "",
    "Sandbox demo. Generated from the ProofPay audit log; AI verdicts are advisory and a human approved any money movement.",
    "",
    "## Job",
    "",
    `- Job id: \`${job.id}\``,
    `- Category: ${job.category}`,
    `- Description: ${cell(job.description)}`,
    `- Amount: ${money(job.amount)}`,
    `- Status: **${job.status}**`,
    `- Created: ${job.createdAt}`,
    `- Liveness code: ${job.livenessCode ?? "—"}`,
    "",
    "## PayPal",
    "",
  ];
  if (payment) {
    lines.push(
      `- Order id: \`${payment.orderId ?? "—"}\``,
      `- Order status (PayPal Agent Toolkit \`get_order\`${order?.source === "mock" ? ", mock" : ""}): ${order?.status ?? "—"}`,
      `- Authorization id: \`${payment.authorizationId ?? "—"}\` (${payment.authorizationStatus ?? "—"})`,
      `- Held by PayPal: ${money(payment.authorized)}; hold valid until ${payment.expiresAt ?? "—"}`,
      `- Captured: ${money(payment.captured)}; capture ids: ${payment.captureIds.length ? payment.captureIds.map((id) => `\`${id}\``).join(", ") : "—"}`,
      `- Refunded: ${money(payment.refunded)}`,
    );
  } else {
    lines.push("- No PayPal payment has been authorized for this job.");
  }

  lines.push("", "## Checklist", "");
  lines.push(
    ...table(
      ["Id", "Criterion", "Required", "Weight"],
      job.criteria.map((c) => [c.id, c.label, c.required ? "yes" : "no", c.weight.toFixed(3)]),
    ),
  );

  lines.push("", "## AI verification", "");
  if (verification) {
    const { report, decision, forensics } = verification;
    lines.push(
      `- Verification id: \`${verification.id}\` (attempt ${verification.attempt}, model ${verification.model}${verification.mock ? ", mock" : ""})`,
      `- Outcome: **${decision.outcome}**, score ${Math.round(decision.score * 100)}%${decision.captureAmount ? `, capture amount ${money(decision.captureAmount)}` : ""}`,
      `- Reasons: ${decision.reasons.length ? decision.reasons.map(cell).join("; ") : "—"}`,
      `- Same scene: ${report.sameScene.verdict} (${report.sameScene.confidence.toFixed(2)})`,
      `- Liveness code read: ${report.livenessCode.found ? (report.livenessCode.readValue ?? "found") : "not found"}`,
      `- Image quality: ${report.imageQualityIssues.join(", ") || "—"}`,
      `- Summary: ${cell(report.summary)}`,
      "",
      ...table(
        ["Criterion", "Verdict", "Confidence", "Rationale", "Evidence boxes [ymin,xmin,ymax,xmax]/1000"],
        job.criteria.map((criterion) => {
          const verdict = report.verdicts.find((v) => v.criterionId === criterion.id);
          return [
            criterion.id,
            verdict?.verdict ?? "NOT_VISIBLE",
            verdict ? verdict.confidence.toFixed(2) : "0.00",
            verdict?.rationale,
            verdict?.evidence.map((box) => `${box.imageId} [${box.box_2d.join(",")}]`).join("; "),
          ];
        }),
      ),
      "",
      "## Forensics",
      "",
    );
    if (forensics.flags.length) {
      lines.push(
        ...table(
          ["Level", "Code", "Message", "Evidence"],
          forensics.flags.map((flag) => [flag.level, flag.code, flag.message, flag.evidenceIds.join(", ")]),
        ),
      );
    } else {
      lines.push("No forensics flags.");
    }
  } else {
    lines.push("No verification has run yet.");
  }

  lines.push("", "## Photos", "");
  if (evidence.length) {
    const counters = { before: 0, after: 0 };
    lines.push(
      ...table(
        ["Image", "Phase", "File", "Size", "EXIF taken at", "SHA-256", "dHash"],
        evidence.map((item) => {
          counters[item.phase] += 1;
          return [
            `${item.phase === "before" ? "B" : "A"}${counters[item.phase]}`,
            item.phase,
            item.url,
            `${item.width}×${item.height}`,
            item.exifTakenAt ?? "missing",
            item.sha256,
            item.dhash,
          ];
        }),
      ),
    );
  } else {
    lines.push("No photos uploaded.");
  }

  lines.push("", "## Timeline", "");
  lines.push(
    ...table(
      ["#", "Time (UTC)", "Actor", "Event", "Detail"],
      job.events.map((event, index) => [index + 1, event.createdAt, event.actor, event.type, describeEvent(event)]),
    ),
  );
  lines.push("");
  return lines.join("\n");
}
