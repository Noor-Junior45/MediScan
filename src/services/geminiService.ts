import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ExtractedMedicine {
  name: string;
  dosage: string;
  expirationDate: string;
  usageInstructions?: string;
  quantity?: number;
}

export interface ExtractionResult {
  success: boolean;
  errorMessage?: string;
  warningMessage?: string;
  medicine?: ExtractedMedicine;
}

export async function extractMedicineData(base64Image: string): Promise<ExtractionResult> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image,
              },
            },
            {
              text: "Analyze this image for medicine details. If the image is blurry, poorly lit, or does not contain a readable medicine label, set 'success' to false and provide a specific 'errorMessage' (e.g., 'The image is too blurry. Please hold the camera steady.', 'Poor lighting. Please move to a brighter area.', 'No medicine label detected.'). If readable, set 'success' to true and extract the medicine name, dosage, quantity, expiration date, and usage instructions. IMPORTANT: Distinguish between Manufacturing Date (Mfg) and Expiration Date (Exp). Only return the Expiration Date. CRITICAL: If ONLY the medicine name is visible but other details (dosage, expiration date, etc.) are missing, STILL set 'success' to true. Extract the name, and use your general medical knowledge to fill in common usage instructions, typical dosage, and a placeholder expiration date (e.g., 1 year from now). Set 'warningMessage' to inform the user that some data was missing from the image and was inferred, and remind them to verify the expiration date manually.",
            },
          ],
        },
      ],
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
              },
              required: ["name", "dosage", "expirationDate"],
            }
          },
          required: ["success"],
        },
      },
    });

    const result = JSON.parse(response.text || "{}");
    return result as ExtractionResult;
  } catch (error) {
    console.error("Error extracting medicine data:", error);
    return {
      success: false,
      errorMessage: "An unexpected error occurred while communicating with the AI. Please try again."
    };
  }
}
