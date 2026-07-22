"use server";

import { GoogleGenAI } from "@google/genai";
import meetingMaterialPromptTemplate from "../prompts/meeting-material.md?raw";
import minutesPromptTemplate from "../prompts/minutes.md?raw";
import formatTranscriptPromptTemplate from "../prompts/format-transcript.md?raw";
import ritaGuidance from "../prompts/rita-guidance.md?raw";
import { buildProgressRiskReport, fetchLowRemainingBudgets, fetchOverdueIncompleteProjects, fetchOverdueOutsourcingContracts } from "./progress-risk";
import type { LowRemainingBudgetItem, OverdueIncompleteItem, OverdueOutsourcingItem, ProgressRiskReport } from "./risk-types";
import { listStoredMeetings, loadMeetingBundle, saveMeetingBundle } from "./meeting-storage";
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

export async function loadMeetingBundleAction(meetingId: string) {
  return loadMeetingBundle(meetingId);
}

export async function listStoredMeetingsAction() {
  return listStoredMeetings();
}

export async function generateMinutesAction(transcript: string, agenda: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Please configure it in your environment variables.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = fillPrompt(minutesPromptTemplate, {
    AGENDA: agenda || "なし",
    TRANSCRIPT: transcript || "なし",
  });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    return response.text || "議事録の生成に失敗しました。";
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    throw new Error(error.message || "Failed to generate minutes.");
  }
}

export async function formatTranscriptAction(originalTranscript: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Please configure it in your environment variables.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = fillPrompt(formatTranscriptPromptTemplate, {
    ORIGINAL_TRANSCRIPT: originalTranscript || "なし",
  });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    return response.text || "トランスクリプトの整形に失敗しました。";
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    throw new Error(error.message || "Failed to format transcript.");
  }
}

export async function generateMeetingMaterialAction(
  agendaItems: { department: string; name: string; detail: string }[]
): Promise<{ meetingMaterial: string; aiSuggestions: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
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
      meetingMaterial: parsed.meetingMaterial || "会議資料の生成に失敗しました。",
      aiSuggestions: parsed.aiSuggestions || "提案事項の生成に失敗しました。",
    };
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    throw new Error(error.message || "Failed to generate meeting material.");
  }
}

export async function generateAiSuggestionsAction(
  agendaItems: { department: string; name: string; detail: string }[]
): Promise<string> {
  const result = await generateMeetingMaterialAction(agendaItems);
  return result.aiSuggestions;
}
