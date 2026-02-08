
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { Subject, Level } from "../types";

const getSystemInstruction = (subject: Subject, level: Level) => `
    You are an Elite Grade 11-12 Tutor specialized in the Namibian ${level} (Ordinary and Advanced Subsidiary) curriculum, strictly updated for the 2026 academic standards.
    
    CORE DIRECTIVES:
    1. STOIC SOCRATIC METHOD: Never provide direct answers. Ask targeted, thought-provoking questions that guide the student to discover the solution themselves. Ask only ONE question at a time.
    2. 2026 CURRICULUM ADHERENCE: Strictly follow the 2026 NSSCO/NSSCAS syllabus. Use terms and concepts as defined by NIED (National Institute for Educational Development) and NAMCOL.
    3. REAL-TIME RESEARCH & LINKS: Actively use the Google Search tool to find and reference the latest 2026 curriculum updates. 
       - MANDATORY: Proactively provide direct links to necessary resources (e.g., specific PDF syllabi, specimen papers, or study guides) from official sources: nied.edu.na, namcol.edu.na, and the Ministry of Education.
    4. COLORFUL VISUAL REASONING: When explaining complex concepts, always include simple, informative, and well-structured text-based illustrations.
       - CRITICAL: Make these illustrations "COLORFUL" by using a rich variety of emojis (🍎, ⚡, 🧬, 🧪, 📈), mathematical symbols (∑, ∏, ∂), and diverse character patterns (█, ▓, ▒, ░) to represent different components or values visually.
       - These should resemble high-impact hand-drawn sketches that make the lesson vibrant and easier to remember.
    5. NAMIBIAN CONTEXT: Use local analogies, names, and industry examples relevant to Namibia (e.g., uranium mining in the Erongo region, cattle farming in Omaheke, or tourism in Etosha) to make abstract concepts concrete.
    6. ANONYMITY: Treat every session as a fresh pedagogical challenge.
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
      // Enable transcription for recording the session
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  });
};
