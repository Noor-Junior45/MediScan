import { MedicineForm, ChatMessage } from "../types";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
  const msgUint8 = new TextEncoder().encode(base64Image.slice(-1000)); // Use a slice for speed or full string for accuracy
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function extractMedicineData(base64Image: string): Promise<ExtractionResult> {
  try {
    const imageHash = await generateImageHash(base64Image);
    
    // 1. Check backend cache first using hash
    const cacheResponse = await fetch('/api/ai/extract-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageHash })
    });
    
    if (cacheResponse.ok) {
      const cached = await cacheResponse.json();
      if (cached.found) return cached.data;
    }

    // 2. Client-side AI extraction if not in cache
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        { text: "Extract medication details from this image. Return JSON with fields: name, dosage, expirationDate (YYYY-MM-DD), usageInstructions, schedule, form, quantity." },
        { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } }
      ],
      config: {
        responseMimeType: "application/json"
      }
    });

    const result = JSON.parse(response.text);
    const extractionResult = { success: true, medicine: result };

    // 3. Save to backend cache
    fetch('/api/ai/extract-save-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageHash, data: extractionResult })
    }).catch(console.warn);

    return extractionResult;
  } catch (error: any) {
    return { success: false, errorMessage: error.message || "Failed to extract data" };
  }
}

export async function checkDrugInteractions(medicines: { name: string; dosage: string }[]): Promise<InteractionResult | null> {
  try {
    const medNames = medicines.map(m => m.name).sort().join('|');
    
    // 1. Check backend cache
    const cacheResponse = await fetch('/api/ai/interactions-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: medNames })
    });

    if (cacheResponse.ok) {
      const cached = await cacheResponse.json();
      if (cached.found) return cached.data;
    }

    // 2. Client-side AI check
    const prompt = `Act as a medical expert. Check for drug-drug interactions between these medications: ${medicines.map(m => `${m.name} (${m.dosage})`).join(', ')}. 
    Return JSON: { hasInteractions: boolean, interactions: [{ medications: string[], severity: "low"|"moderate"|"high", description: string, recommendation: string }], generalAdvice: string }`;
    
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const result = JSON.parse(response.text);

    // 3. Save to backend cache
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
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        ...history,
        { role: 'user', parts: [{ text: messages[messages.length - 1].content }] }
      ],
      config: {
        systemInstruction: "You are a professional, empathetic, and knowledgeable Medical Doctor. Your goal is to provide clear, helpful, and safe advice regarding medications and general health. \n\nIMPORTANT: DO NOT include a typical medical disclaimer (like 'This is informational only') at the end of every message, as a mandatory daily disclaimer has already been shown to the user in the UI. Keep your answers concise and professional.\n\nYOUR BRAIN: You have direct access to the patient's current medication inventory provided in the conversation context. If a user asks for a recommendation (e.g., 'What can I take for a headache?'), scan their specific stored medicines first and tell them if they already have something matching (e.g., 'I see you have Paracetamol in your storage, which is effective for headaches'). Always prioritize medicines they already own before suggesting new ones. Use markdown formatting for clarity."
      }
    });

    return response.text;
  } catch (error) {
    console.error('Chat failed:', error);
    return "I'm having trouble connecting to my medical database. Please try again later.";
  }
}
