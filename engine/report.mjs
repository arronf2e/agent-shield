// reportHash: keccak256 of the canonical report (checkedAt excluded),
// ready to anchor on-chain via GuardRegistry.recordCheck(). Shared by the
// local server and the serverless functions so hashes always match.
import { ethers } from "ethers";

export function canonicalReport(report) {
  const { checkedAt, ...rest } = report;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

export function computeReportHash(report) {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalReport(report)));
}

export function withHash(report) {
  return { ...report, reportHash: computeReportHash(report) };
}
