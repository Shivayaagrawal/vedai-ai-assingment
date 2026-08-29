import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  FileText,
  History,
  LayoutGrid,
  Users,
} from "lucide-react";

export const SIDEBAR_NAV: {
  id: string;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "home", label: "Home", icon: LayoutGrid },
  { id: "classroom", label: "My Classroom", icon: Users },
  { id: "assignments", label: "Assignments", icon: FileText },
  { id: "exams", label: "Exams", icon: ClipboardList },
  { id: "library", label: "My Library", icon: History },
];
