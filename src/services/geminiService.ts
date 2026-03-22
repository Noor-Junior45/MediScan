import { GoogleGenAI, Type } from "@google/genai";
import { MedicineForm } from "../types";

const ai = null; // Initialized inside function

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

export async function extractMedicineData(base64Image: string): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error("GEMINI_API_KEY is missing from environment");
    return {
      success: false,
      errorMessage: "AI service is not configured. Please ensure the Gemini API key is set in the environment variables."
    };
  }

  // Create a new instance right before the call as recommended
  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // Updated to the latest recommended model
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
          {
            text: "Analyze this image for medicine details. If readable, set 'success' to true and extract the medicine name, dosage, quantity, expiration date, usage instructions, and medication schedule (e.g., 'Twice a day', 'Every 8 hours'). Also identify the medicine form: 'tablet', 'capsule', 'syrup', 'ampule', 'powder', 'tape', 'liquid', or 'other'. IMPORTANT: Distinguish between Manufacturing Date (Mfg) and Expiration Date (Exp). Only return the Expiration Date. CRITICAL: If ONLY the medicine name is visible but other details (dosage, expiration date, etc.) are missing, STILL set 'success' to true. Extract the name, and use your general medical knowledge to fill in common usage instructions, typical dosage, a placeholder expiration date (e.g., 1 year from now), and a typical schedule. Set 'warningMessage' to inform the user that some data was missing from the image and was inferred, and remind them to verify the details manually.",
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            success: { type: Type.BOOLEAN, description: "True if medicine details were successfully extracted, false if unreadable." },
            errorMessage: { type: Type.STRING, description: "Specific feedback on why extraction failed (blurry, dark, etc.)" },
            warningMessage: { type: Type.STRING, description: "Warning if some data was inferred from general knowledge because it was missing from the image." },
            medicine: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "Name of the medicine" },
                dosage: { type: Type.STRING, description: "Dosage info (e.g., 500mg)" },
                quantity: { type: Type.NUMBER, description: "Quantity of medicine (e.g., 30 for 30 pills, 100 for 100ml). Return a number." },
                expirationDate: { type: Type.STRING, description: "Expiration date in YYYY-MM-DD format if possible, or as seen" },
                usageInstructions: { type: Type.STRING, description: "Usage instructions or notes" },
                schedule: { type: Type.STRING, description: "Medication schedule (e.g., 'Twice a day')" },
                form: { type: Type.STRING, description: "Medicine form: 'tablet', 'capsule', 'syrup', 'ampule', 'powder', 'tape', 'liquid', or 'other'" },
              },
              required: ["name", "dosage", "expirationDate"],
            }
          },
          required: ["success"],
        },
      },
    });

    if (!response.text) {
      throw new Error("The AI returned an empty response.");
    }

    let cleanText = response.text.trim();
    // Handle potential markdown wrapping even with JSON mime type
    if (cleanText.startsWith("```")) {
      cleanText = cleanText.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
    }

    const result = JSON.parse(cleanText);
    return result as ExtractionResult;
  } catch (error: any) {
    console.error("Detailed AI Extraction Error:", error);
    
    let userMessage = "An unexpected error occurred while communicating with the AI. Please try again.";
    
    if (error.message?.includes("API key not valid")) {
      userMessage = "The Gemini API key is invalid. Please check your configuration in the Secrets panel.";
    } else if (error.message?.includes("Requested entity was not found") || error.message?.includes("model not found")) {
      userMessage = "The AI model could not be reached or is unavailable in your region. Please try again later.";
    } else if (error.message?.includes("Quota exceeded") || error.message?.includes("429")) {
      userMessage = "AI usage limit reached. Please try again in a few minutes.";
    } else if (error instanceof SyntaxError) {
      userMessage = "Failed to parse the AI response. Please try capturing the image again with better lighting.";
    } else if (error.message?.includes("User location is not supported")) {
      userMessage = "The Gemini AI service is not available in your current location.";
    }

    return {
      success: false,
      errorMessage: userMessage
    };
  }
}

export interface InteractionResult {
  hasInteractions: boolean;
  interactions: {
    medications: string[];
    severity: "low" | "moderate" | "high";
    description: string;
    recommendation: string;
  }[];
  generalAdvice: string;
}

export async function checkDrugInteractions(medicines: { name: string; dosage: string }[]): Promise<InteractionResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || medicines.length < 2) return null;

  const ai = new GoogleGenAI({ apiKey });

  try {
    const medicineList = medicines.map(m => `${m.name} (${m.dosage})`).join(", ");
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze the following list of medications for potential drug-to-drug interactions: ${medicineList}. 
      Identify specific interactions between pairs or groups of medications. 
      For each interaction, provide the medications involved, the severity (low, moderate, high), a description of the interaction, and a recommendation. 
      Also provide a general advice summary for the user.
      If no interactions are found, set 'hasInteractions' to false and 'interactions' to an empty array.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            hasInteractions: { type: Type.BOOLEAN },
            interactions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  medications: { type: Type.ARRAY, items: { type: Type.STRING } },
                  severity: { type: Type.STRING, enum: ["low", "moderate", "high"] },
                  description: { type: Type.STRING },
                  recommendation: { type: Type.STRING },
                },
                required: ["medications", "severity", "description", "recommendation"],
              },
            },
            generalAdvice: { type: Type.STRING },
          },
          required: ["hasInteractions", "interactions", "generalAdvice"],
        },
      },
    });

    if (!response.text) return null;
    let cleanText = response.text.trim();
    if (cleanText.startsWith("```")) {
      cleanText = cleanText.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
    }
    return JSON.parse(cleanText) as InteractionResult;
  } catch (error) {
    console.error("Interaction Check Error:", error);
    return null;
  }
}
