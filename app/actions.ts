"use server";

import { GoogleGenAI } from "@google/genai";
import meetingMaterialPromptTemplate from "../prompts/meeting-material.md?raw";
import minutesPromptTemplate from "../prompts/minutes.md?raw";
import formatTranscriptPromptTemplate from "../prompts/format-transcript.md?raw";
import decisionSupportPromptTemplate from "../prompts/decision-support.md?raw";
import ritaGuidance from "../prompts/rita-guidance.md?raw";
import { buildProgressRiskReport, fetchLowRemainingBudgets, fetchOverdueIncompleteProjects, fetchOverdueOutsourcingContracts } from "./progress-risk";
import type { LowRemainingBudgetItem, OverdueIncompleteItem, OverdueOutsourcingItem, ProgressRiskReport } from "./risk-types";
import { deleteMeetingBundle, listStoredMeetings, loadMeetingBundle, saveMeetingBundle } from "./meeting-storage";
import type { DecisionCompletionTrend, DecisionSupportDraft, MeetingBundle } from "./meeting-types";
import { getChatGPTUser } from "./chatgpt-auth";
import type { Project, ProgressProject } from "./EarnedValueOverview";

const EARNED_VALUE_PROJECTS_URL = "https://overall-project-schedule-48.netlify.app/api/projects-data";
const EARNED_VALUE_PROGRESS_URL = "https://progress-dashboard-48.netlify.app/api/projects";

export async function getEarnedValueOverviewDataAction(): Promise<{ projects: Project[]; progress: ProgressProject[]; fetchedAt: string }> {
  await assertAuthorizedAction();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const [projectsResponse, progressResponse] = await Promise.all([
      fetch(EARNED_VALUE_PROJECTS_URL, { cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal }),
      fetch(EARNED_VALUE_PROGRESS_URL, { cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal }),
    ]);
    if (!projectsResponse.ok || !progressResponse.ok) throw new Error("取得元から出来高データを受信できませんでした。");
    const projectData = await projectsResponse.json() as Project[] | { projects?: Project[] };
    const progressData = await progressResponse.json() as ProgressProject[];
    const projects = Array.isArray(projectData) ? projectData : projectData.projects ?? [];
    const progress = Array.isArray(progressData) ? progressData : [];
    if (!projects.length) throw new Error("一覧表に表示できる業務データがありませんでした。");
    return { projects, progress, fetchedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("データ取得がタイムアウトしました。もう一度お試しください。");
    throw error instanceof Error ? error : new Error("出来高データを取得できませんでした。");
  } finally {
    clearTimeout(timeout);
  }
}

async function assertAuthorizedAction() {
  if (process.env.NODE_ENV !== "production") return;
  const user = await getChatGPTUser();
  if (!user) throw new Error("認証が必要です。");
  const configured = process.env.ALLOWED_AUTH_EMAILS || process.env.NEXT_PUBLIC_ALLOWED_AUTH_EMAILS || "";
  const allowed = configured.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes("*") && !allowed.includes(user.email.toLowerCase())) {
    throw new Error("この操作を行う権限がありません。");
  }
}

function fillPrompt(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (prompt, [key, value]) => prompt.replaceAll(`{{${key}}}`, value),
    template,
  );
}

export async function getProgressRiskReportAction(): Promise<ProgressRiskReport> {
  await assertAuthorizedAction();
  return buildProgressRiskReport();
}

export async function getLowRemainingBudgetsAction(): Promise<LowRemainingBudgetItem[]> {
  await assertAuthorizedAction();
  return fetchLowRemainingBudgets();
}

export async function getOverdueOutsourcingContractsAction(): Promise<OverdueOutsourcingItem[]> {
  await assertAuthorizedAction();
  return fetchOverdueOutsourcingContracts();
}

export async function getOverdueIncompleteProjectsAction(): Promise<OverdueIncompleteItem[]> {
  await assertAuthorizedAction();
  return fetchOverdueIncompleteProjects();
}

export async function saveMeetingBundleAction(bundle: MeetingBundle) {
  await assertAuthorizedAction();
  return saveMeetingBundle(bundle);
}

export async function deleteMeetingBundleAction(meetingId: string) {
  await assertAuthorizedAction();
  return deleteMeetingBundle(meetingId);
}

export async function loadMeetingBundleAction(meetingId: string) {
  await assertAuthorizedAction();
  return loadMeetingBundle(meetingId);
}

export async function listStoredMeetingsAction() {
  await assertAuthorizedAction();
  return listStoredMeetings();
}

export async function getDecisionCompletionTrendAction(): Promise<DecisionCompletionTrend[]> {
  await assertAuthorizedAction();
  const meetings = await listStoredMeetings();
  const bundles = await Promise.all(meetings.map((meeting) => loadMeetingBundle(meeting.id)));
  return bundles.flatMap((bundle) => {
    if (!bundle) return [];
    const eligible = bundle.agendaItems.filter((item) => item.decisionSupportVersion && item.detail.trim() && item.reviewStatus !== "判断しない" && (!item.decisionIssues?.length || item.decisionIssues.some((issue) => issue.reviewStatus !== "判断しない")));
    if (!eligible.length) return [];
    const completed = eligible.filter((item) =>
      item.reviewStatus === "本人確認済み" &&
      (item.decisionIssues?.length
        ? item.decisionIssues.filter((issue) => issue.reviewStatus !== "判断しない").every((issue) => issue.reviewStatus === "本人確認済み" && [issue.problem, issue.decision, issue.rationale, issue.meetingRequest].every((value) => value.trim()))
        : [item.problem, item.decision, item.rationale, item.meetingRequest].every((value) => value?.trim())),
    ).length;
    return [{
      meetingId: bundle.meetingId,
      meetingDate: bundle.meetingDate,
      completed,
      total: eligible.length,
      rate: Math.round((completed / eligible.length) * 100),
    }];
  });
}

export async function analyzeDecisionSupportAction(input: {
  detail: string;
  decisionIssues?: Array<{ id: string; problem: string; decision: string; rationale: string; meetingRequest: string }>;
}): Promise<DecisionSupportDraft> {
  await assertAuthorizedAction();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("AIの設定がありません。");

  const ai = new GoogleGenAI({ apiKey });
  const prompt = fillPrompt(decisionSupportPromptTemplate, {
    AGENDA_ITEM_JSON: JSON.stringify(input, null, 2),
  });

  const responseJsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["issues", "missingFields", "questions", "evidence"],
    properties: {
      issues: {
        type: "array", minItems: 1,
        items: {
          type: "object", additionalProperties: false,
          required: ["id", "problem", "decision", "rationale", "meetingRequest"],
          properties: {
            id: { type: "string", minLength: 1 },
            problem: { type: "string", minLength: 1 },
            decision: { type: "string", minLength: 1 },
            rationale: { type: "string", minLength: 1 },
            meetingRequest: { type: "string", minLength: 1 },
          },
        },
      },
      missingFields: { type: "array", items: { type: "string" } },
      questions: { type: "array", items: { type: "string" } },
      evidence: { type: "array", items: { type: "string" } },
    },
  };

  async function generate(contents: string): Promise<DecisionSupportDraft | null> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: { responseMimeType: "application/json", responseJsonSchema },
      });
      const parsed = JSON.parse(response.text || "{}");
      const draft: DecisionSupportDraft = {
        issues: Array.isArray(parsed.issues) ? parsed.issues.map((issue: any, index: number) => ({
          id: String(issue.id || `issue-${index + 1}`),
          problem: String(issue.problem || "").trim(),
          decision: String(issue.decision || "").trim(),
          rationale: String(issue.rationale || "").trim(),
          meetingRequest: String(issue.meetingRequest || "").trim(),
        })) : [],
        missingFields: [],
        questions: Array.isArray(parsed.questions) ? parsed.questions.map(String) : [],
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
      };
      return draft.issues.length > 0 && draft.issues.every((issue) =>
        [issue.problem, issue.decision, issue.rationale, issue.meetingRequest].every(Boolean),
      ) ? draft : null;
    } catch (error) {
      console.warn("Decision support response validation failed:", error);
      return null;
    }
  }

  const firstDraft = await generate(prompt);
  if (firstDraft) return firstDraft;

  const retryPrompt = `${prompt}\n\n## 再生成指示\n前回は問題の抽出または4項目の一部が不完全でした。元の報告に含まれるすべての問題をissuesへ分け、各問題のproblem、decision、rationale、meetingRequestを必ず具体的な文章で埋めてください。decisionは本人が修正する前提のAI提案として作成してください。`;
  const retryDraft = await generate(retryPrompt);
  if (retryDraft) return retryDraft;

  throw new Error("4項目を生成できませんでした。もう一度お試しください");
}

export async function generateMinutesAction(transcript: string, agenda: string): Promise<string> {
  await assertAuthorizedAction();
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = fillPrompt(minutesPromptTemplate, {
        AGENDA: agenda || "なし",
        TRANSCRIPT: transcript || "なし",
      });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });
      if (response.text) return response.text;
    } catch (error: any) {
      console.error("Gemini API Error (generateMinutes):", error);
    }
  }

  // Fallback minutes draft generation
  const dateStr = new Date().toLocaleDateString("ja-JP");
  return `【運営会議 議事録】（${dateStr}）

■ 議題・報告事項
${agenda || "・特記事項なし"}

■ 会議での主な発言・協議内容
${transcript || "・発言の記録なし"}

■ 決定事項・今後のアクション
・議題の内容に基づき、各担当者が業務を推進する。
・次回会議にて進捗を報告する。`;
}

export async function formatTranscriptAction(originalTranscript: string): Promise<string> {
  await assertAuthorizedAction();
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = fillPrompt(formatTranscriptPromptTemplate, {
        ORIGINAL_TRANSCRIPT: originalTranscript || "なし",
      });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });
      if (response.text) return response.text;
    } catch (error: any) {
      console.error("Gemini API Error (formatTranscript):", error);
    }
  }

  // Fallback formatted transcript
  const lines = originalTranscript.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return "（発言内容なし）";
  return lines.map((line, idx) => `・[発言 ${idx + 1}] ${line.trim()}`).join("\n");
}

function buildFallbackMeetingMaterial(agendaItems: Array<{
  department: string;
  name: string;
  detail: string;
  problem?: string;
  decision?: string;
  rationale?: string;
  meetingRequest?: string;
  reviewStatus?: string;
  decisionIssues?: Array<{ problem: string; decision: string; rationale: string; meetingRequest: string }>;
}>) {
  const itemsText = agendaItems.map((item) => {
    const issues = item.decisionIssues?.length ? item.decisionIssues : (item.problem ? [{ problem: item.problem, decision: item.decision || "", rationale: item.rationale || "", meetingRequest: item.meetingRequest || "" }] : []);
    const decisionBlock = item.reviewStatus === "本人確認済み" && issues.every((issue) =>
      [issue.problem, issue.decision, issue.rationale, issue.meetingRequest].every((value) => value.trim()))
      ? issues.map((issue) => `\n- 問題：${issue.problem}\n- 課長の判断：${issue.decision}\n- 判断理由：${issue.rationale}\n- 会議で確認したいこと：${issue.meetingRequest}`).join("")
      : "";
    return `### ■ ${item.department}（担当: ${item.name}）\n${item.detail.trim() || "（共有内容なし）"}${decisionBlock}`;
  }).join("\n\n");

  const meetingMaterial = `【運営会議 資料】\n\n${itemsText || "議題が登録されていません。"}`;
  
  const aiSuggestions = agendaItems.map((item) => {
    return `・${item.name}（${item.department}）: 共有内容の進捗確認および次週のアクションプラン策定を推奨します。`;
  }).join("\n");

  return { meetingMaterial, aiSuggestions };
}

export async function generateMeetingMaterialAction(
  agendaItems: Array<{
    department: string;
    name: string;
    detail: string;
    problem?: string;
    decision?: string;
    rationale?: string;
    meetingRequest?: string;
    reviewStatus?: string;
    decisionIssues?: Array<{ problem: string; decision: string; rationale: string; meetingRequest: string }>;
  }>
): Promise<{ meetingMaterial: string; aiSuggestions: string }> {
  await assertAuthorizedAction();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return buildFallbackMeetingMaterial(agendaItems);
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = fillPrompt(meetingMaterialPromptTemplate, {
    AGENDA_ITEMS_JSON: JSON.stringify(agendaItems, null, 2),
    RITA_GUIDANCE: ritaGuidance,
  });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text || "{}";
    const parsed = JSON.parse(text);

    return {
      meetingMaterial: parsed.meetingMaterial || buildFallbackMeetingMaterial(agendaItems).meetingMaterial,
      aiSuggestions: parsed.aiSuggestions || buildFallbackMeetingMaterial(agendaItems).aiSuggestions,
    };
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    return buildFallbackMeetingMaterial(agendaItems);
  }
}

export async function generateAiSuggestionsAction(
  agendaItems: Parameters<typeof generateMeetingMaterialAction>[0]
): Promise<string> {
  const result = await generateMeetingMaterialAction(agendaItems);
  return result.aiSuggestions;
}
