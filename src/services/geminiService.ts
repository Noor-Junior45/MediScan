import { GoogleGenAI, Type } from "@google/genai";
import { MedicineForm } from "../types";

const ai = null; // Initialized inside function

export interface ExtractedMedicine {
  name: string;
  dosage: string;
  expirationDate: string;
  usageInstructions?: string;
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
      model: "gemini-3-flash-preview", // Using Gemini 3 Flash as it's the recommended model for basic tasks
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
          {
            text: "Analyze this image for medicine details. If the image is blurry, poorly lit, or does not contain a readable medicine label, set 'success' to false and provide a specific 'errorMessage' (e.g., 'The image is too blurry. Please hold the camera steady.', 'Poor lighting. Please move to a brighter area.', 'No medicine label detected.'). If readable, set 'success' to true and extract the medicine name, dosage, quantity, expiration date, and usage instructions. Also identify the medicine form: 'tablet', 'capsule', 'syrup', 'ampule', 'powder', 'tape', 'liquid', or 'other'. IMPORTANT: Distinguish between Manufacturing Date (Mfg) and Expiration Date (Exp). Only return the Expiration Date. CRITICAL: If ONLY the medicine name is visible but other details (dosage, expiration date, etc.) are missing, STILL set 'success' to true. Extract the name, and use your general medical knowledge to fill in common usage instructions, typical dosage, and a placeholder expiration date (e.g., 1 year from now). Set 'warningMessage' to inform the user that some data was missing from the image and was inferred, and remind them to verify the expiration date manually.",
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
      userMessage = "The Gemini API key is invalid. Please check your configuration.";
    } else if (error.message?.includes("Requested entity was not found")) {
      userMessage = "The AI model could not be reached. Please try again later.";
    } else if (error.message?.includes("Quota exceeded")) {
      userMessage = "AI usage limit reached. Please try again in a few minutes.";
    } else if (error instanceof SyntaxError) {
      userMessage = "Failed to parse the AI response. Please try capturing the image again.";
    }

    return {
      success: false,
      errorMessage: userMessage
    };
  }
}
