import { MedicineForm, ChatMessage } from "../types";
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY || '' });

// Helper to provide descriptive errors for better diagnostics in India/Global regions
const getDetailedError = (error: any) => {
  if (!GEMINI_API_KEY) return "API Key is missing. Please set GEMINI_API_KEY in your deployment environment variables.";
  
  const msg = error.message || String(error);
  if (msg.includes('403')) return "Access Denied (403). Your API Key might be restricted, or the Generative Language API is not enabled for your project.";
  if (msg.includes('404')) return "Model Not Found (404). The AI engine is currently unavailable for this key/region. Please try a different API key.";
  if (msg.includes('429')) return "Quota Exceeded (429). Too many requests. Please wait a minute.";
  
  return msg || "An unexpected AI connection error occurred.";
};

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
      model: "gemini-1.5-flash-latest",
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
      model: "gemini-1.5-flash-latest",
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

export async function chatWithGemini(messages: ChatMessage[]): Promise<string> {
  try {
    if (!GEMINI_API_KEY) throw new Error("API Key is missing");

    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash-latest",
      contents: [
        ...history,
        { role: 'user', parts: [{ text: messages[messages.length - 1].content }] }
      ],
      config: {
        systemInstruction: "You are a professional, empathetic, and knowledgeable Medical Doctor. Your goal is to provide clear, helpful, and safe advice regarding medications and general health. \n\nIMPORTANT: DO NOT include a typical medical disclaimer (like 'This is informational only') at the end of every message, as a mandatory daily disclaimer has already been shown to the user in the UI. Keep your answers concise and professional.\n\nYOUR BRAIN: You have direct access to the patient's current medication inventory provided in the conversation context. If a user asks for a recommendation (e.g., 'What can I take for a headache?'), scan their specific stored medicines first and tell them if they already have something matching (e.g., 'I see you have Paracetamol in your storage, which is effective for headaches'). Always prioritize medicines they already own before suggesting new ones. Use markdown formatting for clarity."
      }
    });

    return response.text || "I'm sorry, I couldn't generate a response.";
  } catch (error) {
    console.error('Chat failed:', error);
    return `AI Connection Issue: ${getDetailedError(error)}`;
  }
}
