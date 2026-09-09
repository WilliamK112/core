/**
 * Short, human-first review renderer for callers who need the highest-signal
 * findings without the full Markdown report.
 */

import type { FindingsArtifact, Finding, Severity } from "../schemas/findings.js";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

export const DEFAULT_SUMMARY_TOP = 5;

export interface SummaryReportOptions {
  /** Maximum number of findings to render. */
  top?: number;
  /** Configured severity-gate threshold. `none` includes every undismissed finding. */
  failOn?: Severity | "none";
  /** JSON artifact path to surface after the short report. */
  artifactPath?: string;
}

export function renderSummaryReport(
  artifact: FindingsArtifact,
  options: SummaryReportOptions = {},
): string {
  const top = options.top ?? DEFAULT_SUMMARY_TOP;
  if (!Number.isSafeInteger(top) || top <= 0) {
    throw new RangeError("Summary top limit must be a positive integer");
  }

  const failOn = options.failOn ?? "high";
  const findings = artifact.findings
    .filter((finding) => needsAttention(finding, failOn))
    .sort(compareFindings);

  const count = findings.length;
  const header = count === 1
    ? "1 finding needs your eyes"
    : `${count} findings need your eyes`;
  const lines = [header];

  for (const finding of findings.slice(0, top)) {
    lines.push(formatFinding(finding));
  }

  const remaining = count - top;
  if (remaining > 0) {
    lines.push(`… ${remaining} more ${remaining === 1 ? "finding" : "findings"} not shown.`);
  }

  if (options.artifactPath) {
    lines.push(`Full artifact: ${options.artifactPath}`);
  }

  return lines.join("\n");
}

function needsAttention(finding: Finding, failOn: Severity | "none"): boolean {
  if (finding.dismissed) return false;
  if (failOn === "none") return true;

  return SEVERITY_ORDER.indexOf(finding.severity) <= SEVERITY_ORDER.indexOf(failOn);
}

function compareFindings(a: Finding, b: Finding): number {
  const severityDifference = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
  if (severityDifference !== 0) return severityDifference;

  const aFile = a.evidence.file || "\uffff";
  const bFile = b.evidence.file || "\uffff";
  const fileDifference = aFile < bFile ? -1 : aFile > bFile ? 1 : 0;
  if (fileDifference !== 0) return fileDifference;

  const lineDifference = a.evidence.line_start - b.evidence.line_start;
  if (lineDifference !== 0) return lineDifference;

  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

function formatFinding(finding: Finding): string {
  const severity = finding.severity.toUpperCase();
  const location = formatLocation(finding);
  const message = finding.title.replace(/\s+/g, " ").trim();
  return `${severity} · ${location} · ${finding.category} · ${message}`;
}

function formatLocation(finding: Finding): string {
  const file = finding.evidence.file;
  if (!file) return "(no location)";

  const start = finding.evidence.line_start;
  const end = finding.evidence.line_end;
  if (start <= 0) return file;
  if (end > start) return `${file}:${start}-${end}`;
  return `${file}:${start}`;
}
