import { NextResponse } from "next/server";
import { suggestCombos } from "@/lib/comboScoring";

export async function POST(request) {
  try {
    const body = await request.json();
    const candidateModels = Array.isArray(body.candidateModels) ? body.candidateModels : [];
    const maxModelsPerSuggestion = body.maxModelsPerSuggestion || 4;

    if (candidateModels.length === 0) {
      return NextResponse.json({ error: "candidateModels is required" }, { status: 400 });
    }

    const suggestions = await suggestCombos(candidateModels, { maxModelsPerSuggestion });

    return NextResponse.json(suggestions);
  } catch (error) {
    console.log("Error generating suggestions:", error);
    return NextResponse.json({ error: "Failed to generate suggestions" }, { status: 500 });
  }
}
