// ---------------------------------------------------------------------------
// Intelligence module — export barrel
// ---------------------------------------------------------------------------

export * from "./types.js";
export {
  analyzeMonthlySummary,
  analyzeCashPosition,
  detectAnomalies,
  findUnclassifiedTransactions,
  analyzeDeferredBalance,
} from "./analyzer.js";
export {
  renderMonthlySummary,
  renderCashPosition,
  renderAnomalies,
  renderUnclassified,
  renderMonthlyRecognitionSummary,
  renderScheduleCompletion,
  renderLargeDeferredBalance,
} from "./renderer.js";
