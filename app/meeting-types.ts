import type { LowRemainingBudgetItem, OverdueIncompleteItem, OverdueOutsourcingItem, ProgressRiskReport } from "./risk-types";

export type StoredAgendaItem = {
  id: string;
  department: string;
  name: string;
  initials: string;
  detail: string;
  due: string;
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
