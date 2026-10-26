"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface HotLead {
  enrollment_id: string;
  cadence_id: string;
  cadence_name: string | null;
  lead_id: string;
  lead_title: string | null;
  lead_status: string | null;
  pipeline_id: string | null;
  owner_user_id: string | null;
  contact_name: string | null;
  aberturas: number;
  primeira_abertura_em: string | null;
  ultima_abertura_em: string | null;
  inscricao_status: string;
}

/** `/api/v1/hot-leads` — leads que bateram o limiar de abertura (LIMIAR_LEAD_QUENTE). */
export function useHotLeads() {
  return useQuery({
    queryKey: ["hot-leads"],
    queryFn: async () => apiClient.get<{ data: HotLead[] }>("/api/v1/hot-leads"),
    staleTime: 30_000,
  });
}
