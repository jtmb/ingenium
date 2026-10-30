/** Disk bytes ONLY. No disk-model/RAM conversion or invented live measurements.
 * Source constants are enforced output bounds, not measured runtime peaks. */
const fail = code => { throw new Error(code); };
const bytes = value => { if (!Number.isSafeInteger(value) || value < 0) fail('DISK_BYTE_FACT_REQUIRED'); return value; };
export function qualificationStoragePlan({ layouts, pipLayout, modelAssets, fixedRetainedQualificationBytes }) {
  if (!Array.isArray(layouts) || layouts.length !== 32 || !pipLayout?.expandedBytes || !Array.isArray(modelAssets) || modelAssets.length !== 6) fail('ACTUAL_VERIFIED_WHEEL_LAYOUT_REQUIRED_BEFORE_INSTALL');
  if (layouts.some(w => !w.metadataOnly || w.installed !== false)) fail('VERIFIED_ARCHIVE_LAYOUT_REQUIRED');
  const compressed = layouts.reduce((n, w) => n + bytes(w.compressedBytes), 0);
  const expanded = layouts.reduce((n, w) => n + bytes(w.expandedBytes), 0);
  const files = layouts.reduce((n, w) => n + bytes(w.files), 0), entryPoints = layouts.reduce((n, w) => n + bytes(w.entryPoints), 0);
  // Paths are capped at4096 UTF8 bytes;16KiB/file bounds regenerated CSV RECORD
  // path escaping/hash/decimal/line overhead.1MiB/dist bounds auxiliary metadata.
  // Script bound includes the ENTIRE exact pip payload plus its <=1MiB entry
  // declaration, intentionally exceeding any fixed pip launcher/template subset.
  const metadata = files * 16384 + layouts.length * 1048576;
  const scripts = entryPoints * (bytes(pipLayout.expandedBytes) + 1048576 + 4096);
  const installerGeneratedBound = metadata + scripts;
  const modelBytes = modelAssets.reduce((n, asset) => n + bytes(asset.bytes), 0);
  const durableMetadataBound = 1048576 + bytes(fixedRetainedQualificationBytes), captureBound = 8 * (2 * 262144 + 1048576);
  const stages = {
    wheelDownload: compressed + durableMetadataBound,
    installAndAudit: compressed + 2 * expanded + installerGeneratedBound + durableMetadataBound,
    sealedEnvironmentAndModels: expanded + installerGeneratedBound + modelBytes + durableMetadataBound,
    qualification: expanded + installerGeneratedBound + modelBytes + durableMetadataBound + captureBound,
  };
  if (!Object.values(stages).every(Number.isSafeInteger)) fail('DISK_PLAN_RANGE');
  return { version: 1, kind: 'conservative-disk-output-bound-not-RAM', compressed, expanded, installerGeneratedBound, modelBytes, stages,
    peakQualificationTreeBytes: Math.max(...Object.values(stages)), prerequisites: ['same-filesystem part/rename', 'pip wheel-only no-index no-deps no-compile', 'no full build/image/dependency copies', 'Root checks actual installed bytes do not exceed bound', 'remove eligible wheelhouse after audit before model stage'] };
}
export function additionalStageBytes(plan, stage, actualCurrentQualificationTreeBytes) {
  if (!Object.hasOwn(plan.stages, stage)) fail('DISK_STAGE_UNKNOWN');
  return Math.max(0, bytes(plan.stages[stage]) - bytes(actualCurrentQualificationTreeBytes));
}
export function requireStorageHeadroom({ windowsCFreeBytes, destinationFreeBytes, combinedOwnedBytes, remainingActiveReservationsBytes, stageAdditionalBytes }) {
  const reserve = 15 * 1024 ** 3, ceiling = 20 * 1024 ** 3;
  [windowsCFreeBytes, destinationFreeBytes, combinedOwnedBytes, remainingActiveReservationsBytes, stageAdditionalBytes].forEach(bytes);
  if (windowsCFreeBytes - stageAdditionalBytes < reserve || destinationFreeBytes - stageAdditionalBytes < reserve
    || combinedOwnedBytes + remainingActiveReservationsBytes + stageAdditionalBytes > ceiling) fail('EXISTING_PAIRED_ROOT_STORAGE_GUARD');
  return { sufficient: true, reserveBytes: reserve, ceilingBytes: ceiling };
}
