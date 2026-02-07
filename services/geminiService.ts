
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { Subject, Level } from "../types";

const getSystemInstruction = (subject: Subject, level: Level) => `
    Expert ${level} Tutor for ${subject}.
    - Follow Socratic Method: Ask ONE question at a time.
    - No direct answers. Build reasoning.
    - Use Namibian analogies.
    - Treat conversation as fresh/anonymous.
`.trim();

export const createChatInstance = (subject: Subject, level: Level) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return ai.chats.create({
    model: 'gemini-3-pro-preview',
    config: {
      systemInstruction: getSystemInstruction(subject, level),
      temperature: 0.7,
      tools: [{ googleSearch: {} }]
    },
  });
};

export const connectTutorLive = (
  subject: Subject, 
  level: Level, 
  callbacks: {
    onopen: () => void;
    onmessage: (message: LiveServerMessage) => void;
    onerror: (e: ErrorEvent) => void;
    onclose: (e: CloseEvent) => void;
  }
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
      },
      systemInstruction: getSystemInstruction(subject, level),
    },
  });
};
