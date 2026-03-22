export interface MedicineHistory {
  id: string;
  medicineId: string;
  userId: string;
  timestamp: number;
  actionType: 'CREATE' | 'EDIT' | 'MARK_TAKEN' | 'MARK_NOT_TAKEN' | 'DELETE';
  details: string;
}

export type MedicineForm = 'tablet' | 'capsule' | 'syrup' | 'ampule' | 'powder' | 'tape' | 'liquid' | 'other';

export interface Medicine {
  id: string;
  name: string;
  dosage: string;
  expirationDate: string;
  usageInstructions: string;
  schedule?: string; // New field for medication schedule
  createdAt: number;
  capturedImage?: string; // Keep for backward compatibility or temporary storage
  imageUrl?: string; // New field for Firebase Storage URL
  userId: string;
  taken?: boolean;
  quantity?: number;
  isDeleted?: boolean;
  deletedAt?: number;
  form?: MedicineForm;
}

export const STORAGE_KEY = "mediscan_medicines";
