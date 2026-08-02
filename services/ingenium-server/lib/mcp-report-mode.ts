/** Only the API-owned collector may opt into isolated report probe mode. */
export function isMcpReportMode(value: string | undefined): boolean {
  return value === "1";
}
