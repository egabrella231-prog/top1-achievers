
import { GoogleGenAI, LiveServerMessage, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";
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
  // Check multiple possible locations for the API key
  const apiKey = process.env.GEMINI_API_KEY || 
                 process.env.VITE_GEMINI_API_KEY || 
                 (import.meta as any).env?.VITE_GEMINI_API_KEY;

  console.log("Initializing Chat Node [v1.2]. API Key Status:", 
    apiKey && apiKey !== 'undefined' && apiKey !== 'null' ? 
    "Present (Starts with " + apiKey.substring(0, 4) + ")" : "MISSING");
  
  if (!apiKey || apiKey === 'undefined' || apiKey === 'null' || apiKey === '') {
    throw new Error("API_KEY_MISSING");
  }
  
  if (!apiKey.startsWith("AIza")) {
    console.warn("Potential Invalid API Key format. Gemini keys usually start with 'AIza'. Found: " + apiKey.substring(0, 4) + "...");
  }

  const ai = new GoogleGenAI({ apiKey });
  return ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: getSystemInstruction(subject, level),
      temperature: 0.7,
      tools: [{ googleSearch: {} }],
      // Add safety settings to prevent over-filtering of educational content
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ]
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
  const apiKey = process.env.GEMINI_API_KEY || 
                 process.env.VITE_GEMINI_API_KEY || 
                 (import.meta as any).env?.VITE_GEMINI_API_KEY;

  if (!apiKey || apiKey === 'undefined' || apiKey === 'null' || apiKey === '') {
    throw new Error("API_KEY_MISSING");
  }
  const ai = new GoogleGenAI({ apiKey });
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
