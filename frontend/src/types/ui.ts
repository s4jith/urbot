import { ReactNode } from "react";

export interface HeroSectionProps {
  title?: string;
  highlightText?: string;
  description?: string;
  buttonText?: string;
  onButtonClick?: () => void;
  colors?: string[];
  distortion?: number;
  swirl?: number;
  speed?: number;
  offsetX?: number;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  buttonClassName?: string;
  maxWidth?: string;
  veilOpacity?: string;
  fontFamily?: string;
  fontWeight?: number;
}

export interface HeatmapProps {
  total: number;
  answeredCount: number;
}

export interface TimeStatsProps {
  answers: { questionId: string; time: number }[];
}

export interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: "student" | "admin";
}

export interface SmokeBackgroundProps {
  smokeColor?: string;
  baseColor?: string;
  brightness?: number;
  className?: string;
}
