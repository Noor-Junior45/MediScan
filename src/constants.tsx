import React from 'react';
import { Pill, CircleDot, FlaskConical, FlaskRound, Sparkles, HelpCircle, Bandage, Droplets } from 'lucide-react';
import { MedicineForm } from './types';

export const MEDICINE_FORM_ICONS: Record<MedicineForm, React.ReactNode> = {
  tablet: <CircleDot size={16} className="text-blue-400" />,
  capsule: <Pill size={16} className="text-purple-400" />,
  syrup: <FlaskConical size={16} className="text-emerald-400" />,
  ampule: <FlaskRound size={16} className="text-orange-400" />,
  powder: <Sparkles size={16} className="text-yellow-400" />,
  tape: <Bandage size={16} className="text-pink-400" />,
  liquid: <Droplets size={16} className="text-cyan-400" />,
  other: <HelpCircle size={16} className="text-white/40" />,
};

export const MEDICINE_FORM_LABELS: Record<MedicineForm, string> = {
  tablet: 'Tablet',
  capsule: 'Capsule',
  syrup: 'Syrup',
  ampule: 'Ampule',
  powder: 'Powder',
  tape: 'Tape',
  liquid: 'Liquid',
  other: 'Other',
};
