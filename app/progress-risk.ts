import type { LowRemainingBudgetItem, OverdueIncompleteItem, OverdueOutsourcingItem, ProgressRiskItem, ProgressRiskReport, RiskLevel } from "./risk-types";

const SECTIONS = ["1課", "2課", "3課"];
const isBrowser = typeof window !== "undefined";
const OVERALL_PROJECT_SCHEDULE_URL = isBrowser ? "/upstream/overall" : "https://overall-project-schedule-48.netlify.app";
const PROGRESS_DASHBOARD_URL = isBrowser ? "/upstream/progress" : "https://progress-dashboard-48.netlify.app";
const EARNED_VALUE_DASHBOARD_URL = isBrowser ? "/upstream/earned-value" : "https://earned-value-dashboard-48.netlify.app";
const OUTSOURCING_MANAGEMENT_URL = isBrowser ? "/upstream/outsourcing" : "https://outsourcing-management-combined.netlify.app";

function clampProgress(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0;
}

function latestProgress(values: unknown): number | null {
  if (!Array.isArray(values)) return null;
  for (let index = values.length - 1; index >= 0; index--) {
    if (values[index] !== null && values[index] !== "") return clampProgress(values[index]);
  }
  return null;
}

function responsibleSections(project: Record<string, unknown>) {
  if (Array.isArray(project.responsibleSections)) {
    return SECTIONS.filter((section) => project.responsibleSections?.includes(section));
  }
  const legacy = String(project.responsibleDept ?? "");
  return SECTIONS.filter((section) => legacy.includes(section));
}

function parseDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function countWeekdays(start: Date, end: Date) {
  if (end <= start) return 0;
  let count = 0;
  const date = new Date(start);
  while (date < end) {
    if (date.getDay() !== 0 && date.getDay() !== 6) count++;
    date.setDate(date.getDate() + 1);
  }
  return count;
}

function weekdayDifference(end: Date, start: Date) {
  if (end.getTime() === start.getTime()) return 0;
  return end > start ? countWeekdays(start, end) : -countWeekdays(end, start);
}

function scheduleInputs(project: Record<string, unknown>, today: Date) {
  const start = parseDate(project.originalStartDate ?? project.startDate);
  const mainEnd = parseDate(project.revisedEndDate ?? project.originalEndDate ?? project.endDate);
  const completionTarget = parseDate(project.completionTargetDate);
  const effectiveEnd = mainEnd && mainEnd <= today && completionTarget ? completionTarget : mainEnd;
  const elapsedDays = start ? Math.max(0, weekdayDifference(today, start)) : 0;
  const totalDays = start && effectiveEnd
    ? Math.max(1, weekdayDifference(effectiveEnd, start))
    : Math.max(1, elapsedDays + 1);
  const remainingDays = effectiveEnd ? weekdayDifference(effectiveEnd, today) : 99999;
  return {
    elapsedDays,
    totalDays,
    remainingDays,
    contractAmount: Number(project.contractAmount ?? 0),
    outsourceCost: Number(project.outsourcingAmount ?? project.outsourceCost ?? 0),
  };
}

function calculateRisk(actualProgress: number, schedule: ReturnType<typeof scheduleInputs>) {
  let riskScore = 0;
  const riskFactors: string[] = [];
  const expectedProgress = Math.min(100, (schedule.elapsedDays / schedule.totalDays) * 100);
  const requiredSpeed = (100 - actualProgress) / Math.max(schedule.remainingDays, 1);
  const outsourceRate = schedule.outsourceCost / Math.max(schedule.contractAmount, 1);

  if (actualProgress < expectedProgress - 10) {
    riskScore += 2;
    riskFactors.push(`工期に対して進捗が遅れています（実績 ${actualProgress.toFixed(1)}%／期待 ${expectedProgress.toFixed(1)}%）`);
  }
  if (schedule.remainingDays < 7 && actualProgress < 80) {
    riskScore += 2;
    riskFactors.push("残り期間が短く、進捗が不足しています");
  }
  if (requiredSpeed > 5) {
    riskScore += 2;
    riskFactors.push(`必要進捗スピードが高い状態です（${requiredSpeed.toFixed(1)}%/日）`);
  } else if (requiredSpeed > 3) {
    riskScore += 1;
    riskFactors.push(`必要進捗スピードに注意が必要です（${requiredSpeed.toFixed(1)}%/日）`);
  }
  if (outsourceRate > 0.6) {
    if (actualProgress < 70) {
      riskScore -= 1;
      riskFactors.push("外注活用による進捗加速を見込んでいます");
    } else {
      riskScore += 2;
      riskFactors.push("終盤で外注依存が高い状態です");
    }
  }

  riskScore = Math.max(0, riskScore);
  const riskLevel: RiskLevel = riskScore >= 4 ? "高リスク" : riskScore >= 2 ? "注意" : "順調";
  return { riskScore, riskLevel, riskFactors, expectedProgress };
}

export async function buildProgressRiskReport(): Promise<ProgressRiskReport> {
  const projectsRequest = fetch(`${OVERALL_PROJECT_SCHEDULE_URL}/api/projects-data`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`案件データを取得できませんでした（HTTP ${response.status}）`);
      const body = await response.json() as { projects?: Record<string, unknown>[] };
      if (!Array.isArray(body.projects)) throw new Error("案件データの形式が正しくありません。");
      return body.projects;
    });

  const progressRequest = fetch(`${PROGRESS_DASHBOARD_URL}/api/projects`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`実績進捗データを取得できませんでした（HTTP ${response.status}）`);
      const body = await response.json() as Record<string, unknown>[];
      if (!Array.isArray(body)) throw new Error("実績進捗データの形式が正しくありません。");
      return body;
    });

  const [projects, progressProjects] = await Promise.all([projectsRequest, progressRequest]);
  const progressMap = new Map<string, number>();
  for (const project of progressProjects) {
    const id = project.id ?? project.number;
    const progress = latestProgress(project.weeklyProgress ?? project.wp);
    if (id != null && progress != null) progressMap.set(String(id), progress);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const items: ProgressRiskItem[] = [];

  for (const project of projects) {
    const businessNumber = String(project.number ?? "");
    const actualProgress = progressMap.get(businessNumber);
    if (actualProgress == null || actualProgress >= 100) continue;
    const sections = responsibleSections(project);
    const schedule = scheduleInputs(project, today);
    const result = calculateRisk(actualProgress, schedule);
    items.push({
      businessNumber,
      name: String(project.name ?? "名称未設定"),
      sections,
      actualProgress,
      expectedProgress: result.expectedProgress,
      gap: actualProgress - result.expectedProgress,
      remainingDays: schedule.remainingDays,
      riskScore: result.riskScore,
      riskLevel: result.riskLevel,
      riskFactors: result.riskFactors,
    });
  }

  items.sort((a, b) => b.riskScore - a.riskScore || a.remainingDays - b.remainingDays);
  const sectionSummaries = SECTIONS.map((section) => {
    const sectionItems = items.filter((item) => item.sections.includes(section));
    return {
      section,
      totalCount: sectionItems.length,
      highRiskCount: sectionItems.filter((item) => item.riskLevel === "高リスク").length,
      cautionCount: sectionItems.filter((item) => item.riskLevel === "注意").length,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    matchedCount: items.length,
    sectionSummaries,
    items: items.filter((item) => item.riskLevel !== "順調").slice(0, 25),
  };
}

export async function fetchLowRemainingBudgets(): Promise<LowRemainingBudgetItem[]> {
  const [budgetResponse, projectsResponse] = await Promise.all([
    fetch(`${EARNED_VALUE_DASHBOARD_URL}/api/remaining-budget`, { cache: "no-store" }),
    fetch(`${EARNED_VALUE_DASHBOARD_URL}/api/projects-data`, { cache: "no-store" }),
  ]);

  if (!budgetResponse.ok) throw new Error(`残予算を取得できませんでした（HTTP ${budgetResponse.status}）`);
  if (!projectsResponse.ok) throw new Error(`業務名を取得できませんでした（HTTP ${projectsResponse.status}）`);

  const budgets = await budgetResponse.json() as Record<string, unknown>;
  const projectData = await projectsResponse.json() as { projects?: Record<string, unknown>[] };
  const names = new Map(
    (projectData.projects ?? []).map((project) => [String(project.number ?? "").trim(), String(project.name ?? "名称未設定")]),
  );

  return Object.entries(budgets)
    .map(([businessNumber, value]) => ({
      businessNumber,
      name: names.get(businessNumber) ?? "名称未設定",
      remainingBudget: Number(value),
    }))
    .filter((item) => Number.isFinite(item.remainingBudget) && item.remainingBudget < 500_000)
    .sort((a, b) => a.remainingBudget - b.remainingBudget);
}

export async function fetchOverdueOutsourcingContracts(): Promise<OverdueOutsourcingItem[]> {
  const response = await fetch(`${OUTSOURCING_MANAGEMENT_URL}/api/records`, { cache: "no-store" });
  if (!response.ok) throw new Error(`外注契約を取得できませんでした（HTTP ${response.status}）`);
  const records = await response.json() as Record<string, unknown>[];
  if (!Array.isArray(records)) throw new Error("外注契約データの形式が正しくありません。");

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return records.flatMap((record) => {
    const versions = Array.isArray(record.versions) ? record.versions as Record<string, unknown>[] : [];
    const latest = [...versions].reverse().find((version) =>
      version.amount || version.startDate || version.endDate || version.appDate,
    ) ?? versions[0] ?? {};
    const contractEndDate = String(latest.endDate ?? "").slice(0, 10);
    const confirmationReceiptDate = String(record.receiveDate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(contractEndDate) || contractEndDate >= today || confirmationReceiptDate) return [];
    return [{
      id: String(record.id ?? `${record.jobNo ?? ""}-${record.company ?? ""}-${contractEndDate}`),
      businessNumber: String(record.jobNo ?? ""),
      name: String(record.workName ?? record.jobNo ?? "名称未設定"),
      vendor: String(record.company ?? "外注先未設定"),
      contractEndDate,
    }];
  }).sort((a, b) => a.contractEndDate.localeCompare(b.contractEndDate));
}

export async function fetchOverdueIncompleteProjects(): Promise<OverdueIncompleteItem[]> {
  const [projectsResponse, progressResponse] = await Promise.all([
    fetch(`${OVERALL_PROJECT_SCHEDULE_URL}/api/projects-data`, { cache: "no-store" }),
    fetch(`${PROGRESS_DASHBOARD_URL}/api/projects`, { cache: "no-store" }),
  ]);
  if (!projectsResponse.ok) throw new Error(`全体工程表を取得できませんでした（HTTP ${projectsResponse.status}）`);
  if (!progressResponse.ok) throw new Error(`実績進捗を取得できませんでした（HTTP ${progressResponse.status}）`);
  const projectData = await projectsResponse.json() as { projects?: Record<string, unknown>[] };
  const progressData = await progressResponse.json() as Record<string, unknown>[];
  if (!Array.isArray(projectData.projects) || !Array.isArray(progressData)) throw new Error("工程・進捗データの形式が正しくありません。");

  const progressMap = new Map<string, number>();
  for (const item of progressData) {
    const id = item.id ?? item.number;
    const progress = latestProgress(item.weeklyProgress ?? item.wp);
    if (id != null && progress != null) progressMap.set(String(id), progress);
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  return projectData.projects.flatMap((project) => {
    const businessNumber = String(project.number ?? "");
    const actualProgress = progressMap.get(businessNumber);
    const mainEnd = String(project.revisedEndDate ?? project.originalEndDate ?? project.endDate ?? "").slice(0, 10);
    const target = String(project.completionTargetDate ?? "").slice(0, 10);
    const deadline = target || mainEnd;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || deadline >= today || actualProgress == null || actualProgress >= 100) return [];
    return [{ businessNumber, name: String(project.name ?? "名称未設定"), deadline, actualProgress }];
  }).sort((a, b) => a.deadline.localeCompare(b.deadline));
}
