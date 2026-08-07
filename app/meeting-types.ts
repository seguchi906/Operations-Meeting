import type { LowRemainingBudgetItem, OverdueIncompleteItem, OverdueOutsourcingItem, ProgressRiskReport } from "./risk-types";

export type StoredAgendaItem = {
  id: string;
  department: string;
  name: string;
  initials: string;
  detail: string;
  due: string;
  problem?: string;
  decision?: string;
  rationale?: string;
  meetingRequest?: string;
  reviewStatus?: "未整理" | "AI確認待ち" | "情報不足" | "本人確認済み";
  aiQuestions?: string[];
  confirmedAt?: string;
  decisionSupportVersion?: 1;
};

export type DecisionSupportDraft = {
  problem: string;
  decision: string;
  rationale: string;
  meetingRequest: string;
  missingFields: Array<"problem" | "decision" | "rationale" | "meetingRequest">;
  questions: string[];
  evidence: string[];
};

export type DecisionCompletionTrend = {
  meetingId: string;
  meetingDate: string;
  completed: number;
  total: number;
  rate: number;
};

export type MeetingBundle = {
  meetingId: string;
  meetingDate: string;
  status: "準備中" | "確定済み";
  agendaItems: StoredAgendaItem[];
  meetingMaterial: string;
  aiSuggestions: string;
  businessStatus: {
    lowBudgetItems: LowRemainingBudgetItem[] | null;
    overdueOutsourcingItems: OverdueOutsourcingItem[] | null;
    overdueIncompleteItems: OverdueIncompleteItem[] | null;
    riskReport: ProgressRiskReport | null;
  };
  transcript: {
    ai: string;
    original: string;
  };
  minutes: {
    aiDraft: string;
    final: string;
  };
  updatedAt?: string;
};
