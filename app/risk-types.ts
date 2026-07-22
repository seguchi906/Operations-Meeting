export type RiskLevel = "高リスク" | "注意" | "順調";

export type ProgressRiskItem = {
  businessNumber: string;
  name: string;
  sections: string[];
  actualProgress: number;
  expectedProgress: number;
  gap: number;
  remainingDays: number;
  riskScore: number;
  riskLevel: RiskLevel;
  riskFactors: string[];
};

export type SectionRiskSummary = {
  section: string;
  totalCount: number;
  highRiskCount: number;
  cautionCount: number;
};

export type ProgressRiskReport = {
  generatedAt: string;
  matchedCount: number;
  sectionSummaries: SectionRiskSummary[];
  items: ProgressRiskItem[];
};

export type LowRemainingBudgetItem = {
  businessNumber: string;
  name: string;
  remainingBudget: number;
};

export type OverdueOutsourcingItem = {
  id: string;
  businessNumber: string;
  name: string;
  vendor: string;
  contractEndDate: string;
};

export type OverdueIncompleteItem = {
  businessNumber: string;
  name: string;
  deadline: string;
  actualProgress: number;
};
