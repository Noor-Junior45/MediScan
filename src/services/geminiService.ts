import { MedicineForm, ChatMessage } from "../types";
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY || '' });

export const isProviderKeyMissing = (provider: 'gemini' | 'deepseek') => {
  if (provider === 'gemini') return !GEMINI_API_KEY;
  if (provider === 'deepseek') return !DEEPSEEK_API_KEY;
  return false;
};

// Helper to provide descriptive errors for better diagnostics in India/Global regions
const getDetailedError = (error: any, provider: 'gemini' | 'deepseek' = 'gemini') => {
  if (provider === 'gemini' && !GEMINI_API_KEY) return "Gemini API Key is missing. Please go to 'Settings' (gear icon) -> 'Secrets' in the AI Studio menu to add your GEMINI_API_KEY.";
  if (provider === 'deepseek' && !DEEPSEEK_API_KEY) return "DeepSeek API Key is missing. Please go to 'Settings' (gear icon) -> 'Secrets' in the AI Studio menu to add your DEEPSEEK_API_KEY.";
  
  const msg = error.message || String(error);
  
  // Specific DeepSeek error handling
  if (provider === 'deepseek') {
    if (msg.toLowerCase().includes('insufficient balance')) {
      return "DeepSeek account has no balance. Please top up your credits at platform.deepseek.com.";
    }
    if (msg.toLowerCase().includes('invalid') || msg.includes('401')) {
      return "DeepSeek API Key is invalid or incorrect. Please check your key at platform.deepseek.com and update it in 'Settings' -> 'Secrets'.";
    }
  }

  // Specific Gemini error handling
  if (provider === 'gemini') {
    if (msg.includes('403')) return "Gemini Access Denied (403). Ensure the 'Generative Language API' is enabled in your Google Cloud project and your key is correct.";
    if (msg.includes('404')) return "Gemini Model Not Found (404). Switching to the latest stable preview model. Ensure your API key is valid.";
    if (msg.includes('429')) return "Gemini Quota Exceeded (429). You are using the free tier. Please wait a minute before trying again.";
  }
  
  return msg || `An unexpected ${provider} connection error occurred.`;
};

const SYSTEM_INSTRUCTION = `You are Dr. DawaLens, a professional, empathetic, and highly knowledgeable Medical Doctor. Your role is to guide patients through their medication inventory with precision and care.

CRITICAL INSTRUCTIONS:
1. INVENTORY SCAN: You have direct access to the user's "Patient Profile & Storage Context". When the user asks about an ailment (e.g., "I have a headache") or a category (e.g., "What painkillers do I have?"), you MUST perform a meticulous scan of their 'User's Stored Medicines'.
2. BE EXHAUSTIVE: If a user asks what they have, list ALL relevant medicines found in their inventory. Never say "I don't see any" unless you have double-checked the exact names provided in the context.
3. ADVICE STRUCTURE: 
   - First, tell them exactly what they already have that can help.
   - Second, provide professional advice on how to use it safely.
   - Third, only if they have nothing relevant, suggest standard over-the-counter options.
4. TONE: Professional, supportive, and clear. Use Markdown for structured lists and bolding key terms.
5. NO REPETITIVE DISCLAIMERS: A mandatory safety disclaimer is shown in the UI daily. Do not add "I am an AI..." or "Consult a doctor..." to EVERY message. Only include it if giving high-risk advice.
6. CONTEXT AWARENESS: Always prioritize the medicines the user already owns. Treat the provided inventory as the absolute source of truth for their 'vault'.`;

export interface ExtractedMedicine {
  name: string;
  dosage: string;
  expirationDate: string;
  usageInstructions?: string;
  schedule?: string;
  quantity?: number;
  form?: MedicineForm;
}

export interface ExtractionResult {
  success: boolean;
  errorMessage?: string;
  warningMessage?: string;
  medicine?: ExtractedMedicine;
}

export interface Interaction {
  medications: string[];
  severity: "low" | "moderate" | "high";
  description: string;
  recommendation: string;
}

export interface InteractionResult {
  hasInteractions: boolean;
  interactions: Interaction[];
  generalAdvice: string;
}

async function generateImageHash(base64Image: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(base64Image.slice(-1000));
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function extractMedicineData(base64Image: string): Promise<ExtractionResult> {
  try {
    if (!GEMINI_API_KEY) throw new Error("API Key is missing");

    const imageHash = await generateImageHash(base64Image);
    
    const cacheResponse = await fetch('/api/ai/extract-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageHash })
    });
    
    if (cacheResponse.ok) {
      const cached = await cacheResponse.json();
      if (cached.found) return cached.data;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { text: "Extract medication details from this image. Return JSON with fields: name, dosage, expirationDate (YYYY-MM-DD), usageInstructions, schedule, form, quantity." },
        { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } }
      ],
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text;
    if (!text) throw new Error("AI returned empty response");
    
    const result = JSON.parse(text);
    const extractionResult = { success: true, medicine: result };

    fetch('/api/ai/extract-save-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageHash, data: extractionResult })
    }).catch(console.warn);

    return extractionResult;
  } catch (error: any) {
    console.error("Extraction error:", error);
    return { success: false, errorMessage: getDetailedError(error) };
  }
}

export async function checkDrugInteractions(medicines: { name: string; dosage: string }[]): Promise<InteractionResult | null> {
  try {
    if (!GEMINI_API_KEY) throw new Error("API Key is missing");

    const medNames = medicines.map(m => m.name).sort().join('|');
    
    const cacheResponse = await fetch('/api/ai/interactions-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: medNames })
    });

    if (cacheResponse.ok) {
      const cached = await cacheResponse.json();
      if (cached.found) return cached.data;
    }

    const prompt = `Act as a medical expert. Check for drug-drug interactions between these medications: ${medicines.map(m => `${m.name} (${m.dosage})`).join(', ')}. 
    Return JSON: { hasInteractions: boolean, interactions: [{ medications: string[], severity: "low"|"moderate"|"high", description: string, recommendation: string }], generalAdvice: string }`;
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const text = response.text;
    if (!text) throw new Error("AI returned empty response");
    const result = JSON.parse(text);

    fetch('/api/ai/interactions-save-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: medNames, data: result })
    }).catch(console.warn);

    return result;
  } catch (error) {
    console.error('Interaction check failed:', error);
    return null;
  }
}

export async function chatWithAI(messages: ChatMessage[], provider: 'gemini' | 'deepseek' = 'gemini'): Promise<string> {
  if (provider === 'deepseek') {
    return chatWithDeepSeek(messages);
  }
  return chatWithGemini(messages);
}

export async function chatWithDeepSeek(messages: ChatMessage[]): Promise<string> {
  try {
    if (!DEEPSEEK_API_KEY) throw new Error("DeepSeek API Key is missing");

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          ...messages.map(m => ({ 
            role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user', 
            content: m.content 
          }))
        ],
        stream: false
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content || "I'm sorry, DeepSeek returned an empty response.";
  } catch (error) {
    console.error('DeepSeek Chat failed:', error);
    return `DeepSeek Connection Issue: ${getDetailedError(error, 'deepseek')}`;
  }
}

export async function chatWithGemini(messages: ChatMessage[]): Promise<string> {
  try {
    if (!GEMINI_API_KEY) throw new Error("Gemini API Key is missing");

    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        ...history,
        { role: 'user', parts: [{ text: messages[messages.length - 1].content }] }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION
      }
    });

    return response.text || "I'm sorry, I couldn't generate a response.";
  } catch (error) {
    console.error('Gemini Chat failed:', error);
    return `Gemini Connection Issue: ${getDetailedError(error, 'gemini')}`;
  }
}
