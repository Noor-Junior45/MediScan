export interface MedicineHistory {
  id: string;
  medicineId: string;
  userId: string;
  timestamp: number;
  actionType: 'CREATE' | 'EDIT' | 'MARK_TAKEN' | 'MARK_NOT_TAKEN' | 'DELETE';
  details: string;
}

export interface Medicine {
  id: string;
  name: string;
  dosage: string;
  expirationDate: string;
  usageInstructions: string;
  createdAt: number;
  capturedImage?: string;
  userId: string;
  taken?: boolean;
  quantity?: number;
  isDeleted?: boolean;
  deletedAt?: number;
}

export const STORAGE_KEY = "mediscan_medicines";
