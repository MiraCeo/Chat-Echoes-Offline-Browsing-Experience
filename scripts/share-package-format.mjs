// 采集包的格式契约：扩展写、本地导入读。
// ZIP 里必须有 raw/share.html 与 capture.json；capture.json 的 format/version 用来握手，
// 旧版扩展没有这两个字段，按 legacy（version 0）接受。
export const CAPTURE_PACKAGE_FORMAT = 'ceobe.capture';
export const CAPTURE_PACKAGE_VERSION = 1;

export function validateCapturePackage(capture) {
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) throw new Error('capture.json 不是有效对象');
  const format = capture.format ?? null;
  if (format !== null && format !== CAPTURE_PACKAGE_FORMAT) {
    throw new Error(`不认识的采集包格式：${format}（需要 ${CAPTURE_PACKAGE_FORMAT}）`);
  }
  const version = capture.version ?? 0;
  if (!Number.isInteger(version) || version < 0) throw new Error('采集包版本无效：' + capture.version);
  if (version > CAPTURE_PACKAGE_VERSION) {
    throw new Error(`采集包版本 ${version} 高于本地支持的 ${CAPTURE_PACKAGE_VERSION}，请更新 CEOBE 或采集扩展`);
  }
  return { format: CAPTURE_PACKAGE_FORMAT, version, legacy: format === null && version === 0 };
}
