"use server";

import { GoogleGenAI } from "@google/genai";
import meetingMaterialPromptTemplate from "../prompts/meeting-material.md?raw";
import minutesPromptTemplate from "../prompts/minutes.md?raw";
import formatTranscriptPromptTemplate from "../prompts/format-transcript.md?raw";
import ritaGuidance from "../prompts/rita-guidance.md?raw";
import { buildProgressRiskReport, fetchLowRemainingBudgets, fetchOverdueIncompleteProjects, fetchOverdueOutsourcingContracts } from "./progress-risk";
import type { LowRemainingBudgetItem, OverdueIncompleteItem, OverdueOutsourcingItem, ProgressRiskReport } from "./risk-types";
import { deleteMeetingBundle, listStoredMeetings, loadMeetingBundle, saveMeetingBundle } from "./meeting-storage";
import type { MeetingBundle } from "./meeting-types";

function fillPrompt(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (prompt, [key, value]) => prompt.replaceAll(`{{${key}}}`, value),
    template,
  );
}

export async function getProgressRiskReportAction(): Promise<ProgressRiskReport> {
  return buildProgressRiskReport();
}

export async function getLowRemainingBudgetsAction(): Promise<LowRemainingBudgetItem[]> {
  return fetchLowRemainingBudgets();
}

export async function getOverdueOutsourcingContractsAction(): Promise<OverdueOutsourcingItem[]> {
  return fetchOverdueOutsourcingContracts();
}

export async function getOverdueIncompleteProjectsAction(): Promise<OverdueIncompleteItem[]> {
  return fetchOverdueIncompleteProjects();
}

export async function saveMeetingBundleAction(bundle: MeetingBundle) {
  return saveMeetingBundle(bundle);
}

export async function deleteMeetingBundleAction(meetingId: string) {
  return deleteMeetingBundle(meetingId);
}

export async function loadMeetingBundleAction(meetingId: string) {
  return loadMeetingBundle(meetingId);
}

export async function listStoredMeetingsAction() {
  return listStoredMeetings();
}

export async function generateMinutesAction(transcript: string, agenda: string): Promise<string> {
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

function buildFallbackMeetingMaterial(agendaItems: { department: string; name: string; detail: string }[]) {
  const itemsText = agendaItems.map((item) => {
    return `### ■ ${item.department}（担当: ${item.name}）\n${item.detail.trim() || "（共有内容なし）"}`;
  }).join("\n\n");

  const meetingMaterial = `【運営会議 資料】\n\n${itemsText || "議題が登録されていません。"}`;
  
  const aiSuggestions = agendaItems.map((item) => {
    return `・${item.name}（${item.department}）: 共有内容の進捗確認および次週のアクションプラン策定を推奨します。`;
  }).join("\n");

  return { meetingMaterial, aiSuggestions };
}

export async function generateMeetingMaterialAction(
  agendaItems: { department: string; name: string; detail: string }[]
): Promise<{ meetingMaterial: string; aiSuggestions: string }> {
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
  agendaItems: { department: string; name: string; detail: string }[]
): Promise<string> {
  const result = await generateMeetingMaterialAction(agendaItems);
  return result.aiSuggestions;
}
