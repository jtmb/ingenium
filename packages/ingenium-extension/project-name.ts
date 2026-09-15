export function isValidExtensionProjectName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 64
    && value === value.trim()
    && value !== "."
    && value !== ".."
    && !/[\u0000-\u001f\u007f\\/]/.test(value);
}
